/**
 * Pre-rendered audio for fixed phrases.
 *
 * Rendered once with the Azure ur-PK voice and cached on disk. After that an
 * emergency instruction is a file read, not an API call — a TTS outage or a
 * quota lapse must never silence "your sugar is dangerously low".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHRASES } from './phrases.ts';
import { speakUrdu } from '../voice/azure-tts.ts';

const DIR = process.env.CLIPS_DIR ?? join(process.cwd(), 'data', 'clips');

function path(key: string, voice: string): string {
  return join(DIR, `${key}.${voice}.pcm`);
}

/** 24 kHz PCM16 mono, or undefined when no TTS is configured. */
export async function getClip(key: string, voice?: string): Promise<Buffer | undefined> {
  const v = voice ?? process.env.AZURE_TTS_VOICE ?? 'ur-PK-UzmaNeural';
  const p = path(key, v);
  if (existsSync(p)) return readFileSync(p);

  const text = PHRASES[key]?.ur;
  if (!text || !process.env.AZURE_SPEECH_KEY) return undefined;

  try {
    const pcm = await speakUrdu(text, { voice: v });
    mkdirSync(DIR, { recursive: true });
    writeFileSync(p, pcm);
    return pcm;
  } catch {
    return undefined;
  }
}

/** Warm the cache at boot so the first emergency is never the slow one. */
export async function warmClips(): Promise<number> {
  if (!process.env.AZURE_SPEECH_KEY) return 0;
  let n = 0;
  for (const key of Object.keys(PHRASES)) {
    if (await getClip(key)) n++;
  }
  return n;
}
