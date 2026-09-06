/**
 * The memory engine — four tiers, each with an explicit read and write path.
 *
 *   1. Working      — the session's recent turns (held by the caller)
 *   2. Episodic     — every utterance, embedded, semantically recallable
 *   3. Profile      — structured facts with provenance + confidence, versioned
 *   4. Longitudinal — glucose / meal / medication time-series and the derived
 *                     features (time-in-range, dawn phenomenon, adherence)
 *
 * Nothing here calls the chat model. Tier 3 extraction lives in extractor.ts;
 * this file is storage, retrieval and arithmetic, so it can be tested without
 * a model in the loop.
 */

import { q, one, vec } from '../db/client.ts';
import { embed } from '../llm/qwen.ts';

// ─────────────────────────────────────────────────────────────────────────
// Tier 2 — episodic
// ─────────────────────────────────────────────────────────────────────────

export async function storeTurn(args: {
  patientId: string;
  sessionId: string;
  role: 'patient' | 'agent';
  textUr: string;
  textEn?: string;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO turns (session_id, patient_id, role, text_ur, text_en)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [args.sessionId, args.patientId, args.role, args.textUr, args.textEn ?? null],
  );
  const id = row!.id;
  // Embed off the critical path — the reply must not wait on a vector.
  void embedTurn(id, args.textUr, args.textEn);
  return id;
}

async function embedTurn(id: string, ur: string, en?: string): Promise<void> {
  try {
    const v = await embed(en ? `${ur}\n${en}` : ur);
    await q(`UPDATE turns SET embedding = $1 WHERE id = $2`, [vec(v), id]);
  } catch {
    /* recall degrades gracefully to recency-only for this turn */
  }
}

export interface Episode {
  id: string;
  role: string;
  text_ur: string;
  text_en: string | null;
  created_at: Date;
  score: number;
}

/**
 * Semantic recall with recency decay. A turn from yesterday about the same
 * topic should outrank one from a month ago, but not so strongly that old,
 * highly relevant history disappears.
 */
export async function recallEpisodes(patientId: string, query: string, k = 5): Promise<Episode[]> {
  let v: number[];
  try {
    v = await embed(query);
  } catch {
    return [];
  }
  return q<Episode>(
    `SELECT id, role, text_ur, text_en, created_at,
            (1 - (embedding <=> $2)) * exp(-EXTRACT(EPOCH FROM (now() - created_at)) / (30*86400.0)) AS score
     FROM turns
     WHERE patient_id = $1 AND embedding IS NOT NULL AND role = 'patient'
     ORDER BY score DESC
     LIMIT $3`,
    [patientId, vec(v), k],
  );
}

export async function recentTurns(patientId: string, n = 8) {
  const rows = await q<{ role: string; text_ur: string; created_at: Date }>(
    `SELECT role, text_ur, created_at FROM turns
     WHERE patient_id = $1 AND text_ur IS NOT NULL
     ORDER BY created_at DESC LIMIT $2`,
    [patientId, n],
  );
  return rows.reverse();
}

// ─────────────────────────────────────────────────────────────────────────
// Tier 3 — profile facts with provenance
// ─────────────────────────────────────────────────────────────────────────

export interface ProfileFact {
  id: string;
  key: string;
  value: unknown;
  confidence: number;
  source_turn_id: string | null;
  learned_at: Date;
  supersedes: string | null;
}

export async function getProfile(patientId: string): Promise<ProfileFact[]> {
  return q<ProfileFact>(
    `SELECT id, key, value, confidence, source_turn_id, learned_at, supersedes
     FROM profile_facts WHERE patient_id = $1 AND active ORDER BY key`,
    [patientId],
  );
}

export type UpsertOutcome = 'inserted' | 'confirmed' | 'superseded' | 'contradiction';

/**
 * Write a fact without destroying history.
 *
 *  - new key            -> insert
 *  - same value         -> raise confidence (repetition is evidence)
 *  - different value    -> supersede the old row (it stays, inactive, linked)
 *                          AND, if the old fact was itself well-established,
 *                          raise a contradiction concern so the agent re-asks
 *                          instead of silently trusting the newest utterance.
 */
