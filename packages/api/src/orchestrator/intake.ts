/**
 * Follow-up questions before advice.
 *
 * "My sugar is 250" on its own supports only generic advice. Was it fasting
 * or two hours after biryani? Was the morning Metformin skipped? Is there
 * vomiting? Each answer changes what the right next step is — and one of them
 * changes whether it is an emergency. So when a patient reports a reading or
 * a symptom, the companion asks a few short questions first, one per turn,
 * then gives a single recommendation tied to what it heard.
 *
 * Which question comes next is decided here, deterministically, from what is
 * still unknown — not by the model. That keeps the intake short (never more
 * than MAX_QUESTIONS), predictable, testable without an API key, and it
 * guarantees the danger-symptom question is asked whenever a reading is
 * high enough for ketoacidosis to matter. The model only phrases the question.
 *
 * Emergencies never wait for questions: a red finding on any turn ends the
 * intake and escalates immediately (see turn.ts).
 */

import type { Extraction } from './extract.ts';
import type { GlucoseContext, SymptomCode } from '../safety/rules.ts';

export type Slot = 'context' | 'food' | 'meds' | 'danger' | 'reading';

export const MAX_QUESTIONS = 3;
/** An unanswered intake is abandoned after this — the next message is treated as new. */
const TTL_MS = 30 * 60_000;

export interface Intake {
  startedAt: number;
  glucose: number | null;
  /** readings.id of the logged value, so a later "it was fasting" can correct its context. */
  readingId: string | null;
  context: GlucoseContext | null;
  meals: string[];
  medsTaken: boolean | null;
  symptoms: SymptomCode[];
  /** Slots already asked, answered or not — a slot is never asked twice. */
  asked: Slot[];
  /** The question awaiting an answer. */
  pending: Slot | null;
  /** Rule ids already alerted on in this intake, so amber alerts are not re-raised every turn. */
  alerted: string[];
  /** The patient's answers verbatim, for the final recommendation. */
  answers: { slot: Slot; text: string }[];
}

/** Readings worth asking about. A fasting 125 is not the same as a post-meal 125. */
export function isHigh(mgDl: number, ctx: GlucoseContext | null): boolean {
  return ctx === 'fasting' || ctx === 'pre_meal' ? mgDl > 130 : mgDl > 180;
}

const DANGER: SymptomCode[] = ['nausea', 'vomiting', 'abdominal_pain', 'rapid_breathing', 'fruity_breath', 'excessive_thirst'];

/** Should this turn open an intake? Questions, greetings and chit-chat get a direct answer instead. */
export function shouldStart(ex: Extraction): boolean {
  if (ex.intent === 'question' || ex.intent === 'greeting') return false;
  return ex.glucose_mg_dl !== null || ex.symptoms.length > 0;
}

export function start(ex: Extraction, readingId: string | null): Intake {
  return merge(
    {
      startedAt: Date.now(), glucose: null, readingId, context: null, meals: [], medsTaken: null,
      symptoms: [], asked: [], pending: null, alerted: [], answers: [],
    },
    ex,
    readingId,
  );
}

/** Fold one turn's extraction into the intake. Later values win. */
export function merge(it: Intake, ex: Extraction, readingId: string | null): Intake {
  const next = { ...it, symptoms: [...it.symptoms], meals: [...it.meals] };
  if (ex.glucose_mg_dl !== null) {
    next.glucose = ex.glucose_mg_dl;
    next.readingId = readingId ?? next.readingId;
    next.context = null;
  }
  if (ex.glucose_context && ex.glucose_context !== 'random') next.context = ex.glucose_context;
  for (const m of ex.meals) next.meals.push(...(m.items.length ? m.items : [m.description]).filter(Boolean));
  if (ex.medication.taken === true && ex.medication.missed !== true) next.medsTaken = true;
  if (ex.medication.missed === true || ex.medication.taken === false) next.medsTaken = false;
  for (const s of ex.symptoms) if (!next.symptoms.includes(s)) next.symptoms.push(s);
  return next;
}

/**
 * A short answer like "haan" or "nahi" means nothing to the extractor on its
 * own — but it is a complete answer to the question that was asked.
 */
export function applyYesNo(it: Intake, slot: Slot | null, text: string): Intake {
  const t = text.trim().toLowerCase();
  // "ji nahi" is a no, so the negative is checked anywhere and wins.
  const no = /نہیں|(^|\s)(nahi|nahin|nai|no|nope)(\s|$|[.,!؟?])/.test(t);
  const yes = !no && /^(ہاں|جی|haan|han|ha|ji|jee|yes|yeah)/.test(t);
  if (slot === 'meds' && it.medsTaken === null) {
    if (yes) return { ...it, medsTaken: true };
    if (no) return { ...it, medsTaken: false };
  }
  return it;
}

/**
 * The next thing worth knowing, or null when there is enough to advise.
 * Order matters: context changes how to read the number, food and medicine
 * explain it, and the danger check comes before advice on any very high value.
 */
