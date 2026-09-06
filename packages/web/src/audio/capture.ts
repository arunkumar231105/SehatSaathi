/**
 * Microphone → 16 kHz PCM16 mono chunks.
 *
 * Runs the resampler inside an AudioWorklet so the main thread never touches
 * sample data — on a cheap Android phone that is the difference between a
 * smooth button and dropped audio. The worklet source is inlined as a Blob
 * URL so there is no separate file for the bundler to lose.
 */

const WORKLET = `
class Capture16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.out = new Int16Array(1280);   // 80 ms at 16 kHz
    this.n = 0;
    this.on = false;
    this.port.onmessage = (e) => { this.on = e.data === 'on'; if (!this.on) this.flush(); };
  }
  flush() {
    if (this.n > 0) { this.port.postMessage(this.out.slice(0, this.n).buffer); this.n = 0; }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !this.on) return true;
    // Linear-interpolation decimation from the device rate to 16 kHz.
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = ch[i], b = ch[Math.min(i + 1, ch.length - 1)];
      const s = a + (b - a) * f;
      this.out[this.n++] = Math.max(-32768, Math.min(32767, s * 32767)) | 0;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer.slice(0)); this.n = 0; }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('capture16k', Capture16k);
`;

export class MicCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  onChunk: ((pcm: ArrayBuffer) => void) | null = null;

  /** Must be called from a user gesture the first time (browser policy). */
  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, 'capture16k', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.onChunk?.(e.data);
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);
  }

  start(): void {
    this.node?.port.postMessage('on');
  }

  stop(): void {
    this.node?.port.postMessage('off');
  }

  get ready(): boolean {
    return !!this.node;
  }
}
