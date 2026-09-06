/**
 * PLAN A — qwen-audio-3.0-realtime-flash, one socket, Urdu in and Urdu out.
 *
 * The Hour-0 spike settled this empirically. Two things were wrong in the
 * original design:
 *
 *   1. The qwen3.5-omni-* realtime family is NOT in this account's free-quota
 *      set — every one returns "Access to model denied" at generation time
 *      (the socket still opens, which makes the failure look like silence
 *      rather than a permission error).
 *   2. The {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com URL from the docs
 *      does not apply to sk-ws- keys; they connect to the shared host with no
 *      workspace subdomain at all.
 *
 * qwen-audio-3.0-realtime-flash IS available, and produces fluent, clinically
 * sensible Urdu at ~950ms to first audio byte — inside the latency budget.
 * Its voice names are CosyVoice-style (sherry, hannah, daniel, loongmary...),
 * not the Cherry/Ethan set the omni docs list.
 *
 * Note: the realtime session supports tool calling OR web search, not both.
 * We need tools (logging a glucose reading, triggering escalation), so search
 * stays off and grounding comes from the pgvector corpus instead — which is
 * the better choice for clinical claims anyway, since retrieved chunks are
 * citable and a search result is not.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type {
  VoiceAdapter,
  VoiceSession,
  VoiceSessionOptions,
  VoiceEvents,
  VoicePlan,
} from './types.ts';

const WS_URL =
  process.env.REALTIME_WS_URL ?? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
const MODEL = process.env.MODEL_VOICE_REALTIME ?? 'qwen-audio-3.0-realtime-flash';

class OmniSession implements VoiceSession {
  readonly plan: VoicePlan = 'A';
  private readonly emitter = new EventEmitter();
  private readonly pendingToolArgs = new Map<string, string>();
  private closed = false;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => this.handle(raw));
    ws.on('error', (err: Error) => this.emitter.emit('error', err));
    ws.on('close', () => {
      this.closed = true;
      this.emitter.emit('closed');
    });
  }

  on<K extends keyof VoiceEvents>(event: K, cb: VoiceEvents[K]): void {
    this.emitter.on(event, cb as (...args: unknown[]) => void);
  }

  private send(payload: unknown): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  appendAudio(pcm16k: Buffer): void {
    this.send({ type: 'input_audio_buffer.append', audio: pcm16k.toString('base64') });
  }

  commit(): void {
    this.send({ type: 'input_audio_buffer.commit' });
    this.send({ type: 'response.create' });
  }

  cancel(): void {
    this.send({ type: 'response.cancel' });
  }

  sendToolResult(callId: string, result: unknown): void {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    // The model does not resume on its own after a tool result — it needs to
    // be told to produce the spoken turn that uses it.
    this.send({ type: 'response.create' });
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }

  private handle(raw: WebSocket.RawData): void {
    let evt: {
      type?: string;
      delta?: string;
      transcript?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      error?: { message?: string };
    };
    try {
      evt = JSON.parse(raw.toString());
    } catch {
      return; // a malformed frame must not kill the conversation
    }

    switch (evt.type) {
      case 'response.audio.delta':
        if (evt.delta) this.emitter.emit('audio', Buffer.from(evt.delta, 'base64'));
        break;

      case 'conversation.item.input_audio_transcription.delta':
        this.emitter.emit('userTranscript', evt.delta ?? '', false);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.emitter.emit('userTranscript', evt.transcript ?? '', true);
        break;

      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        this.emitter.emit('agentTranscript', evt.delta ?? '', false);
        break;
      case 'response.audio_transcript.done':
        this.emitter.emit('agentTranscript', evt.transcript ?? '', true);
        break;

      // Tool arguments stream in fragments and are only valid JSON once the
      // .done event lands, so we accumulate rather than parsing each delta.
      case 'response.function_call_arguments.delta':
        if (evt.call_id) {
          this.pendingToolArgs.set(
            evt.call_id,
            (this.pendingToolArgs.get(evt.call_id) ?? '') + (evt.delta ?? ''),
          );
        }
        break;
      case 'response.function_call_arguments.done': {
        if (!evt.call_id) break;
        const raw = evt.arguments ?? this.pendingToolArgs.get(evt.call_id) ?? '{}';
        this.pendingToolArgs.delete(evt.call_id);
        let args: unknown = {};
        try {
          args = JSON.parse(raw);
        } catch {
          // A tool call we cannot parse is dropped rather than guessed at —
          // guessing here would mean inventing a glucose reading.
          this.emitter.emit('error', new Error(`unparseable tool args: ${raw.slice(0, 120)}`));
          break;
        }
        this.emitter.emit('toolCall', { id: evt.call_id, name: evt.name ?? '', args });
        break;
      }

      case 'input_audio_buffer.speech_started':
        this.emitter.emit('speechStarted');
        break;

      case 'response.done':
        this.emitter.emit('turnDone');
        break;

      case 'error':
        this.emitter.emit('error', new Error(evt.error?.message ?? 'realtime error'));
        break;
    }
  }
}

export class OmniAdapter implements VoiceAdapter {
  readonly plan: VoicePlan = 'A';

  async open(opts: VoiceSessionOptions): Promise<VoiceSession> {
    const { DASHSCOPE_API_KEY } = process.env;
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY is required');
    }

    const url = `${WS_URL}?model=${MODEL}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('realtime connect timeout')), 10_000);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          voice: opts.voice ?? process.env.VOICE_NAME ?? 'sherry',
          input_audio_format: 'pcm',
          output_audio_format: 'pcm',
          // semantic_vad ends the turn on meaning rather than silence length.
          // That matters here: patients pause mid-sentence to recall a number
          // off a glucometer, and a silence-based VAD cuts them off.
          turn_detection: { type: 'semantic_vad' },
          input_audio_transcription: { enabled: true },
          instructions: opts.instructions,
          tools: opts.tools?.map((t) => ({ type: 'function', ...t })),
        },
      }),
    );

    return new OmniSession(ws);
  }
}
