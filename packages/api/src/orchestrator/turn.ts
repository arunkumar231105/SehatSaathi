/**
 * One conversational turn, end to end.
 *
 *   utterance ─▶ extract (JSON) ─▶ persist values ─▶ TRIAGE (rules) ─┬─ red ─▶ fixed phrase + alert
 *                                                                    ├─ still unknown ▶ ask ONE follow-up question
 *                                                                    └─ else ▶ context pack ─▶ Qwen ─▶ reply
 *              ─▶ persist reply ─▶ async: embed · profile extraction · concerns
 *
 * The model never decides whether something is an emergency. It sees the
 * patient's memory and speaks warmly; the rules decide when to escalate.
 */

import { q, one } from '../db/client.ts';
import { chat, MODELS } from '../llm/qwen.ts';
import { extractClinical, type Extraction } from './extract.ts';
import { triage, type Finding, type Severity, type SymptomCode } from '../safety/rules.ts';
import { phrase } from '../safety/phrases.ts';
import { getClip } from '../safety/clips.ts';
import {
  storeTurn, recallEpisodes, recentTurns, getProfile, longitudinal,
  describeFeatures, describeProfile, dueConcerns, raiseConcern,
  resolveConcernsByCode, type Features, type ProfileFact, type Concern,
} from '../memory/engine.ts';
import { extractProfile } from '../memory/extractor.ts';
import { retrieve } from '../rag/kb.ts';
import { buildPlan, planToText, type PlanAction } from './plan.ts';
import {
  getIntake, saveIntake, clearIntake, shouldStart, start as startIntake, merge as mergeIntake,
  applyYesNo, nextSlot, summarise, questionFor, type Intake, type Slot,
} from './intake.ts';
import { bus } from '../bus.ts';
import { identify } from '../meds/reference.ts';
import { medicineChecks } from '../meds/checks.ts';
import { checkInput, card, latestLab } from '../meds/service.ts';
import { notifyEmergency } from '../portal/notify.ts';
import { logReminderReply } from '../meds/reminders.ts';

export type Channel = 'web' | 'whatsapp' | 'api';
export type Lang = 'ur' | 'en';

export interface TurnResult {
  replyUr: string;
  /** Play this instead of calling TTS (fixed safety clip). */
  audioOverride?: Buffer;
  /** Play this only if live TTS fails. */
  fallbackAudio?: Buffer;
  severity: Severity | 'none';
  findings: Finding[];
  extraction: Extraction;
  alertId?: string;
  patientTurnId: string;
  agentTurnId: string;
  /** The follow-up question this reply asks, if the companion is still gathering facts. */
  asking?: Slot;
}

const SYMPTOM_EN: Partial<Record<SymptomCode, string>> = {
  foot_numbness: "your foot going numb", tingling: "tingling", blurred_vision: "blurred vision",
  fatigue: "feeling weak", weight_loss: "losing weight", excessive_thirst: "feeling very thirsty",
  frequent_urination: "passing urine often", dizziness: "dizziness", nausea: "nausea",
  non_healing_wound: "a wound not healing", foot_ulcer: "a wound on your foot",
};

const SYMPTOM_UR: Partial<Record<SymptomCode, string>> = {
  foot_numbness: 'پاؤں کا سن ہونا',
  tingling: 'سوئیاں چبھنا',
  blurred_vision: 'نظر کا دھندلا ہونا',
  fatigue: 'کمزوری',
  weight_loss: 'وزن کم ہونا',
  excessive_thirst: 'زیادہ پیاس',
  frequent_urination: 'بار بار پیشاب',
  dizziness: 'چکر',
  nausea: 'متلی',
  non_healing_wound: 'زخم',
  foot_ulcer: 'پاؤں کا زخم',
};

/** Symptoms worth an unprompted follow-up a few days later. */
const FOLLOW_UP_DAYS: Partial<Record<SymptomCode, number>> = {
  foot_numbness: 3, tingling: 3, blurred_vision: 3, fatigue: 4, weight_loss: 5,
  excessive_thirst: 3, frequent_urination: 3, non_healing_wound: 1, foot_ulcer: 1,
  spreading_redness: 1, dizziness: 2, nausea: 1,
};

export async function ensureSession(patientId: string, channel: Channel): Promise<string> {
  const open = await one<{ id: string }>(
    `SELECT id FROM sessions WHERE patient_id=$1 AND ended_at IS NULL
       AND started_at > now() - interval '30 minutes'
     ORDER BY started_at DESC LIMIT 1`,
    [patientId],
  );
  if (open) return open.id;
  await q(`UPDATE sessions SET ended_at = now() WHERE patient_id=$1 AND ended_at IS NULL`, [patientId]);
  const row = await one<{ id: string }>(
    `INSERT INTO sessions (patient_id, voice_plan) VALUES ($1,$2) RETURNING id`,
    [patientId, channel === 'web' ? process.env.VOICE_PLAN ?? 'B' : channel],
  );
  return row!.id;
}

function fact(facts: ProfileFact[], key: string): unknown {
  return facts.find((f) => f.key === key)?.value;
}