export async function upsertFact(args: {
  patientId: string;
  key: string;
  value: unknown;
  confidence: number;
  sourceTurnId?: string | null;
}): Promise<UpsertOutcome> {
  const cur = await one<ProfileFact>(
    `SELECT id, key, value, confidence, source_turn_id, learned_at, supersedes
     FROM profile_facts WHERE patient_id=$1 AND key=$2 AND active`,
    [args.patientId, args.key],
  );

  if (!cur) {
    await q(
      `INSERT INTO profile_facts (patient_id, key, value, confidence, source_turn_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [args.patientId, args.key, JSON.stringify(args.value), args.confidence, args.sourceTurnId ?? null],
    );
    return 'inserted';
  }

  if (JSON.stringify(cur.value) === JSON.stringify(args.value)) {
    await q(`UPDATE profile_facts SET confidence = LEAST(1, confidence + 0.15) WHERE id = $1`, [cur.id]);
    return 'confirmed';
  }

  // Different value. Always record the new one (superseding), but flag a
  // contradiction when we are overwriting something we were sure about.
  await q(`UPDATE profile_facts SET active = false WHERE id = $1`, [cur.id]);
  await q(
    `INSERT INTO profile_facts (patient_id, key, value, confidence, source_turn_id, supersedes)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [args.patientId, args.key, JSON.stringify(args.value), args.confidence, args.sourceTurnId ?? null, cur.id],
  );

  if (cur.confidence >= 0.7) {
    await raiseConcern({
      patientId: args.patientId,
      kind: 'contradiction',
      summaryUr: contradictionUr(args.key, cur.value, args.value),
      summaryEn: `Conflicting "${args.key}": earlier ${JSON.stringify(cur.value)}, now ${JSON.stringify(args.value)}`,
      summaryEnPatient: contradictionEn(args.key, cur.value, args.value),
      detail: { key: args.key, previous: cur.value, current: args.value },
      followUpAt: new Date(),
    });
    return 'contradiction';
  }
  return 'superseded';
}

const KEY_UR: Record<string, string> = {
  medications: 'دوا',
  diabetes_type: 'ذیابیطس کی قسم',
  roti_per_meal: 'روٹی کی تعداد',
  fasts_in_ramzan: 'رمضان کے روزے',
  caregiver: 'گھر کا رابطہ',
  age: 'عمر',
  diagnosis_year: 'تشخیص کا سال',
  comorbidities: 'دیگر بیماریاں',
  work: 'کام',
  diet_habits: 'کھانے کی عادت',
  insulin: 'انسولین',
  smoking: 'سگریٹ',
  exercise: 'ورزش',
};

const KEY_EN: Record<string, string> = {
  medications: "your medicine", diabetes_type: "your diabetes type", roti_per_meal: "how many rotis you eat",
  fasts_in_ramzan: "fasting in Ramzan", caregiver: "your family contact", age: "your age",
  diagnosis_year: "when you were diagnosed", comorbidities: "your other conditions", work: "your work",
  diet_habits: "your eating habits", insulin: "insulin", smoking: "smoking", exercise: "exercise",
};

function contradictionEn(key: string, prev: unknown, cur: unknown): string {
  return `Earlier you told me ${shortEn(prev)} about ${KEY_EN[key] ?? key}, and now ${shortEn(cur)}. Which one is right?`;
}

function shortEn(v: unknown): string {
  const s = Array.isArray(v) ? v.map(String).join(", ")
    : typeof v === "boolean" ? (v ? "yes" : "no")
    : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

function contradictionUr(key: string, prev: unknown, cur: unknown): string {
  const k = KEY_UR[key] ?? key;
  return `پہلے آپ نے ${k} کے بارے میں ${short(prev)} بتایا تھا، اب ${short(cur)}۔ صحیح کون سا ہے؟`;
}

/** Human form for a fact value — this text is spoken aloud, so no JSON. */
function short(v: unknown): string {
  const s = Array.isArray(v) ? v.map(String).join('، ')
    : typeof v === 'boolean' ? (v ? 'ہاں' : 'نہیں')
    : typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

// ─────────────────────────────────────────────────────────────────────────
// Tier 4 — longitudinal clinical memory
// ─────────────────────────────────────────────────────────────────────────

export interface Reading {
  mg_dl: number;
  context: string | null;
  taken_at: Date;
}

export interface Features {
  readings: Reading[];
  mean7: number | null;
  mean14: number | null;
  mean30: number | null;
  /** % of last-14-day readings within 70–180 mg/dL. */
  timeInRange14: number | null;
  /** Fasting readings consistently elevated over recent mornings. */
  dawnPhenomenon: boolean;
  /** Last 5 fasting readings rising day over day. */
  risingFastingDays: number;
  postMealSpikes7: number;
  /** Foods most often eaten before a >200 post-meal reading. */
  spikeFoods: string[];
  missedDoses7: number;
  takenDoses7: number;
  adherenceStreakDays: number;
  lastReadingAt: Date | null;
  daysSinceLastReading: number | null;
}

export async function longitudinal(patientId: string): Promise<Features> {
  const readings = await q<Reading>(
    `SELECT mg_dl, context, taken_at FROM readings
     WHERE patient_id = $1 AND taken_at > now() - interval '30 days'
     ORDER BY taken_at ASC`,
    [patientId],
  );
  const meds = await q<{ taken: boolean; occurred_at: Date }>(
    `SELECT taken, occurred_at FROM med_events
     WHERE patient_id = $1 AND occurred_at > now() - interval '14 days'
     ORDER BY occurred_at ASC`,
    [patientId],
  );
  const meals = await q<{ items: string[] | null; eaten_at: Date }>(
    `SELECT items, eaten_at FROM meals
     WHERE patient_id = $1 AND eaten_at > now() - interval '14 days'`,
    [patientId],
  );

  const now = Date.now();
  const days = (d: Date) => (now - new Date(d).getTime()) / 86_400_000;
  const within = (n: number) => readings.filter((r) => days(r.taken_at) <= n);
  const mean = (xs: Reading[]) =>
    xs.length ? Math.round(xs.reduce((s, r) => s + r.mg_dl, 0) / xs.length) : null;

  const r14 = within(14);
  const inRange = r14.filter((r) => r.mg_dl >= 70 && r.mg_dl <= 180).length;

  // Dawn phenomenon: fasting readings over the last 5 mornings mostly >130.
  const fasting5 = readings.filter((r) => r.context === 'fasting' && days(r.taken_at) <= 5);
  const dawn = fasting5.length >= 3 && fasting5.filter((r) => r.mg_dl > 130).length / fasting5.length >= 0.6;

  // Rising trend: count consecutive day-over-day increases at the tail.
  const fastingAll = readings.filter((r) => r.context === 'fasting').slice(-6);
  let rising = 0;
  for (let i = fastingAll.length - 1; i > 0; i--) {
    if (fastingAll[i]!.mg_dl > fastingAll[i - 1]!.mg_dl) rising++;
    else break;
  }

  // Post-meal spikes and the foods that precede them.
  const spikes = readings.filter((r) => r.context === 'post_meal' && r.mg_dl > 200 && days(r.taken_at) <= 7);
  const foodCount = new Map<string, number>();
  for (const s of spikes) {
    const t = new Date(s.taken_at).getTime();
    for (const m of meals) {
      const mt = new Date(m.eaten_at).getTime();
      if (mt <= t && t - mt <= 3 * 3_600_000) {
        for (const it of m.items ?? []) foodCount.set(it, (foodCount.get(it) ?? 0) + 1);
      }
    }
  }
  const spikeFoods = [...foodCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f);

  // Adherence.
  const m7 = meds.filter((m) => days(m.occurred_at) <= 7);
  const missed7 = m7.filter((m) => !m.taken).length;
  const taken7 = m7.filter((m) => m.taken).length;
  let streak = 0;
  for (let d = 0; d < 14; d++) {
    const dayEvents = meds.filter((m) => Math.floor(days(m.occurred_at)) === d);
    if (dayEvents.length && dayEvents.every((m) => m.taken)) streak++;
    else break;
  }

  const last = readings.at(-1);
  return {
    readings,
    mean7: mean(within(7)),
    mean14: mean(r14),
    mean30: mean(readings),
    timeInRange14: r14.length ? Math.round((inRange / r14.length) * 100) : null,
    dawnPhenomenon: dawn,
    risingFastingDays: rising,
    postMealSpikes7: spikes.length,
    spikeFoods,
    missedDoses7: missed7,
    takenDoses7: taken7,
    adherenceStreakDays: streak,
    lastReadingAt: last ? last.taken_at : null,
    daysSinceLastReading: last ? Math.floor(days(last.taken_at)) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Open concerns — the engine behind unprompted follow-up
// ─────────────────────────────────────────────────────────────────────────

export interface Concern {
  id: string;
  kind: 'symptom' | 'contradiction' | 'adherence' | 'trend';
  summary_ur: string;
  summary_en: string | null;
  detail: Record<string, unknown> | null;
  raised_at: Date;
  follow_up_at: Date | null;
  resolved_at: Date | null;
}

export async function raiseConcern(args: {
  patientId: string;
  kind: Concern['kind'];
  summaryUr: string;
  /** Clinician note — shown on the caregiver dashboard. */
  summaryEn?: string;
  /** Patient-facing English — what is spoken in English mode. */
  summaryEnPatient?: string;
  detail?: Record<string, unknown>;
  followUpAt?: Date;
}): Promise<void> {
  // One open concern per (kind, code/key) — repeating a symptom should not
  // stack duplicate follow-ups.
  const code = (args.detail?.code ?? args.detail?.key) as string | undefined;
  if (code) {
    const dup = await one(
      `SELECT id FROM open_concerns
       WHERE patient_id=$1 AND kind=$2 AND resolved_at IS NULL
         AND (detail->>'code' = $3 OR detail->>'key' = $3)`,
      [args.patientId, args.kind, code],
    );
    if (dup) return;
  }
  await q(
    `INSERT INTO open_concerns (patient_id, kind, summary_ur, summary_en, detail, follow_up_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      args.patientId,
      args.kind,
      args.summaryUr,
      args.summaryEn ?? null,
      JSON.stringify({ ...(args.detail ?? {}), ...(args.summaryEnPatient ? { en_patient: args.summaryEnPatient } : {}) }),
      args.followUpAt ?? null,
    ],
  );
}

export async function openConcerns(patientId: string): Promise<Concern[]> {
  return q<Concern>(
    `SELECT id, kind, summary_ur, summary_en, detail, raised_at, follow_up_at, resolved_at
     FROM open_concerns WHERE patient_id = $1 AND resolved_at IS NULL
     ORDER BY raised_at ASC`,
    [patientId],
  );
}

/** Concerns whose follow-up time has arrived — what the agent should bring up. */
export async function dueConcerns(patientId: string): Promise<Concern[]> {
  return q<Concern>(
    `SELECT id, kind, summary_ur, summary_en, detail, raised_at, follow_up_at, resolved_at
     FROM open_concerns
     WHERE patient_id = $1 AND resolved_at IS NULL AND (follow_up_at IS NULL OR follow_up_at <= now())
     ORDER BY raised_at ASC LIMIT 3`,
    [patientId],
  );
}

export async function resolveConcernsByCode(patientId: string, codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  const rows = await q(
    `UPDATE open_concerns SET resolved_at = now()
     WHERE patient_id=$1 AND resolved_at IS NULL AND detail->>'code' = ANY($2::text[])
     RETURNING id`,
    [patientId, codes],
  );
  return rows.length;
}

export async function resolveConcern(id: string): Promise<void> {
  await q(`UPDATE open_concerns SET resolved_at = now() WHERE id = $1`, [id]);
}

// ─────────────────────────────────────────────────────────────────────────
// Context pack — what the brain sees, capped so latency stays flat
// ─────────────────────────────────────────────────────────────────────────

export function describeFeatures(f: Features): string[] {
  const out: string[] = [];
  if (f.lastReadingAt) {
    const last = f.readings.at(-1)!;
    out.push(`Last reading: ${last.mg_dl} mg/dL (${last.context ?? 'unknown context'}), ${f.daysSinceLastReading} day(s) ago.`);
  } else out.push('No glucose readings on record yet.');
  if (f.mean7 !== null) out.push(`7-day mean ${f.mean7}; 14-day mean ${f.mean14}; time-in-range (70–180) last 14 days: ${f.timeInRange14}%.`);
  if (f.dawnPhenomenon) out.push('Fasting readings are consistently elevated over recent mornings (dawn phenomenon pattern).');
  if (f.risingFastingDays >= 3) out.push(`Fasting readings have risen ${f.risingFastingDays} days in a row.`);
  if (f.postMealSpikes7) out.push(`${f.postMealSpikes7} post-meal spike(s) >200 this week${f.spikeFoods.length ? `, most often after: ${f.spikeFoods.join(', ')}` : ''}.`);
  if (f.missedDoses7) out.push(`${f.missedDoses7} missed medication dose(s) in the last 7 days.`);
  else if (f.adherenceStreakDays >= 3) out.push(`Medication taken every day for ${f.adherenceStreakDays} days — worth praising.`);
  return out;
}

export function describeProfile(facts: ProfileFact[]): string[] {
  return facts.map((f) => `${f.key}: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`);
}
