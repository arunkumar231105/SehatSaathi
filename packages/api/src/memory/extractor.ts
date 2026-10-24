/**
 * Tier-3 profile extraction. Runs AFTER the reply has been sent — it is not on
 * the latency path. Proposes profile deltas against a fixed key vocabulary;
 * engine.upsertFact() handles versioning, provenance and contradictions.
 */

import { chat, parseJson, MODELS } from '../llm/qwen.ts';
import { upsertFact, getProfile, type UpsertOutcome } from './engine.ts';
import { identify } from '../meds/reference.ts';

export const PROFILE_KEYS = [
  'name', 'name_en', 'age', 'gender', 'diabetes_type', 'diagnosis_year',
  'medications', 'insulin', 'comorbidities', 'allergies',
  'roti_per_meal', 'diet_habits', 'fasts_in_ramzan', 'exercise', 'smoking',
  'work', 'caregiver', 'literacy', 'lives_with', 'doctor', 'glucometer',
] as const;

const SYSTEM = `From this exchange with a Pakistani diabetes patient, extract durable facts about the PATIENT (not one-off readings).
Output ONLY JSON: {"facts":[{"key":string,"value":string|number|boolean|string[],"confidence":0..1}]}
Allowed keys: ${PROFILE_KEYS.join(', ')}.
Rules: only facts explicitly stated or clearly implied; confidence 0.9 if stated plainly, 0.6 if implied; medications as an array of "Name dose schedule" strings — ONLY when the patient says what they currently take or that they started/stopped one, and then the COMPLETE current list. Asking about a medicine ("what is Diamicron for?", "should I take Jardiance?") or mentioning someone else's is NOT a medications fact; empty list if nothing durable was said. Never include glucose numbers, symptoms or meals — those are logged elsewhere.`;

export async function extractProfile(args: {
  patientId: string;
  patientText: string;
  agentText: string;
  sourceTurnId: string;
}): Promise<{ key: string; outcome: UpsertOutcome }[]> {
  let raw: string;
  try {
    raw = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `PATIENT: ${args.patientText}\nAGENT: ${args.agentText}` },
      ],
      { model: MODELS.memory, temperature: 0, json: true, maxTokens: 300 },
    );
  } catch {
    return [];
  }
  const parsed = parseJson<{ facts?: { key?: string; value?: unknown; confidence?: number }[] }>(raw);
  const results: { key: string; outcome: UpsertOutcome }[] = [];
  for (const f of parsed?.facts ?? []) {
    if (!f.key || !(PROFILE_KEYS as readonly string[]).includes(f.key) || f.value === undefined || f.value === null) continue;
    if (f.key === 'medications' && (await isPartialMedicineList(args.patientId, f.value, args.patientText))) continue;
    const conf = typeof f.confidence === 'number' ? Math.max(0.3, Math.min(1, f.confidence)) : 0.6;
    const outcome = await upsertFact({
      patientId: args.patientId,
      key: f.key,
      value: f.value,
      confidence: conf,
      sourceTurnId: args.sourceTurnId,
    });
    results.push({ key: f.key, outcome });
  }
  return results;
}

/**
 * The extractor sometimes returns only the medicine a patient just asked
 * about — "What is Diamicron for?" became the whole list ["Diamicron"],
 * silently dropping Glucophage and raising a false contradiction. A proposed
 * list that only names medicines already on the record, and is shorter, is a
 * mention, not a change — unless the patient said they stopped something.
 */
async function isPartialMedicineList(patientId: string, value: unknown, patientText: string): Promise<boolean> {
  const proposed = Array.isArray(value) ? value.map(String) : [String(value)];
  const current = (await getProfile(patientId)).find((x) => x.key === 'medications')?.value;
  const currentList = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  if (!currentList.length || proposed.length >= currentList.length) return false;
  if (/\b(stop|stopped|quit|band|chhor|chor)\b|بند|چھوڑ/i.test(patientText)) return false;
  const known = new Set(currentList.flatMap((e) => identify(e).map((m) => m.id)));
  const named = proposed.flatMap((e) => identify(e).map((m) => m.id));
  return named.length > 0 && named.every((id) => known.has(id));
}