export function nextSlot(it: Intake, opts: { hasMedicines: boolean }): Slot | null {
  if (it.asked.length >= MAX_QUESTIONS) return null;
  const can = (s: Slot) => !it.asked.includes(s);

  // A symptom with no number: the number decides almost everything.
  if (it.glucose === null) return can('reading') ? 'reading' : null;

  const high = isHigh(it.glucose, it.context);
  const veryHigh = it.glucose >= 250;
  const dangerKnown = it.symptoms.some((s) => DANGER.includes(s));

  // At 250+ the ketoacidosis check is the one that cannot be skipped, so it
  // must fit inside the question budget whatever else is unknown.
  const budget = MAX_QUESTIONS - it.asked.length;
  if (veryHigh && !dangerKnown && can('danger') && budget === 1) return 'danger';

  if (!it.context && can('context')) return 'context';
  if (!high) return null;                       // in range: no interrogation needed
  if (veryHigh && !dangerKnown && can('danger')) return 'danger';
  if (!it.meals.length && can('food')) return 'food';
  if (it.medsTaken === null && can('meds') && opts.hasMedicines) return 'meds';
  return null;
}

export function isExpired(it: Intake): boolean {
  return Date.now() - it.startedAt > TTL_MS;
}

/** Fallback wording, and the brief the model works from when it phrases the question. */
export const QUESTION: Record<Slot, { ur: string; en: string; brief: string }> = {
  context: {
    ur: 'یہ شوگر خالی پیٹ چیک کی تھی یا کھانے کے بعد؟',
    en: 'Did you check this sugar on an empty stomach, or after eating?',
    brief: 'whether this reading was taken fasting (empty stomach, morning) or after a meal, and roughly how long after',
  },
  food: {
    ur: 'آج آپ نے کیا کھایا تھا؟ صبح ناشتے میں اور پچھلے کھانے میں؟',
    en: 'What did you eat today — at breakfast and at your last meal?',
    brief: 'what they ate today — breakfast and the last meal before the reading (rotis, rice, sweets, chai with sugar)',
  },
  meds: {
    ur: 'کیا آج آپ نے اپنی شوگر کی دوا وقت پر لی تھی؟',
    en: 'Did you take your diabetes medicine on time today?',
    brief: 'whether they took their diabetes medicine on time today',
  },
  danger: {
    ur: 'کیا ساتھ میں الٹی، پیٹ میں درد، سانس تیز چلنا یا بہت زیادہ پیاس لگ رہی ہے؟',
    en: 'Along with this, do you have vomiting, stomach pain, fast breathing, or very strong thirst?',
    brief: 'whether they have vomiting, stomach pain, fast breathing or very strong thirst right now',
  },
  reading: {
    ur: 'کیا آپ نے آج شوگر چیک کی؟ کتنی تھی؟ اگر نہیں کی تو ابھی چیک کر کے بتائیں۔',
    en: 'Have you checked your sugar today? What was it? If not, please check now and tell me.',
    brief: 'whether they have checked their sugar today and what the number was — and if not, to check it now',
  },
};

/**
 * The question for a slot, given what is already known. A high fasting
 * reading is explained by last night's dinner, not this morning's breakfast.
 */
export function questionFor(slot: Slot, it: Intake): { ur: string; en: string; brief: string } {
  if (slot === 'food' && (it.context === 'fasting' || it.context === 'pre_meal')) {
    return {
      ur: 'کل رات کھانے میں کیا کھایا تھا، اور کتنے بجے کھایا تھا؟',
      en: 'What did you eat for dinner last night, and what time did you eat?',
      brief: 'what they ate for dinner last night and how late they ate it (a late, heavy dinner raises morning sugar)',
    };
  }
  return QUESTION[slot];
}

/** What the patient told us, as notes for the final recommendation. */
export function summarise(it: Intake): string[] {
  const out: string[] = [];
  if (it.glucose !== null) out.push(`Reading: ${it.glucose} mg/dL${it.context ? ` (${it.context.replace('_', ' ')})` : ' (timing not known)'}`);
  if (it.meals.length) out.push(`Ate: ${it.meals.join(', ')}`);
  if (it.medsTaken !== null) out.push(it.medsTaken ? 'Took diabetes medicine on time today' : 'Missed / did not take diabetes medicine today');
  if (it.symptoms.length) out.push(`Symptoms: ${it.symptoms.join(', ').replace(/_/g, ' ')}`);
  else if (it.asked.includes('danger')) out.push('Says no vomiting, stomach pain, fast breathing or heavy thirst');
  for (const a of it.answers) out.push(`Answer to the ${a.slot} question, in their words: «${a.text}»`);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-session state. Held in process: an intake lives for a few minutes,
// a restart only means the next message is answered directly, and keeping it
// out of the database avoids a schema migration on a running deployment.
// ─────────────────────────────────────────────────────────────────────────
const store = new Map<string, Intake>();

export function getIntake(sessionId: string): Intake | null {
  const it = store.get(sessionId);
  if (!it) return null;
  if (isExpired(it)) { store.delete(sessionId); return null; }
  return it;
}
export function saveIntake(sessionId: string, it: Intake): void { store.set(sessionId, it); }
export function clearIntake(sessionId: string): void { store.delete(sessionId); }
