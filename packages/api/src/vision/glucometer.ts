/**
 * Read a blood-sugar number from a photo of a glucometer.
 *
 * For a patient who cannot easily type, photographing the meter is the
 * shortest path from a reading to the record. A vision model reads the
 * display; the number is then CONFIRMED by the patient (web) or read back
 * with a correction prompt (WhatsApp) before it is treated as a reading —
 * a misread 45 for 245 must not be able to raise a false emergency silently.
 *
 * Meters show "HI" above their range (usually 600 mg/dL) and "LO" below it
 * (usually 20): both are emergencies and are mapped to those bounds.
 */

import { parseJson } from '../llm/qwen.ts';

export interface MeterReading {
  mgDl: number | null;
  /** What was on the screen, e.g. "245 mg/dL", "8.4 mmol/L", "HI". */
  display: string | null;
  flag: 'hi' | 'lo' | null;
  confidence: number;
  isMeter: boolean;
}

const PROMPT = `You are reading the screen of a blood glucose meter (glucometer) in a photo.
Return ONLY JSON: {"is_glucometer": boolean, "display": string|null, "value": number|null, "unit": "mg/dL"|"mmol/L"|null, "hi_lo": "HI"|"LO"|null, "confidence": number}
- "display": exactly what the main number area shows, e.g. "245", "8.4", "HI", "LO".
- "value": the main glucose number only — not the time, date, memory number or temperature.
- "unit": as printed on the screen; if no unit is visible and the value is above 35, use "mg/dL"; if it has a decimal point and is below 35, use "mmol/L".
- "hi_lo": set when the screen shows HI or LO instead of a number.
- "confidence": 0 to 1 — how sure you are of the digits. Blurry, glare or partly hidden digits mean low confidence.
If this is not a glucometer screen, return is_glucometer false and value null. Never guess digits you cannot see.`;

async function ask(model: string, base: string, key: string, image: string): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 200,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: image } }] }],
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`vision ${model} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
}

/**
 * Which vision models exist differs per account and changes over time, so
 * this is a list tried in order ("provider:model"), not one hard-coded name.
 * The first that answers is remembered for the life of the process.
 * Override with MODEL_VISION="dashscope:qwen3-vl-plus,groq:…".
 */
// Groq's qwen3.8-27b reads images on this project's key; the Model Studio
// vision models are listed but need purchasing, so they are the fallbacks.
const CANDIDATES = (process.env.MODEL_VISION ?? 'groq:qwen/qwen3.8-27b,dashscope:qwen3-vl-plus,dashscope:qwen3.8-omni-flash')
  .split(',').map((s) => s.trim()).filter(Boolean);
let working: string | null = null;

function endpoint(c: string): { base: string; key: string | undefined; model: string } {
  const [provider, ...rest] = c.split(':');
  const model = rest.join(':');
  return provider === 'groq'
    ? { base: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model }
    : { base: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', key: process.env.DASHSCOPE_API_KEY, model };
}

async function vision(image: string): Promise<string> {
  const order = working ? [working, ...CANDIDATES.filter((c) => c !== working)] : CANDIDATES;
  let last: unknown = new Error('no vision model configured');
  for (const c of order) {
    const { base, key, model } = endpoint(c);
    if (!key) continue;
    try {
      // A free-tier rate limit is momentary: one short wait beats failing the patient's photo.
      const out = await ask(model, base, key, image).catch(async (err) => {
        if (!/ 429:/.test(err instanceof Error ? err.message : '')) throw err;
        await new Promise((r) => setTimeout(r, 2500));
        return ask(model, base, key, image);
      });
      if (working !== c) { working = c; console.info('vision: using', c); }
      return out;
    } catch (err) {
      last = err;
      console.warn('vision: candidate failed', c, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }
  throw last;
}

/** Pure: turn the model's JSON into a reading we are willing to show the patient. */
export function interpret(raw: unknown): MeterReading {
  const j = (raw ?? {}) as { is_glucometer?: boolean; display?: string | null; value?: number | null; unit?: string | null; hi_lo?: string | null; confidence?: number };
  const confidence = typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0;
  const display = j.display ? String(j.display).slice(0, 20) : null;
  const base = { display, confidence, isMeter: j.is_glucometer !== false };
  const hl = (j.hi_lo ?? display ?? '').toString().trim().toUpperCase();
  if (hl === 'HI') return { ...base, mgDl: 600, flag: 'hi' };
  if (hl === 'LO') return { ...base, mgDl: 20, flag: 'lo' };
  if (typeof j.value !== 'number' || !Number.isFinite(j.value) || j.is_glucometer === false) return { ...base, mgDl: null, flag: null };
  const mmol = j.unit === 'mmol/L' || (j.unit == null && j.value < 35);
  const mg = Math.round(mmol ? j.value * 18 : j.value);
  // Outside what a meter can display is a misread, not a reading.
  if (mg < 20 || mg > 600) return { ...base, mgDl: null, flag: null };
  return { ...base, mgDl: mg, flag: null };
}

export async function readGlucometer(imageDataUrl: string): Promise<MeterReading> {
  return interpret(parseJson(await vision(imageDataUrl)));
}

/** The words the reading is processed as, so triage and the follow-up questions see an ordinary report. */
export function readingAsText(r: MeterReading, lang: 'ur' | 'en'): string {
  if (r.flag === 'hi') return lang === 'en' ? 'My sugar meter shows HI — my sugar is above 600' : 'میرا شوگر میٹر HI دکھا رہا ہے، شوگر 600 سے زیادہ ہے';
  if (r.flag === 'lo') return lang === 'en' ? 'My sugar meter shows LO — my sugar is below 20' : 'میرا شوگر میٹر LO دکھا رہا ہے، شوگر 20 سے کم ہے';
  return lang === 'en' ? `My sugar is ${r.mgDl}` : `میری شوگر ${r.mgDl} ہے`;
}