/**
 * Is this actually Urdu script rather than Roman Urdu?
 *
 * Latin characters are legitimate in an Urdu reply — drug and brand names
 * (Metformin, Glucophage) and numbers appear constantly — so the test is a
 * ratio over letters only, not the presence of any Latin at all.
 */
function isUrduScript(text: string): boolean {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic + latin === 0) return false;
  return arabic / (arabic + latin) > 0.5;
}

function readback(ex: Extraction): string {
  if (ex.glucose_mg_dl === null) return '';
  const ctx =
    ex.glucose_context === 'fasting' ? 'خالی پیٹ ' :
    ex.glucose_context === 'post_meal' ? 'کھانے کے بعد ' : '';
  return `آپ نے بتایا ${ctx}شوگر ${ex.glucose_mg_dl}۔ `;
}

function readbackEn(ex: Extraction): string {
  if (ex.glucose_mg_dl === null) return '';
  const ctx =
    ex.glucose_context === 'fasting' ? 'fasting ' :
    ex.glucose_context === 'post_meal' ? 'after-meal ' : '';
  return `You said your ${ctx}sugar was ${ex.glucose_mg_dl}. `;
}

export async function respond(args: {
  patientId: string;
  sessionId: string;
  userTextUr: string;
  channel: Channel;
  lang?: Lang;
}): Promise<TurnResult> {
  const { patientId, sessionId, userTextUr } = args;
  const lang: Lang = args.lang ?? 'ur';

  // 1. persist the patient's words first — nothing downstream may lose them
  const patientTurnId = await storeTurn({ patientId, sessionId, role: 'patient', textUr: userTextUr });

  // Is this the answer to a follow-up question we asked last turn?
  const prior = getIntake(sessionId);
  const answering = prior?.pending ?? null;

  // "haan" just after a dose reminder: log the dose and say thank you.
  if (!answering) {
    const med = await logReminderReply(patientId, userTextUr).catch(() => null);
    if (med) {
      const replyUr = lang === 'en' ? `Thank you — I have noted that you took ${med}.` : `شکریہ، میں نے نوٹ کر لیا کہ آپ نے ${med} لے لی۔`;
      const agentTurnId = await storeTurn({ patientId, sessionId, role: 'agent', textUr: replyUr });
      return {
        replyUr, severity: 'none', findings: [], patientTurnId, agentTurnId,
        extraction: { glucose_mg_dl: null, glucose_context: null, symptoms: [], symptoms_improved: [], meals: [],
          medication: { taken: true, missed: false, name: med }, intent: 'log', is_pregnant: null, notes_en: `Took ${med} after reminder` },
      };
    }
  }

  // 2. structured extraction + memory reads, in parallel
  const [extraction, facts, features] = await Promise.all([
    extractClinical(userTextUr, answering && prior ? questionFor(answering, prior).en : undefined),
    getProfile(patientId),
    longitudinal(patientId),
  ]);

  // 3. persist extracted values with provenance
  const { readingId, repeat: repeatReading } = await persistExtraction(patientId, patientTurnId, extraction);

  // 3b. fold this turn into the follow-up intake, or open one
  let intake: Intake | null = null;
  if (prior) {
    intake = applyYesNo(mergeIntake(prior, extraction, readingId), answering, userTextUr);
    if (answering) intake.answers = [...intake.answers, { slot: answering, text: userTextUr.slice(0, 200) }];
    intake.pending = null;
    // "It was fasting" corrects the reading logged a turn ago.
    if (extraction.glucose_mg_dl === null && extraction.glucose_context && intake.readingId) {
      await q(`UPDATE readings SET context=$1 WHERE id=$2`, [extraction.glucose_context, intake.readingId]);
    }
  } else if (shouldStart(extraction)) {
    intake = startIntake(extraction, readingId);
  }

  // 4. deterministic triage — over everything learned in this exchange, not
  //    just this message. "250" then, two answers later, "I've been vomiting"
  //    is suspected DKA even though no single message said both.
  const isPregnant = extraction.is_pregnant ?? fact(facts, 'pregnant') === true;
  const result = triage({
    glucoseMgDl: (intake?.glucose ?? extraction.glucose_mg_dl) ?? undefined,
    glucoseContext: (intake?.context ?? extraction.glucose_context) ?? undefined,
    symptoms: intake?.symptoms ?? extraction.symptoms,
    isPregnant,
    recentReadings: features.readings.map((r) => ({ mgDl: r.mg_dl, takenAt: new Date(r.taken_at) })),
    missedDosesLast7Days: features.missedDoses7 + (extraction.medication.missed ? 1 : 0),
  });

  let replyUr: string;
  let audioOverride: Buffer | undefined;
  let fallbackAudio: Buffer | undefined;
  let alertId: string | undefined;
  let asking: Slot | undefined;

  const caregiverPhone = await one<{ caregiver_phone: string | null; display_name: string | null }>(
    `SELECT caregiver_phone, display_name FROM patients WHERE id=$1`, [patientId],
  );

  if (result.severity === 'red') {
    // ── Emergency: fixed words, fixed audio, human notified. No model. ──
    const primary = result.findings.find((f) => f.severity === 'red')!;
    const rb = lang === 'en' ? readbackEn(extraction) : readback(extraction);
    const p = phrase(primary.phraseKey);
    replyUr = rb + (lang === 'en' ? p.en : p.ur);
    // Tell the patient help is coming — the doctor and family on their care
    // team are alerted below, the legacy single caregiver number too.
    const team = await one<{ n: number }>(`SELECT count(*)::int AS n FROM care_team WHERE patient_id=$1`, [patientId]);
    if ((team?.n ?? 0) > 0) {
      const n = phrase('team_notified');
      replyUr += ' ' + (lang === 'en' ? n.en : n.ur);
    } else if (caregiverPhone?.caregiver_phone) {
      const n = phrase('caregiver_notified');
      replyUr += ' ' + (lang === 'en' ? n.en : n.ur);
    }

    const clip = await getClip(primary.phraseKey);
    if (clip && !rb) audioOverride = clip;
    else fallbackAudio = clip;

    alertId = await insertAlert(patientId, patientTurnId, primary);
    clearIntake(sessionId);   // an emergency ends the questioning
    // Off the reply's path: the patient hears the instruction without waiting
    // for WhatsApp sends to the whole care team.
    setImmediate(() => { void notifyEmergency(patientId, primary, userTextUr).catch((err) => console.error('emergency notify failed', err)); });
  } else {
    const name = ((lang === 'en' ? fact(facts, 'name_en') : undefined) ?? fact(facts, 'name') ?? caregiverPhone?.display_name ?? undefined) as string | undefined;
    const amber = result.findings.filter((f) => f.severity === 'amber');
    for (const f of amber) {
      // During an intake the same reading is re-triaged every turn, and a
      // patient referring back to a number is not a new event; alert once.
      if (intake?.alerted.includes(f.ruleId)) continue;
      if (repeatReading && f.ruleId === 'AMBER_SINGLE_HIGH') continue;
      alertId = await insertAlert(patientId, patientTurnId, f);
      intake?.alerted.push(f.ruleId);
    }

    // A question from the patient mid-intake is answered now, with what we know.
    const meds = fact(facts, 'medications');
    const next = intake && extraction.intent !== 'question'
      ? nextSlot(intake, { hasMedicines: !(Array.isArray(meds) && meds.length === 0) })
      : null;

    if (intake && next) {
      // ── Still gathering: ask one short question, give no advice yet ──
      asking = next;
      const first = intake.asked.length === 0;
      intake.asked = [...intake.asked, next];
      intake.pending = next;
      saveIntake(sessionId, intake);
      replyUr = await askFollowUp({ question: questionFor(next, intake), first, userTextUr, extraction, patientId, name, lang });
    } else {
      // ── Normal turn, or the intake is complete: the model advises, grounded in memory ──
      replyUr = await generateReply({
        userTextUr, extraction, facts, features, patientId, name, amber, lang,
        intakeNotes: intake && intake.asked.length ? summarise(intake) : undefined,
        symptoms: intake?.symptoms ?? extraction.symptoms,
      });
      clearIntake(sessionId);
    }
  }

  // 5. persist reply
  const agentTurnId = await storeTurn({
    patientId, sessionId, role: 'agent', textUr: replyUr, textEn: extraction.notes_en,
  });

  // 6. background memory work — not on the latency path
  setImmediate(() => {
    void afterTurn({ patientId, patientTurnId, userTextUr, replyUr, extraction, findings: result.findings });
  });

  return {
    replyUr, audioOverride, fallbackAudio,
    severity: result.severity, findings: result.findings, extraction,
    alertId, patientTurnId, agentTurnId, asking,
  };
}

