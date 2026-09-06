/**
 * Urdu speech output — Azure Speech, ur-PK neural voices.
 *
 * Why not Qwen: Alibaba has no Urdu TTS at all. qwen-audio-3.0-realtime-flash
 * *writes* correct Urdu but speaks it badly enough that a Pakistani listener
 * could not follow it — which is disqualifying for a health app where the
 * whole point is that a low-literacy patient understands the instruction.
 *
 * Azure has purpose-built ur-PK voices (not a multilingual model guessing at
 * Urdu): Uzma (female) and Asad (male). Free tier is 500K characters/month.
 *
 * Output is requested as raw 24 kHz 16-bit mono PCM, which is exactly what the
 * browser playback path already expects — so no resampling anywhere.
 */

const REGION = process.env.AZURE_SPEECH_REGION ?? 'uaenorth';
const KEY = process.env.AZURE_SPEECH_KEY;
const VOICE = process.env.AZURE_TTS_VOICE ?? 'ur-PK-UzmaNeural';

const ENDPOINT = () => `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

/** XML escape — patient text reaches SSML, so this is not optional. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SpeakOptions {
  voice?: string;
  /** -50%..+50%. Slightly slower helps older and low-literacy listeners. */
  rate?: string;
}

/**
 * Synthesise Urdu text to raw PCM.
 *
 * Returns 24 kHz 16-bit mono PCM with no WAV header, ready to forward to the
 * browser in chunks.
 */
export async function speakUrdu(text: string, opts: SpeakOptions = {}): Promise<Buffer> {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY is not set');

  const voice = opts.voice ?? VOICE;
  // Default a little slower than natural: this audience includes elderly
  // patients and first-time smartphone users.
  const rate = opts.rate ?? '-8%';

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK">` +
    `<voice name="${voice}"><prosody rate="${rate}">${esc(text)}</prosody></voice>` +
    `</speak>`;

  const res = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
      'User-Agent': 'sehatsaathi',
    },
    body: ssml,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`azure tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Stream synthesis chunk by chunk.
 *
 * Azure starts returning audio before the whole utterance is rendered, so
 * forwarding as it arrives is what keeps time-to-first-audio low. Buffering
 * the full response first would add most of a second for a long reply.
 */
export async function* speakUrduStream(
  text: string,
  opts: SpeakOptions = {},
): AsyncGenerator<Buffer> {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY is not set');

  const voice = opts.voice ?? VOICE;
  const rate = opts.rate ?? '-8%';
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK">` +
    `<voice name="${voice}"><prosody rate="${rate}">${esc(text)}</prosody></voice>` +
    `</speak>`;

  const res = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
      'User-Agent': 'sehatsaathi',
    },
    body: ssml,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok || !res.body) {
    throw new Error(`azure tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) yield Buffer.from(value);
  }
}

/**
 * Opus-in-Ogg for WhatsApp voice notes. WhatsApp renders audio/ogg (opus) as
 * a native voice message with the waveform UI — anything else shows as a
 * file attachment, which a low-literacy user will not open.
 */
export async function speakUrduOgg(text: string, opts: SpeakOptions = {}): Promise<Buffer> {
  if (!KEY) throw new Error('AZURE_SPEECH_KEY is not set');
  const voice = opts.voice ?? VOICE;
  const rate = opts.rate ?? '-8%';
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ur-PK">` +
    `<voice name="${voice}"><prosody rate="${rate}">${esc(text)}</prosody></voice>` +
    `</speak>`;
  const res = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'ogg-24khz-16bit-mono-opus',
      'User-Agent': 'sehatsaathi',
    },
    body: ssml,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`azure tts ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** ur-PK voices, for the settings screen. */
export const URDU_VOICES = [
  { id: 'ur-PK-UzmaNeural', label: 'اُزمہ (خاتون)', gender: 'female' },
  { id: 'ur-PK-AsadNeural', label: 'اسد (مرد)', gender: 'male' },
] as const;
