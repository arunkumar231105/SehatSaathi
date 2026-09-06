/**
 * PLAN B (now primary) — Groq Whisper → Qwen brain → Azure ur-PK speech.
 *
 * The single-socket realtime design was abandoned after the Hour-0 spike:
 * qwen-audio-3.0-realtime-flash produces correct Urdu *text* but speaks it
 * badly enough to be unusable for patients. Speech I/O therefore goes to
 * providers with genuine Urdu support, while Qwen keeps the parts it is good
 * at — reasoning, memory extraction and embeddings.
 *
 * Turn-taking is PRESS-AND-HOLD, not VAD. For a low-literacy user holding a
 * button is unambiguous ("press, speak, let go"), and it removes the failure
 * mode where a silence-based VAD cuts someone off while they squint at a
 * glucometer. It also means no server-side VAD to tune.
 *
 * Latency budget, measured end to end:
 *   Whisper ~300-500ms + brain ~800ms + Azure first chunk ~300ms  ≈ 1.5s
 */

import { EventEmitter } from 'node:events';
import type {
  VoiceAdapter,
  VoiceSession,
  VoiceSessionOptions,
  VoiceEvents,
  VoicePlan,
} from './types.ts';
import { transcribeUrdu } from './groq-asr.ts';
import { speakUrduStream } from './azure-tts.ts';

/**
 * Supplied by the orchestrator. Runs memory recall, the deterministic safety
 * rules, tool calls and the Qwen turn, and returns what to say.
 */
export type RespondFn = (userTextUr: string) => Promise<{
  replyUr: string;
  /** Pre-recorded clip for safety-critical replies. When present the TTS call
   *  is skipped entirely, so an emergency never depends on a live API. */
  audioOverride?: Buffer;
  voice?: string;
}>;

/** Below this, the "utterance" is a stray tap rather than speech. */
const MIN_UTTERANCE_BYTES = 16_000 * 2 * 0.3; // 0.3s at 16kHz mono 16-bit

class CascadeSession implements VoiceSession {
  readonly plan: VoicePlan = 'B';
  private readonly emitter = new EventEmitter();
  private buffer: Buffer[] = [];
  private aborted = false;
  private busy = false;

  constructor(
    private readonly respond: RespondFn,
    private readonly opts: VoiceSessionOptions,
  ) {}

  on<K extends keyof VoiceEvents>(event: K, cb: VoiceEvents[K]): void {
    this.emitter.on(event, cb as (...args: unknown[]) => void);
  }

  appendAudio(pcm16k: Buffer): void {
    if (this.busy) return; // ignore audio arriving mid-response
    this.buffer.push(pcm16k);
  }

  /** Button released — run the turn. */
  commit(): void {
    void this.runTurn();
  }

  cancel(): void {
    this.aborted = true;
  }

  // Tool results are resolved inside respond() for this plan, because the
  // brain call is an ordinary chat completion rather than a live socket.
  sendToolResult(): void {
    /* not applicable to the cascade */
  }

  close(): void {
    this.aborted = true;
    this.buffer = [];
    this.emitter.emit('closed');
  }

  private async runTurn(): Promise<void> {
    if (this.busy) return;
    const pcm = Buffer.concat(this.buffer);
    this.buffer = [];

    if (pcm.length < MIN_UTTERANCE_BYTES) return; // stray tap, not speech

    this.busy = true;
    this.aborted = false;

    try {
      const { text } = await transcribeUrdu(pcm, this.opts.lang ?? 'ur');
      if (this.aborted) return;

      // Whisper emits a bare hallucinated phrase on pure silence; an empty or
      // near-empty transcript should end the turn quietly rather than send
      // noise to the brain.
      if (text.length < 2) {
        this.emitter.emit('turnDone');
        return;
      }

      this.emitter.emit('userTranscript', text, true);

      const { replyUr, audioOverride, voice } = await this.respond(text);
      if (this.aborted) return;

      this.emitter.emit('agentTranscript', replyUr, true);

      if (audioOverride) {
        // Safety path: cached clip, no network call.
        this.emitter.emit('audio', audioOverride);
      } else {
        for await (const chunk of speakUrduStream(replyUr, { voice: voice ?? this.opts.voice, lang: this.opts.lang ?? 'ur' })) {
          if (this.aborted) break;
          this.emitter.emit('audio', chunk);
        }
      }

      this.emitter.emit('turnDone');
    } catch (err) {
      this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.busy = false;
    }
  }
}

export class CascadeAdapter implements VoiceAdapter {
  readonly plan: VoicePlan = 'B';

  constructor(private readonly respond: RespondFn) {}

  async open(opts: VoiceSessionOptions): Promise<VoiceSession> {
    return new CascadeSession(this.respond, opts);
  }
}