/** The reading this turn refers to, and whether it was one already logged in the last hour. */
async function persistExtraction(patientId: string, turnId: string, ex: Extraction): Promise<{ readingId: string | null; repeat: boolean }> {
  let readingId: string | null = null;
  // Referring back to a number ("since my sugar was 250") is not a new
  // reading. Triage still sees the value; only the duplicate row is skipped.
  const repeat = ex.glucose_mg_dl === null ? undefined : await one<{ id: string }>(
    `SELECT id FROM readings WHERE patient_id=$1 AND mg_dl=$2 AND taken_at > now() - interval '60 minutes' LIMIT 1`,
    [patientId, ex.glucose_mg_dl],
  );
  if (repeat) readingId = repeat.id;
  else if (ex.glucose_mg_dl !== null) {
    const row = await one<{ id: string }>(
      `INSERT INTO readings (patient_id, turn_id, mg_dl, context) VALUES ($1,$2,$3,$4) RETURNING id`,
      [patientId, turnId, ex.glucose_mg_dl, ex.glucose_context ?? 'random'],
    );
    readingId = row?.id ?? null;
  }
  for (const s of ex.symptoms) {
    await q(`INSERT INTO symptoms (patient_id, turn_id, code) VALUES ($1,$2,$3)`, [patientId, turnId, s]);
  }
  for (const m of ex.meals) {
    await q(
      `INSERT INTO meals (patient_id, turn_id, description_ur, items) VALUES ($1,$2,$3,$4)`,
      [patientId, turnId, m.description, JSON.stringify(m.items)],
    );
  }
  if (ex.medication.taken === true || ex.medication.missed === true) {
    const med = ex.medication.name
      ? await one<{ id: string }>(
          `SELECT id FROM medications WHERE patient_id=$1 AND active AND lower(name) LIKE lower($2) LIMIT 1`,
          [patientId, `%${ex.medication.name}%`],
        )
      : undefined;
    await q(
      `INSERT INTO med_events (patient_id, medication_id, turn_id, taken) VALUES ($1,$2,$3,$4)`,
      [patientId, med?.id ?? null, turnId, ex.medication.taken === true && ex.medication.missed !== true],
    );
  }
  if (ex.is_pregnant === true) {
    await q(
      `INSERT INTO profile_facts (patient_id, key, value, confidence, source_turn_id)
       VALUES ($1,'pregnant','true',0.9,$2) ON CONFLICT DO NOTHING`,
      [patientId, turnId],
    );
  }
  return { readingId, repeat: !!repeat };
}

