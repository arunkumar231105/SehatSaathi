/**
 * Urdu speech input — Groq Whisper large-v3.
 *
 * Whisper covers 99+ languages including Urdu, and Groq serves it fast enough
 * (typically a few hundred ms for a short utterance) that it fits inside a
 * conversational latency budget.
 *
 * Two things matter for this specific audience:
 *
 *   - Pakistani speakers code-switch constantly: "aaj sugar 250 tha" mixes
 *     Urdu grammar with English clinical nouns. Pinning language=ur keeps the
 *     transcript in Urdu script instead of flapping between languages
 *     mid-sentence.
 *   - Numbers are the highest-stakes token in the whole app. A misheard "250"
 *     as "150" changes the clinical picture, so the orchestrator always reads
 *     the parsed value back to the patient for confirmation before acting.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = process.env.GROQ_ASR_MODEL ?? 'whisper-large-v3';

export interface TranscriptionResult {
  text: string;
  /** Wall-clock ms for the API round trip, for the latency budget. */
  latencyMs: number;
}

/** Wrap raw PCM as a WAV — Whisper needs a container, not bare samples. */
export function pcmToWav(pcm: Buffer, sampleRate = 16_000): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Nudges Whisper toward this domain's vocabulary. Whisper weights the prompt
 * as preceding context, so seeding it with the words we expect measurably
 * improves drug names and the Urdu/English mixture patients actually speak.
 */
const DOMAIN_PROMPT =
  'ذیابیطس، شوگر، انسولین، میٹفارمین، گلوکوفاج، بلڈ شوگر، چکر، متلی، پیاس، ' +
  'روٹی، چاول، دال، چائے، دوا، ڈاکٹر، ہسپتال، پاؤں، سن، زخم۔ ' +
  'sugar, insulin, metformin, glucose, check, fasting, mg/dL.';

export async function transcribeUrdu(pcm16k: Buffer): Promise<TranscriptionResult> {
  return transcribeFile(pcmToWav(pcm16k), 'audio.wav', 'audio/wav');
}

/**
 * Any container Whisper accepts — used for WhatsApp voice notes, which arrive
 * as ogg/opus and are sent through untouched rather than decoded first.
 */
export async function transcribeFile(data: Buffer, filename: string, mime: string): Promise<TranscriptionResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is not set');

  const started = Date.now();
  const form = new FormData();
  // Copy into a plain Uint8Array: Node's Buffer may be backed by a
  // SharedArrayBuffer, which Blob's types (correctly) reject.
  form.append('file', new Blob([new Uint8Array(data)], { type: mime }), filename);
  form.append('model', MODEL);
  form.append('language', 'ur');
  form.append('prompt', DOMAIN_PROMPT);
  form.append('response_format', 'json');
  // Greedy decoding: deterministic, and we never want Whisper inventing a
  // plausible-sounding glucose number that was not said.
  form.append('temperature', '0');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`groq asr ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { text?: string };
  return { text: (body.text ?? '').trim(), latencyMs: Date.now() - started };
}
