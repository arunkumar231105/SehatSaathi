/**
 * The voice layer behind one interface.
 *
 * We do not yet know whether qwen3.5-omni-flash-realtime speaks intelligible
 * Urdu — Alibaba's standalone TTS models do not support Urdu at all, and the
 * omni model covers 113 recognition languages against only 36 for speech
 * generation. The Hour-0 spike settles it.
 *
 * Rather than betting the codebase on the answer, everything above this file
 * talks to VoiceSession and never to a model. Three implementations satisfy
 * it, and swapping between them is a config change:
 *
 *   Plan A  omni.ts          single realtime socket, Urdu in and out
 *   Plan B  cascade.ts       LiveTranslate (Urdu confirmed) + qwen3-max + TTS
 *   Plan C  clientside.ts    browser ur-PK speech synthesis + cached clips
 */

export type VoicePlan = 'A' | 'B' | 'C';

/** JSON-Schema tool definition, as the realtime API expects it. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface VoiceSessionOptions {
  instructions: string;
  tools?: ToolDef[];
  voice?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface VoiceEvents {
  /** What the patient said. Partial until `final`. */
  userTranscript: (text: string, final: boolean) => void;
  /** What the agent is saying, in step with the audio. */
  agentTranscript: (text: string, final: boolean) => void;
  /** 24 kHz PCM16 mono. Forward to the browser immediately — buffering here
   *  is what turns a 1.2s response into a 4s one. */
  audio: (pcm: Buffer) => void;
  toolCall: (call: ToolCall) => void;
  /** VAD heard the patient start talking. Used for barge-in: stop playback
   *  so the agent does not talk over someone describing symptoms. */
  speechStarted: () => void;
  turnDone: () => void;
  error: (err: Error) => void;
  closed: () => void;
}

export interface VoiceSession {
  readonly plan: VoicePlan;
  /** 16 kHz PCM16 mono from the browser. */
  appendAudio(pcm16k: Buffer): void;
  /** Manual turn end. No-op when server VAD is driving the turn. */
  commit(): void;
  /** Abort the in-flight response (barge-in). */
  cancel(): void;
  sendToolResult(callId: string, result: unknown): void;
  close(): void;
  on<K extends keyof VoiceEvents>(event: K, cb: VoiceEvents[K]): void;
}

export interface VoiceAdapter {
  readonly plan: VoicePlan;
  open(opts: VoiceSessionOptions): Promise<VoiceSession>;
}