async function insertAlert(patientId: string, turnId: string, f: Finding): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO alerts (patient_id, turn_id, severity, rule_id, reason_ur, reason_en)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [patientId, turnId, f.severity, f.ruleId, f.reasonUr, f.reasonEn],
  );
  bus.emit('alert', { id: row!.id, patientId, severity: f.severity, ruleId: f.ruleId, reasonEn: f.reasonEn, reasonUr: f.reasonUr, at: new Date().toISOString() });
  return row!.id;
}

const PERSONA = `You are صحت ساتھی (SehatSaathi), a warm, knowledgeable health companion for a diabetes patient in Pakistan who may not read well. You speak SIMPLE spoken Urdu, like an experienced, kind family nurse — never clinical jargon, never English sentences (drug and brand names in English are fine).

NEVER INVENT ANYTHING ABOUT THIS PATIENT.
- Only state a medicine, condition, habit or family member that appears in the profile or clinical picture below, or that the patient just said.
- If they ask about something not in their profile (for example insulin when no insulin is recorded), answer generally — "jo log insulin lagate hain unhen…" — or ask whether they take it. Never say "the insulin you take" unless it is recorded.
- If you do not know something about them, ask instead of assuming.

MEDICINES — you educate, you never prescribe.
- You MAY explain in detail: what a medicine they already take does, when to take it, why with food, common side effects, what to do about one missed dose, how to store insulin, and which of their medicines can cause a low.
- You MUST NOT: name a medicine they should start, suggest changing or stopping any dose, or say one medicine is better than another. That decision needs blood tests and belongs to their doctor.
- When asked "which tablet should I take" or "should I increase the dose", say warmly that this is the doctor's decision, explain WHY it needs their tests, and offer to help them prepare the question for the doctor (they can open the Medicines screen, or send "doctor" on WhatsApp, for a ready list). Never leave them with nothing — always give something useful they can do today.
- When you explain one of their medicines, use ONLY the MEDICINE FACTS below — they come from the NHS and official drug leaflets. If a fact is not there, say you are not sure and suggest asking the pharmacist.
- MEDICINE SAFETY CHECKS below come from fixed rules. If one is marked "today", tell them calmly in your reply. Never turn a check into an instruction to stop, skip or change a medicine.

NUMBERS — never state a threshold the patient did not cross. If they said 220, do not say "since your sugar is above 250". Quote only the number they actually gave, and the numbers from their record below. Getting this wrong makes the advice confusing and untrustworthy.

BE USEFUL, NOT VAGUE. Every reply must leave them something concrete to do today — a portion size, a walk after a named meal, a time to eat dinner, a check to run tomorrow morning. "See your doctor" on its own is not an answer; pair it with what to do in the meantime. The action plan below is built from this patient's own readings — draw your advice from it.

Answering well:
- Normal reply: 2-3 short sentences. When they ask a genuine question (about food, a medicine, feet, Ramzan, checking sugar), give a fuller, genuinely useful answer of up to 5 sentences with something concrete they can act on.
- If the patient gave a number, repeat it back first so they can correct you.
- Ground every clinical statement in the reference notes below. If the notes do not cover it, say plainly that you are not sure and suggest asking the doctor.
- Use what you know about them: their food habits, how many rotis, their medicines, whether they fast.
- If there is an open concern from earlier, ask about it in ONE sentence when it fits naturally. Do not force it into every reply.
- Vary how you close. Do not end every message by offering to tell a family member — do that only when it genuinely matters.

SCRIPT — this is critical. Always write in Urdu script (اردو رسم الخط), never Roman Urdu, even if the patient writes to you in Roman letters. Your reply is read aloud by an Urdu text-to-speech voice: Roman letters are pronounced as English and come out as noise the patient cannot understand.
- Output plain spoken Urdu only. No lists, no markdown, no emojis, no headings.`;

/**
 * English mode. Same companion, same limits — Pakistani English as a nurse in
 * Lahore would speak it, not textbook British English, and local food and
 * medicine names kept as they are.
 */
