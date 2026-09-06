/**
 * Structured clinical extraction from a patient utterance.
 *
 * The character model does not support native tool calling, so instead of
 * letting it "decide" to call log_glucose we ask for one strict JSON object
 * per turn and feed that to the deterministic safety rules. This is the
 * better design for a health app anyway: every value the rules act on is
 * visible, typed and stored — nothing is decided inside a prompt.
 */

import { chat, parseJson, MODELS } from '../llm/qwen.ts';
import type { SymptomCode, GlucoseContext } from '../safety/rules.ts';

export const SYMPTOM_CODES: SymptomCode[] = [
  'dizziness', 'sweating', 'shakiness', 'confusion', 'palpitations',
  'nausea', 'vomiting', 'abdominal_pain', 'rapid_breathing', 'fruity_breath',
  'chest_pain', 'one_sided_weakness', 'slurred_speech', 'sudden_vision_loss',
  'foot_ulcer', 'non_healing_wound', 'spreading_redness',
  'foot_numbness', 'tingling', 'blurred_vision', 'weight_loss',
  'excessive_thirst', 'frequent_urination', 'fatigue',
];

export interface Extraction {
  glucose_mg_dl: number | null;
  glucose_context: GlucoseContext | null;
  symptoms: SymptomCode[];
  /** Symptoms the patient says have improved/resolved — closes open concerns. */
  symptoms_improved: SymptomCode[];
  meals: { description: string; items: string[] }[];
  medication: { taken: boolean | null; missed: boolean | null; name: string | null };
  intent: 'log' | 'question' | 'greeting' | 'emergency' | 'other';
  is_pregnant: boolean | null;
  /** One-line English gist for the memory extractor and the caregiver view. */
  notes_en: string;
}

const EMPTY: Extraction = {
  glucose_mg_dl: null,
  glucose_context: null,
  symptoms: [],
  symptoms_improved: [],
  meals: [],
  medication: { taken: null, missed: null, name: null },
  intent: 'other',
  is_pregnant: null,
  notes_en: '',
};

const SYSTEM = `You extract clinical facts from what a Pakistani diabetes patient said (Urdu script, Roman Urdu, or mixed with English).
Output ONLY a JSON object with exactly these keys:
{
 "glucose_mg_dl": number|null,          // convert Urdu/Roman numerals: "دو سو پچاس"/"dhai sau"/"250" -> 250. If mmol/L given (e.g. 8.5), convert x18.
 "glucose_context": "fasting"|"pre_meal"|"post_meal"|"random"|"bedtime"|null,  // "subah khali pait"/"nashta se pehle" -> fasting; "khane ke baad" -> post_meal
 "symptoms": string[],                  // ONLY from: ${SYMPTOM_CODES.join(', ')}
 "symptoms_improved": string[],         // same codes, only if patient says it is better/gone now
 "meals": [{"description": string, "items": string[]}],   // items in English: roti, naan, biryani, daal, chawal, chai (sugar), lassi, samosa, sohan halwa, fruit...
 "medication": {"taken": boolean|null, "missed": boolean|null, "name": string|null},
 "intent": "log"|"question"|"greeting"|"emergency"|"other",
 "is_pregnant": boolean|null,
 "notes_en": string                     // one short English sentence summarising what was said
}
Mapping hints: chakkar -> dizziness; pasina -> sweating; kapkapi -> shakiness; ulti -> vomiting; matli -> nausea; pait dard -> abdominal_pain; seenay mein dard -> chest_pain; paon sun -> foot_numbness; suiyan/jhunjhunahat -> tingling; zakham -> non_healing_wound or foot_ulcer; nazar dhundli -> blurred_vision; pyaas -> excessive_thirst; bar bar peshab -> frequent_urination; kamzori/thakan -> fatigue; wazan kam -> weight_loss.
Never invent a glucose number that was not said. Unknown -> null.`;

export async function extractClinical(userText: string): Promise<Extraction> {
  let raw = '';
  try {
    raw = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userText },
      ],
      { model: MODELS.memory, temperature: 0, json: true, maxTokens: 400 },
    );
  } catch {
    return { ...EMPTY, notes_en: userText.slice(0, 120) };
  }

  const parsed = parseJson<Partial<Extraction>>(raw);
  if (!parsed) return { ...EMPTY, notes_en: userText.slice(0, 120) };

  const codes = (xs: unknown): SymptomCode[] =>
    Array.isArray(xs)
      ? xs.filter((x): x is SymptomCode => SYMPTOM_CODES.includes(x as SymptomCode))
      : [];

  const g = typeof parsed.glucose_mg_dl === 'number' ? Math.round(parsed.glucose_mg_dl) : null;
  const ctxOk = ['fasting', 'pre_meal', 'post_meal', 'random', 'bedtime'];

  return {
    // Physiologically impossible values are almost always ASR errors
    // ("25" for "250", or "2500"); drop them rather than triage on them.
    glucose_mg_dl: g !== null && g >= 20 && g <= 900 ? g : null,
    glucose_context: ctxOk.includes(parsed.glucose_context as string)
      ? (parsed.glucose_context as GlucoseContext)
      : null,
    symptoms: codes(parsed.symptoms),
    symptoms_improved: codes(parsed.symptoms_improved),
    meals: Array.isArray(parsed.meals)
      ? parsed.meals
          .filter((m): m is { description: string; items: string[] } => !!m && typeof m === 'object')
          .map((m) => ({
            description: String(m.description ?? ''),
            items: Array.isArray(m.items) ? m.items.map(String) : [],
          }))
      : [],
    medication: {
      taken: typeof parsed.medication?.taken === 'boolean' ? parsed.medication.taken : null,
      missed: typeof parsed.medication?.missed === 'boolean' ? parsed.medication.missed : null,
      name: parsed.medication?.name ? String(parsed.medication.name) : null,
    },
    intent: (['log', 'question', 'greeting', 'emergency', 'other'] as const).includes(
      parsed.intent as Extraction['intent'],
    )
      ? (parsed.intent as Extraction['intent'])
      : 'other',
    is_pregnant: typeof parsed.is_pregnant === 'boolean' ? parsed.is_pregnant : null,
    notes_en: String(parsed.notes_en ?? '').slice(0, 200),
  };
}
