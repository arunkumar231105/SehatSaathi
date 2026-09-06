/**
 * Verify the replacement Urdu voice pipeline.
 *
 * The Qwen realtime voice was rejected on listening: it writes correct Urdu
 * but speaks it unintelligibly. This script proves the replacement before any
 * more code is built on top of it.
 *
 *   npm run test:voice            # Azure ur-PK: synthesise both voices
 *   npm run test:voice -- --loop  # round trip: text -> speech -> Whisper -> text
 *
 * The round trip is the honest test. If Whisper reads back what we sent, the
 * audio is genuinely intelligible Urdu rather than something that merely
 * sounds fluent.
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { speakUrdu, URDU_VOICES } from '../src/voice/azure-tts.ts';
import { transcribeUrdu, pcmToWav } from '../src/voice/groq-asr.ts';

const OUT = join(process.cwd(), 'spike-out');
mkdirSync(OUT, { recursive: true });

/** Real clinical utterances, including the numbers that matter most. */
const LINES = [
  'آج آپ کی شوگر دو سو پچاس ہے۔ یہ زیادہ ہے۔ پانی پیئیں اور آج ہی ڈاکٹر سے رابطہ کریں۔',
  'آپ کی شوگر بہت کم ہے۔ ابھی فوراً تین چمچ چینی لیں، پھر پندرہ منٹ بعد دوبارہ چیک کریں۔',
  'پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے۔ اب کیسا ہے؟',
];

/** Azure returns 24 kHz; Whisper wants 16 kHz. Cheap decimation is fine for
 *  an intelligibility check — we are testing words, not fidelity. */
function downsample24to16(pcm24: Buffer): Buffer {
  const inS = pcm24.length / 2;
  const outS = Math.floor((inS * 2) / 3);
  const out = Buffer.alloc(outS * 2);
  for (let i = 0; i < outS; i++) {
    const src = Math.floor((i * 3) / 2);
    out.writeInt16LE(pcm24.readInt16LE(Math.min(src, inS - 1) * 2), i * 2);
  }
  return out;
}

async function main() {
  if (!process.env.AZURE_SPEECH_KEY) {
    console.error('\n  AZURE_SPEECH_KEY not set. portal.azure.com -> Speech service -> F0 tier.\n');
    process.exit(1);
  }

  const loop = process.argv.includes('--loop');
  console.log(`\n  Region: ${process.env.AZURE_SPEECH_REGION}\n`);

  for (const { id, label } of URDU_VOICES) {
    console.log(`  ${id}  ${label}`);
    for (const [i, line] of LINES.entries()) {
      const t0 = Date.now();
      const pcm = await speakUrdu(line, { voice: id });
      const ms = Date.now() - t0;
      const file = join(OUT, `azure-${id}-${i + 1}.wav`);
      writeFileSync(file, pcmToWav(downsample24to16(pcm), 16_000));
      console.log(
        `    ${i + 1}. ${(pcm.length / 48_000).toFixed(1)}s audio in ${ms}ms  -> ${file}`,
      );

      if (loop && process.env.GROQ_API_KEY) {
        const back = await transcribeUrdu(downsample24to16(pcm));
        console.log(`       heard back: "${back.text}"`);
        console.log(`       sent      : "${line}"`);
      }
    }
    console.log();
  }

  console.log('  Listen to the files. This is the quality bar the whole app rests on:');
  console.log('  a patient with low literacy must understand it on one hearing.\n');
}

main();