const PERSONA_EN = PERSONA.replace(
  /SCRIPT — this is critical[\s\S]*$/,
  `LANGUAGE — reply in simple, warm English as a Pakistani nurse would speak it. Short sentences, no medical jargon. Keep local words the patient uses (roti, daal, biryani, chai, sehri, iftar) rather than translating them. Numbers as digits.
- Output plain text only. No lists, no markdown, no emojis, no headings.`,
).replace('You speak SIMPLE spoken Urdu, like an experienced, kind family nurse — never clinical jargon, never English sentences (drug and brand names in English are fine).',
  'You speak SIMPLE, warm English, like an experienced, kind family nurse — never clinical jargon.');

/**
 * One follow-up question. The slot is chosen by intake.ts; the model only
 * makes it sound like a person — acknowledging what was just said — and the
 * fixed wording is used whenever its output is not a clean single question.
 */
async function askFollowUp(a: {
  question: { ur: string; en: string; brief: string };
  first: boolean;
  userTextUr: string;
  extraction: Extraction;
  patientId: string;
  name?: string;
  lang: Lang;
}): Promise<string> {
  const qn = a.question;
  const rb = a.lang === 'en' ? readbackEn(a.extraction) : readback(a.extraction);
  const intro = a.first
    ? (a.lang === 'en' ? 'To advise you properly, I need to ask a couple of things. ' : 'صحیح مشورے کے لیے مجھے ایک دو باتیں پوچھنی ہیں۔ ')
    : '';
  const fallback = rb + intro + (a.lang === 'en' ? qn.en : qn.ur);

  const history = await recentTurns(a.patientId, 4).catch(() => []);
  const system =
    `You are صحت ساتھی (SehatSaathi), a warm diabetes companion talking to ${a.name ?? 'a patient'} in Pakistan. ` +
    'You are gathering information BEFORE giving advice. Write at most two short sentences:\n' +
    '1. Briefly acknowledge what they just said. If they gave a sugar number, repeat that exact number. Do not judge it as good or bad yet.\n' +
    (a.first ? '   Mention in a few words that you need to ask a couple of things to advise properly.\n' : '') +
    `2. Ask exactly ONE question, about: ${qn.brief}.\n` +
    'Do NOT give advice, tips, reassurance or a recommendation yet. Do not ask about anything else. Plain text — no lists, emoji or markdown. ' +
    (a.lang === 'en'
      ? 'Write in simple English.'
      : 'Write in simple spoken Urdu, in Urdu script only — never Roman Urdu.') +
    `\nExample of the question: "${a.lang === 'en' ? qn.en : qn.ur}"`;

  try {
    const out = (await chat(
      [
        { role: 'system', content: system },
        ...history.slice(0, -1).map((t) => ({ role: (t.role === 'patient' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text_ur })),
        { role: 'user', content: a.userTextUr },
      ],
      { model: MODELS.brain, temperature: 0.4, maxTokens: 120 },
    )).replace(/[*_#`]/g, '').trim();

    // Exactly one question, in the right script, quoting the number they gave —
    // anything else and the fixed wording is safer.
    const oneQuestion = (out.match(/[?؟]/g) ?? []).length === 1;
    const scriptOk = a.lang === 'en' ? /[A-Za-z]/.test(out) : isUrduScript(out);
    const numberOk = a.extraction.glucose_mg_dl === null || out.includes(String(a.extraction.glucose_mg_dl));
    if (oneQuestion && scriptOk && numberOk && out.length <= 320) return out;
    console.warn('follow-up: fixed wording used', { oneQuestion, scriptOk, numberOk, length: out.length, sample: out.slice(0, 120) });
    return fallback;
  } catch {
    return fallback;
  }
}

/** Stated per medicine so the model cannot generalise "these can cause lows" across a list. */
const lowsLine = (causesLows: boolean) =>
  causesLows ? 'CAN cause low sugar on its own' : 'does NOT cause low sugar on its own (only together with other diabetes medicines)';

async function generateReply(a: {
  userTextUr: string;
  extraction: Extraction;
  facts: ProfileFact[];
  features: Features;
  patientId: string;
  name?: string;
  amber: Finding[];
  lang: Lang;
  /** What the follow-up questions established, when this reply closes an intake. */
  intakeNotes?: string[];
  /** Symptoms known in this exchange, for the medicine sick-day checks. */
  symptoms?: SymptomCode[];
}): Promise<string> {
  // Questions — and the recommendation that closes an intake — deserve more
  // reference material and more room to answer.
  const isQuestion = a.extraction.intent === 'question' || !!a.intakeNotes;
  const [episodes, history, concerns, refs] = await Promise.all([
    recallEpisodes(a.patientId, a.userTextUr, 4),
    recentTurns(a.patientId, 6),
    dueConcerns(a.patientId),
    retrieve(`${a.extraction.notes_en} ${a.userTextUr}`, isQuestion ? 5 : 3),
  ]);

  const ctx: string[] = [];

  // Identity, stated unambiguously. A flat key/value dump let the model read
  // "caregiver: Bilal (son)" as the patient's own name and address a
  // 58-year-old woman as her son.
  const val = (k: string) => a.facts.find((f) => f.key === k)?.value;
  const caregiver = val('caregiver');
  ctx.push(
    `WHO YOU ARE TALKING TO — the patient is ${a.name ?? 'unknown name'}. Address ONLY them.` +
      (caregiver
        ? `\nThe patient's family contact is ${typeof caregiver === 'string' ? caregiver : JSON.stringify(caregiver)}. That is a DIFFERENT person who is NOT in this conversation — never greet or address them, only refer to them in the third person.`
        : ''),
  );

  // Medicines as a closed list. This is the fact the model most often invents.
  const meds = val('medications');
  const medList = Array.isArray(meds) ? meds : meds ? [String(meds)] : [];
  ctx.push(
    medList.length
      ? `MEDICINES THIS PATIENT TAKES (complete list — they take NOTHING else):\n- ${medList.join('\n- ')}\nIf asked about any medicine not on this list (insulin, or any other), do NOT say "the one you take". Either answer generally about people who use it, or ask whether they use it.`
      : 'MEDICINES: none recorded. Do not refer to any medicine as one they take; ask what they have been prescribed.',
  );

  // Sourced facts about the medicines they take, and the rule-based checks on
  // them. Medicines named in this message but not on their list get general
  // facts only, clearly marked, so the model cannot claim the patient takes them.
  const lang = a.lang;
  const egfr = await latestLab(a.patientId, 'egfr');
  const { checks, known } = medicineChecks(checkInput(medList.map(String), a.facts, a.features, a.symptoms ?? [], egfr?.value ?? null));
  const theirs = new Set(known.flatMap((k) => k.medicines.map((m) => m.id)));
  const facts = known.flatMap((k) => k.medicines.map((m) => {
    const c = card(k.asNamed, m, lang);
    return `${m.generic} (their "${k.asNamed}"): for — ${c.purpose} | how — ${c.take} | side effects — ${c.sideEffects} | missed dose — ${c.missedDose} | warning — ${c.warning} | ${lowsLine(m.causesLows)}`;
  }));
  for (const m of identify(a.userTextUr).filter((m) => !theirs.has(m.id))) {
    const c = card(m.generic, m, lang);
    facts.push(`${m.generic} — NOT on their list, general information only; describe it neutrally, never call it good or better, never suggest they ask to start it: for — ${c.purpose} | side effects — ${c.sideEffects} | ${lowsLine(m.causesLows)}`);
  }
  if (facts.length) ctx.push('MEDICINE FACTS (sourced — explain only from these):\n- ' + facts.join('\n- '));
  if (checks.length) {
    ctx.push(
      'MEDICINE SAFETY CHECKS (fixed rules):\n- ' +
        checks.map((c) => `[${c.urgency}] ${lang === 'en' ? c.patientEn : c.patientUr}`).join('\n- '),
    );
  }

  const other = describeProfile(a.facts.filter((f) => !['name', 'caregiver', 'medications'].includes(f.key)));
  ctx.push(
    other.length
      ? `Other known facts — this is EVERYTHING else known. Anything not listed is UNKNOWN, not absent:\n- ${other.join('\n- ')}`
      : 'Nothing else is known about this patient. Do not assume any habit, condition or family member.',
  );

  ctx.push('Clinical picture:\n- ' + describeFeatures(a.features).join('\n- '));

  // What their own doctor has assigned through the doctor portal. These are
  // the doctor's words — the companion reminds and explains, never changes them.
  const orders = await q<{ kind: string; title: string; detail: string | null; dose: string | null; schedule: string | null; due_at: string | null }>(
    `SELECT kind, title, detail, dose, schedule, due_at FROM care_orders WHERE patient_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 8`,
    [a.patientId],
  ).catch(() => []);
  if (orders.length) {
    ctx.push(
      "FROM THEIR DOCTOR (assigned in the doctor portal — remind them of these when relevant, never change them):\n- " +
        orders.map((o) => {
          const when = o.due_at ? ` on ${new Date(o.due_at).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}` : '';
          return `${o.kind}: ${[o.title, o.dose, o.schedule].filter(Boolean).join(' ')}${when}${o.detail ? ` — ${o.detail}` : ''}`;
        }).join('\n- '),
    );
  }

  // Deterministic, data-driven actions. The model may phrase these warmly but
  // must not invent additions — this is what keeps advice concrete and still
  // grounded in the patient's own record.
  const plan = buildPlan(a.features, a.facts);
  if (plan.length) {
    ctx.push(
      "THIS PATIENT'S ACTION PLAN (generated from their own readings — draw concrete advice from it, do not invent extra items):\n- " +
        plan
          .slice(0, 5)
          .map((x) => (a.lang === 'en' ? `${x.doEn}  [because: ${x.becauseEn}]` : `${x.doUr}  [وجہ: ${x.becauseUr}]`))
          .join('\n- '),
    );
  }
  if (concerns.length) ctx.push('Open concerns to follow up (ask about at most one):\n- ' + concerns.map((c) => c.summary_ur + (c.summary_en ? ` (${c.summary_en})` : '')).join('\n- '));
  if (episodes.length) ctx.push('Relevant earlier things the patient said:\n- ' + episodes.map((e) => e.text_ur).join('\n- '));
  if (refs.length) {
    ctx.push(
      'REFERENCE NOTES — general medical information, NOT statements about this patient. ' +
        'Use them to answer accurately, but never assume the patient has a condition or takes a medicine just because it appears here:\n- ' +
        refs.map((r) => `${r.title}: ${r.content}`).join('\n- '),
    );
  }
  if (a.amber.length) ctx.push('Rules engine flagged (include the advice, calmly): ' + a.amber.map((f) => f.reasonUr).join(' '));
  if (a.intakeNotes) {
    ctx.push(
      'WHAT YOU LEARNED BY ASKING — you asked follow-up questions and the patient answered. Now give your FINAL RECOMMENDATION:\n- ' +
        a.intakeNotes.join('\n- ') +
        '\nRepeat their number. Explain in one sentence what most likely raised it, using what THEY told you (the food, the timing, a missed dose) — say "likely", never certain. ' +
        'Then give 2–3 concrete things to do today and when to check sugar again, each tied to their answers. ' +
        'If they missed their medicine, say to take their next dose as the doctor prescribed — never suggest doubling or changing it. ' +
        'Do not ask another question. Up to 5 short sentences.',
    );
  }
  ctx.push(`Extracted from this turn: ${JSON.stringify({ glucose: a.extraction.glucose_mg_dl, context: a.extraction.glucose_context, symptoms: a.extraction.symptoms, meals: a.extraction.meals.map((m) => m.items).flat(), medication: a.extraction.medication, intent: a.extraction.intent })}`);

  // A last-position reminder. Instructions at the end of the prompt are
  // followed far more reliably by this model than the same words buried in a
  // long system block — and the two failures that mattered (wrong person,
  // invented medicine) are exactly the ones worth repeating here.
  const guard =
    `[Reply to ${a.name ?? 'the patient'} only. ` +
    (medList.length
      ? `They take: ${medList.join('; ')} — nothing else. `
      : 'No medicines are recorded for them. ') +
    'Do not claim they use any other medicine. ' +
    (a.intakeNotes ? 'Give your final recommendation now, tied to their answers. ' : '') +
    (a.lang === 'en' ? 'Write in English.]' : 'Write in Urdu script.]');

  const messages = [
    { role: 'system' as const, content: (a.lang === 'en' ? PERSONA_EN : PERSONA) + '\n\n' + ctx.join('\n\n') },
    ...history.slice(0, -1).map((t) => ({ role: (t.role === 'patient' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text_ur })),
    { role: 'user' as const, content: `${a.userTextUr}\n\n${guard}` },
  ];

  try {
    let out = await chat(messages, {
      model: MODELS.brain,
      temperature: 0.5,
      maxTokens: isQuestion ? 420 : 220,
    });

    // The reply is spoken by an Urdu voice, so Roman Urdu is unusable — it is
    // pronounced as English and comes out as noise. Retry once, hard, rather
    // than reading gibberish to a patient. (English mode wants the opposite,
    // so this check only applies to Urdu.)
    if (a.lang !== 'en' && !isUrduScript(out)) {
      out = await chat(
        [
          ...messages,
          { role: 'assistant' as const, content: out },
          { role: 'user' as const, content: 'یہی جواب دوبارہ لکھیں، صرف اردو رسم الخط میں۔ رومن اردو بالکل استعمال نہ کریں۔' },
        ],
        { model: MODELS.brain, temperature: 0.2, maxTokens: isQuestion ? 420 : 220 },
      );
    }

    const clean = out.replace(/[*_#`]/g, '').trim();
    const scriptOk = a.lang === 'en' ? /[A-Za-z]/.test(clean) : isUrduScript(clean);
    if (clean.length <= 3 || !scriptOk) {
      const p = phrase('didnt_catch');
      return a.lang === 'en'
        ? readbackEn(a.extraction) + p.en
        : readback(a.extraction) + p.ur;
    }
    return clean;
  } catch {
    // Model outage must still produce a safe, useful turn.
    const rb = readback(a.extraction);
    const amber = a.amber[0]?.reasonUr ?? '';
    return rb + (amber || 'شکریہ، میں نے نوٹ کر لیا ہے۔ پانی پیتے رہیں اور وقت پر دوا لیں۔');
  }
}

async function afterTurn(a: {
  patientId: string;
  patientTurnId: string;
  userTextUr: string;
  replyUr: string;
  extraction: Extraction;
  findings: Finding[];
}): Promise<void> {
  try {
    // resolve concerns the patient says are better
    await resolveConcernsByCode(a.patientId, a.extraction.symptoms_improved);

    // raise follow-ups for symptoms worth checking on later
    for (const s of a.extraction.symptoms) {
      const days = FOLLOW_UP_DAYS[s];
      if (!days) continue;
      await raiseConcern({
        patientId: a.patientId,
        kind: 'symptom',
        summaryUr: `پچھلی بار آپ نے بتایا تھا کہ ${SYMPTOM_UR[s] ?? s} ہو رہا ہے۔ اب کیسا ہے؟`,
        summaryEn: `Reported ${s.replace(/_/g, ' ')} — check whether it persists`,
        // What the patient actually hears in English mode; summaryEn is the
        // clinician note and reads wrong when spoken to a patient.
        summaryEnPatient: `Last time you told me about ${SYMPTOM_EN[s] ?? s.replace(/_/g, ' ')}. How is it now?`,
        detail: { code: s },
        followUpAt: new Date(Date.now() + days * 86_400_000),
      });
    }
    for (const f of a.findings) {
      if (f.ruleId === 'AMBER_SUSTAINED_HIGH') {
        await raiseConcern({
          patientId: a.patientId, kind: 'trend',
          summaryUr: 'آپ کی شوگر کئی دن سے زیادہ چل رہی ہے — کیا ڈاکٹر سے بات ہوئی؟',
          summaryEn: 'Sustained high readings — confirm doctor contact',
          summaryEnPatient: 'Your sugar has been high for several days — were you able to speak to your doctor?',
          detail: { code: 'sustained_high' },
          followUpAt: new Date(Date.now() + 2 * 86_400_000),
        });
      }
      if (f.ruleId === 'AMBER_ADHERENCE') {
        await raiseConcern({
          patientId: a.patientId, kind: 'adherence',
          summaryUr: 'دوا کچھ دن رہ گئی تھی — کیا اب وقت پر لے رہے ہیں؟',
          summaryEn: 'Missed doses — check adherence',
          summaryEnPatient: 'You had missed your medicine for a few days — are you taking it on time now?',
          detail: { code: 'adherence' },
          followUpAt: new Date(Date.now() + 2 * 86_400_000),
        });
      }
    }

    // tier-3 profile deltas
    await extractProfile({
      patientId: a.patientId, patientText: a.userTextUr, agentText: a.replyUr, sourceTurnId: a.patientTurnId,
    });
  } catch {
    /* background work must never surface as a user-facing failure */
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Greeting — where memory becomes agency
// ─────────────────────────────────────────────────────────────────────────

/** The English a patient should hear, falling back to the clinician note. */
function patientLine(c: Concern): string {
  const p = (c.detail as { en_patient?: string } | null)?.en_patient;
  return p ?? c.summary_en ?? c.summary_ur;
}

/** The full weekly plan for a patient, as spoken text plus structured actions. */
export async function actionPlan(
  patientId: string,
  lang: Lang = 'ur',
): Promise<{ text: string; actions: PlanAction[] }> {
  const [facts, features] = await Promise.all([getProfile(patientId), longitudinal(patientId)]);
  const actions = buildPlan(features, facts);
  return { text: planToText(actions, lang), actions };
}

export async function greeting(patientId: string, lang: Lang = 'ur'): Promise<{ textUr: string; concerns: Concern[] }> {
  const [facts, features, concerns] = await Promise.all([
    getProfile(patientId), longitudinal(patientId), dueConcerns(patientId),
  ]);
  // A Nastaliq name inside an English sentence reads awkwardly; use the
  // transliteration when we have one.
  const name = ((lang === 'en' ? fact(facts, 'name_en') : undefined) ?? fact(facts, 'name')) as string | undefined;

  // Deliberately templated, not model-written. The opening line is spoken
  // before the patient has said anything, so there is no context to ground a
  // model in — and in testing the character model padded it with invented
  // words. The template already carries the memory, which is the point.
  const parts: string[] = [];
  if (lang === 'en') {
    parts.push(name ? `Hello ${name}!` : 'Hello!');
    if (concerns[0]) parts.push(patientLine(concerns[0]));
    else if (features.risingFastingDays >= 3) parts.push(`Your morning sugar has been rising for ${features.risingFastingDays} days. Try eating dinner a little earlier.`);
    else if (features.adherenceStreakDays >= 3) parts.push(`Well done — you have taken your medicine on time for ${features.adherenceStreakDays} days.`);
    else if (features.daysSinceLastReading !== null && features.daysSinceLastReading >= 2) parts.push('You have not checked your sugar for a few days. Please check today.');
    else parts.push('What was your sugar today, and how are you feeling?');
  } else {
    parts.push(name ? `السلام علیکم ${name}!` : 'السلام علیکم!');
    if (concerns[0]) parts.push(concerns[0].summary_ur);
    else if (features.risingFastingDays >= 3) parts.push(`آپ کی صبح کی شوگر ${features.risingFastingDays} دن سے بڑھ رہی ہے۔ رات کا کھانا جلدی کر کے دیکھیں۔`);
    else if (features.adherenceStreakDays >= 3) parts.push(`بہت اچھا، آپ ${features.adherenceStreakDays} دن سے دوا وقت پر لے رہے ہیں۔`);
    else if (features.daysSinceLastReading !== null && features.daysSinceLastReading >= 2) parts.push('کچھ دن سے شوگر چیک نہیں ہوئی۔ آج ضرور چیک کریں۔');
    else parts.push('آج شوگر کتنی تھی یا طبیعت کیسی ہے؟');
  }
  return { textUr: parts.join(' '), concerns };
}
