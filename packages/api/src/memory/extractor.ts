/**
 * Tier-3 profile extraction. Runs AFTER the reply has been sent — it is not on
 * the latency path. Proposes profile deltas against a fixed key vocabulary;
 * engine.upsertFact() handles versioning, provenance and contradictions.
 */

import { chat, parseJson, MODELS } from '../llm/qwen.ts';
import { upsertFact, type UpsertOutcome } from './engine.ts';

export const PROFILE_KEYS = [
  'name', 'name_en', 'age', 'gender', 'diabetes_type', 'diagnosis_year',
  'medications', 'insulin', 'comorbidities', 'allergies',
  'roti_per_meal', 'diet_habits', 'fasts_in_ramzan', 'exercise', 'smoking',
  'work', 'caregiver', 'literacy', 'lives_with', 'doctor', 'glucometer',
] as const;

const SYSTEM = `From this exchange with a Pakistani diabetes patient, extract durable facts about the PATIENT (not one-off readings).
Output ONLY JSON: {"facts":[{"key":string,"value":string|number|boolean|string[],"confidence":0..1}]}
Allowed keys: ${PROFILE_KEYS.join(', ')}.
Rules: only facts explicitly stated or clearly implied; confidence 0.9 if stated plainly, 0.6 if implied; medications as an array of "Name dose schedule" strings; empty list if nothing durable was said. Never include glucose numbers, symptoms or meals — those are logged elsewhere.`;

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
