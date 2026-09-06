/**
 * One conversational turn, end to end.
 *
 *   utterance ─▶ extract (JSON) ─▶ persist values ─▶ TRIAGE (rules) ─┬─ red ─▶ fixed phrase + alert
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
import { bus } from '../bus.ts';

export type Channel = 'web' | 'whatsapp' | 'api';

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
}

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

function readback(ex: Extraction): string {
  if (ex.glucose_mg_dl === null) return '';
  const ctx =
    ex.glucose_context === 'fasting' ? 'خالی پیٹ ' :
    ex.glucose_context === 'post_meal' ? 'کھانے کے بعد ' : '';
  return `آپ نے بتایا ${ctx}شوگر ${ex.glucose_mg_dl}۔ `;
}

export async function respond(args: {
  patientId: string;
  sessionId: string;
  userTextUr: string;
  channel: Channel;
}): Promise<TurnResult> {
  const { patientId, sessionId, userTextUr } = args;

  // 1. persist the patient's words first — nothing downstream may lose them
  const patientTurnId = await storeTurn({ patientId, sessionId, role: 'patient', textUr: userTextUr });

  // 2. structured extraction + memory reads, in parallel
  const [extraction, facts, features] = await Promise.all([
    extractClinical(userTextUr),
    getProfile(patientId),
    longitudinal(patientId),
  ]);

  // 3. persist extracted values with provenance
  await persistExtraction(patientId, patientTurnId, extraction);

  // 4. deterministic triage — includes what was just logged
  const isPregnant = extraction.is_pregnant ?? fact(facts, 'pregnant') === true;
  const result = triage({
    glucoseMgDl: extraction.glucose_mg_dl ?? undefined,
    glucoseContext: extraction.glucose_context ?? undefined,
    symptoms: extraction.symptoms,
    isPregnant,
    recentReadings: features.readings.map((r) => ({ mgDl: r.mg_dl, takenAt: new Date(r.taken_at) })),
    missedDosesLast7Days: features.missedDoses7 + (extraction.medication.missed ? 1 : 0),
  });

  let replyUr: string;
  let audioOverride: Buffer | undefined;
  let fallbackAudio: Buffer | undefined;
  let alertId: string | undefined;

  const caregiverPhone = await one<{ caregiver_phone: string | null; display_name: string | null }>(
    `SELECT caregiver_phone, display_name FROM patients WHERE id=$1`, [patientId],
  );

  if (result.severity === 'red') {
    // ── Emergency: fixed words, fixed audio, human notified. No model. ──
    const primary = result.findings.find((f) => f.severity === 'red')!;
    const rb = readback(extraction);
    replyUr = rb + phrase(primary.phraseKey).ur;
    if (caregiverPhone?.caregiver_phone) replyUr += ' ' + phrase('caregiver_notified').ur;

    const clip = await getClip(primary.phraseKey);
    if (clip && !rb) audioOverride = clip;
    else fallbackAudio = clip;

    alertId = await insertAlert(patientId, patientTurnId, primary);
  } else {
    // ── Normal turn: the model speaks, grounded in memory ──
    replyUr = await generateReply({
      userTextUr, extraction, facts, features, patientId,
      name: (fact(facts, 'name') as string | undefined) ?? caregiverPhone?.display_name ?? undefined,
      amber: result.findings.filter((f) => f.severity === 'amber'),
    });
    for (const f of result.findings) {
      if (f.severity === 'amber') alertId = await insertAlert(patientId, patientTurnId, f);
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
    alertId, patientTurnId, agentTurnId,
  };
}

async function persistExtraction(patientId: string, turnId: string, ex: Extraction): Promise<void> {
  if (ex.glucose_mg_dl !== null) {
    await q(
      `INSERT INTO readings (patient_id, turn_id, mg_dl, context) VALUES ($1,$2,$3,$4)`,
      [patientId, turnId, ex.glucose_mg_dl, ex.glucose_context ?? 'random'],
    );
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

const PERSONA = `You are صحت ساتھی (SehatSaathi), a warm, patient health companion for a diabetes patient in Pakistan who may not read well. You speak SIMPLE spoken Urdu, like a caring family nurse — never clinical jargon, never English sentences (drug names are fine).

Hard rules:
- Maximum 3 short sentences. This is spoken aloud; long replies are not heard.
- If the patient gave a number, repeat it back first so they can correct you.
- Never prescribe, never change or suggest a dose, never tell them to stop a medicine, never diagnose. If asked, say warmly that this is the doctor's decision and offer to help them raise it.
- Use what you know about them (below). If there is an open concern from earlier, ask about it naturally in ONE sentence when relevant.
- Ground advice in the reference notes provided. Do not invent facts.
- End with one practical step or one gentle question.
- Output plain Urdu text only. No lists, no markdown, no emojis.`;

async function generateReply(a: {
  userTextUr: string;
  extraction: Extraction;
  facts: ProfileFact[];
  features: Features;
  patientId: string;
  name?: string;
  amber: Finding[];
}): Promise<string> {
  const [episodes, history, concerns, refs] = await Promise.all([
    recallEpisodes(a.patientId, a.userTextUr, 4),
    recentTurns(a.patientId, 6),
    dueConcerns(a.patientId),
    retrieve(`${a.extraction.notes_en} ${a.userTextUr}`, 3),
  ]);

  const ctx: string[] = [];
  if (a.name) ctx.push(`Patient name: ${a.name}`);
  const prof = describeProfile(a.facts);
  if (prof.length) ctx.push('Profile:\n- ' + prof.join('\n- '));
  ctx.push('Clinical picture:\n- ' + describeFeatures(a.features).join('\n- '));
  if (concerns.length) ctx.push('Open concerns to follow up (ask about at most one):\n- ' + concerns.map((c) => c.summary_ur + (c.summary_en ? ` (${c.summary_en})` : '')).join('\n- '));
  if (episodes.length) ctx.push('Relevant earlier things the patient said:\n- ' + episodes.map((e) => e.text_ur).join('\n- '));
  if (refs.length) ctx.push('Reference notes:\n- ' + refs.map((r) => `${r.title}: ${r.content}`).join('\n- '));
  if (a.amber.length) ctx.push('Rules engine flagged (include the advice, calmly): ' + a.amber.map((f) => f.reasonUr).join(' '));
  ctx.push(`Extracted from this turn: ${JSON.stringify({ glucose: a.extraction.glucose_mg_dl, context: a.extraction.glucose_context, symptoms: a.extraction.symptoms, meals: a.extraction.meals.map((m) => m.items).flat(), medication: a.extraction.medication, intent: a.extraction.intent })}`);

  const messages = [
    { role: 'system' as const, content: PERSONA + '\n\n' + ctx.join('\n\n') },
    ...history.slice(0, -1).map((t) => ({ role: (t.role === 'patient' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text_ur })),
    { role: 'user' as const, content: a.userTextUr },
  ];

  try {
    const out = await chat(messages, { model: MODELS.brain, temperature: 0.5, maxTokens: 220 });
    const clean = out.replace(/[*_#`]/g, '').trim();
    return clean.length > 3 ? clean : readback(a.extraction) + phrase('didnt_catch').ur;
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
          detail: { code: 'sustained_high' },
          followUpAt: new Date(Date.now() + 2 * 86_400_000),
        });
      }
      if (f.ruleId === 'AMBER_ADHERENCE') {
        await raiseConcern({
          patientId: a.patientId, kind: 'adherence',
          summaryUr: 'دوا کچھ دن رہ گئی تھی — کیا اب وقت پر لے رہے ہیں؟',
          summaryEn: 'Missed doses — check adherence',
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

export async function greeting(patientId: string): Promise<{ textUr: string; concerns: Concern[] }> {
  const [facts, features, concerns] = await Promise.all([
    getProfile(patientId), longitudinal(patientId), dueConcerns(patientId),
  ]);
  const name = fact(facts, 'name') as string | undefined;

  // Templated fallback that is already good — the model only polishes it.
  const parts: string[] = [name ? `السلام علیکم ${name}!` : 'السلام علیکم!'];
  if (concerns[0]) parts.push(concerns[0].summary_ur);
  else if (features.risingFastingDays >= 3) parts.push(`آپ کی صبح کی شوگر ${features.risingFastingDays} دن سے بڑھ رہی ہے۔ رات کا کھانا جلدی کر کے دیکھیں۔`);
  else if (features.adherenceStreakDays >= 3) parts.push(`بہت اچھا، آپ ${features.adherenceStreakDays} دن سے دوا وقت پر لے رہے ہیں۔`);
  else if (features.daysSinceLastReading !== null && features.daysSinceLastReading >= 2) parts.push('کچھ دن سے شوگر چیک نہیں ہوئی۔ آج ضرور چیک کریں۔');
  else parts.push('آج شوگر کتنی تھی یا طبیعت کیسی ہے؟');
  // Deliberately templated, not model-written. The opening line is spoken
  // before the patient has said anything, so there is no context to ground a
  // model in — and in testing the character model padded it with invented
  // words. The template is correct Urdu and already carries the memory.
  return { textUr: parts.join(' '), concerns };
}
