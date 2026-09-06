/**
 * HOUR-0 SPIKE — the single most important 20 minutes of this build.
 *
 * Alibaba's standalone TTS models (cosyvoice-*, qwen3-tts-flash) do not list
 * Urdu, and neither do the standalone ASR models. The entire project rests on
 * whether qwen3.5-omni-flash-realtime can actually SPEAK Urdu. Nobody should
 * write application code until that is answered with their own ears.
 *
 * The risky leg is output, not input: the model claims 113 recognition
 * languages but only 36 for speech generation. So this spike drives it with a
 * TEXT prompt and asks for Urdu audio back. That needs no microphone, no
 * recorded sample, and no ASR — it isolates exactly the thing that might fail.
 *
 *   npm run spike            # test the default voice
 *   npm run spike -- --all   # sweep several voices, one wav each
 *
 * Then LISTEN to the .wav files. Decide Plan A / B / C. Write the decision
 * into ARCHITECTURE.md. Only then start building.
 */

import 'dotenv/config';
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API_KEY = process.env.DASHSCOPE_API_KEY;
// QwenCloud sk-ws- keys connect to the realtime socket directly — there is no
// per-workspace subdomain, unlike the {WorkspaceId}.ap-southeast-1.maas...
// form the Alibaba Cloud docs show. Verified by probing both.
const WS_URL =
  process.env.REALTIME_WS_URL ?? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
const MODEL = process.env.MODEL_VOICE_REALTIME ?? 'qwen3.5-omni-flash-realtime';

if (!API_KEY) {
  console.error(
    '\n  Missing DASHSCOPE_API_KEY.\n' +
      '  Get a card-free key at https://home.qwencloud.com/api-keys\n' +
      '  (Singapore/International — the free quota and Urdu support do not\n' +
      '   exist in the Beijing region.) Then copy .env.example to .env.\n',
  );
  process.exit(1);
}

const OUT_DIR = join(process.cwd(), 'spike-out');
mkdirSync(OUT_DIR, { recursive: true });

/** Output is 24 kHz 16-bit mono PCM; wrap it so a normal player can open it. */
function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);             // PCM chunk size
  header.writeUInt16LE(1, 20);              // format = PCM
  header.writeUInt16LE(1, 22);              // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);              // block align
  header.writeUInt16LE(16, 34);             // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * A realistic clinical utterance, not "hello world" — we need to hear how the
 * model handles diabetes vocabulary, Urdu numerals, and the code-switching
 * ("sugar", "check") that Pakistani speakers actually use.
 */
const PROMPT_UR =
  'آپ ایک ذیابیطس کے مریض کے ساتھی ہیں۔ صرف اردو میں، نرمی سے، دو جملوں میں جواب دیں۔ ' +
  'مریض نے کہا: آج شوگر دو سو پچاس تھا، چکر آ رہے ہیں۔';

const INSTRUCTIONS =
  'You are a warm, simple Urdu-speaking health companion for a low-literacy ' +
  'diabetes patient in Pakistan. ALWAYS reply in spoken Urdu. Keep it to two ' +
  'short sentences. Never give a drug dose.';

interface SpikeResult {
  voice: string;
  audioBytes: number;
  transcript: string;
  firstAudioMs: number | null;
  error?: string;
}

function runVoice(voice: string): Promise<SpikeResult> {
  return new Promise((resolve) => {
    const url = `${WS_URL}?model=${MODEL}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${API_KEY}` } });

    const chunks: Buffer[] = [];
    let transcript = '';
    let firstAudioMs: number | null = null;
    let settled = false;
    const started = Date.now();

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      const pcm = Buffer.concat(chunks);
      if (pcm.length > 0) {
        writeFileSync(join(OUT_DIR, `urdu-${voice}.wav`), pcmToWav(pcm));
      }
      resolve({ voice, audioBytes: pcm.length, transcript, firstAudioMs, error });
    };

    // Never let a hung socket stall the spike — we are timing this.
    const timer = setTimeout(() => finish('timed out after 45s'), 45_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice,
          output_audio_format: 'pcm',
          input_audio_format: 'pcm',
          // Manual turn control: we are driving with text, not speech, so
          // there is no VAD to wait on.
          turn_detection: null,
          instructions: INSTRUCTIONS,
        },
      }));

      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: PROMPT_UR }],
        },
      }));

      ws.send(JSON.stringify({ type: 'response.create' }));
    });

    ws.on('message', (raw) => {
      let evt: { type?: string; delta?: string; error?: { message?: string } };
      try {
        evt = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (evt.type) {
        case 'response.audio.delta':
          if (firstAudioMs === null) firstAudioMs = Date.now() - started;
          if (evt.delta) chunks.push(Buffer.from(evt.delta, 'base64'));
          break;
        case 'response.audio_transcript.delta':
        case 'response.text.delta':
          transcript += evt.delta ?? '';
          break;
        case 'response.done':
          finish();
          break;
        case 'error':
          finish(evt.error?.message ?? JSON.stringify(evt));
          break;
      }
    });

    ws.on('error', (err) => finish(err.message));
    ws.on('close', () => finish());
  });
}

// A spread of voices — the docs mention 55 (47 multilingual + 8 dialectal) but
// do not say which cover Urdu, so we sweep and listen.
const VOICES = ['Cherry', 'Ethan', 'Nofish', 'Jada', 'Dylan'];

async function main() {
  const all = process.argv.includes('--all');
  const list = all ? VOICES : [VOICES[0]!];

  console.log(`\n  Model:  ${MODEL}`);
  console.log(`  Voices: ${list.join(', ')}\n`);

  const results: SpikeResult[] = [];
  for (const v of list) {
    process.stdout.write(`  ${v.padEnd(10)} `);
    const r = await runVoice(v);
    results.push(r);
    console.log(
      r.error
        ? `FAILED — ${r.error}`
        : `${(r.audioBytes / 48_000).toFixed(1)}s audio, first byte ${r.firstAudioMs}ms`,
    );
    if (r.transcript) console.log(`             ${r.transcript.slice(0, 90)}`);
  }

  const ok = results.filter((r) => !r.error && r.audioBytes > 0);
  console.log('\n  ─────────────────────────────────────────────');
  if (ok.length === 0) {
    console.log('  No audio returned. -> PLAN B or C. Set VOICE_PLAN=B in .env');
    console.log('  and route Urdu speech through qwen3.5-livetranslate-flash-realtime,');
    console.log('  which documents Urdu with audio output.');
  } else {
    console.log(`  ${ok.length}/${list.length} voice(s) returned audio.`);
    console.log(`  Files in: ${OUT_DIR}`);
    console.log('\n  NOW LISTEN TO THEM. Audio returning is not the same as');
    console.log('  intelligible Urdu — the model may fall back to Hindi phonetics');
    console.log('  or an Arabic-accented reading. If it is not clearly Urdu a');
    console.log('  Pakistani speaker would trust, that is PLAN B, not PLAN A.');
  }
  console.log('  ─────────────────────────────────────────────\n');
}

main();
