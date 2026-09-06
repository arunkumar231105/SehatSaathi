/**
 * Streaming playback of 24 kHz PCM16 chunks, gaplessly.
 *
 * Each chunk becomes an AudioBuffer tagged at 24 kHz; Web Audio resamples to
 * the device rate on its own, so the context can run at whatever the phone
 * prefers. Buffers are scheduled back-to-back on a running clock so chunk
 * boundaries are inaudible.
 *
 * Falls back to the browser's own speech synthesis (ur-PK voice where the OS
 * has one) if the server reports it has no TTS configured.
 */

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private carry: Uint8Array = new Uint8Array(0);
  onEnded: (() => void) | null = null;
  private endTimer: number | null = null;

  async init(): Promise<void> {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Base64 PCM16 chunk from the socket. */
  push(b64: string): void {
    if (!this.ctx) return;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    // Chunks may split a 16-bit sample across a boundary; carry the odd byte.
    let data = bytes;
    if (this.carry.length) {
      data = new Uint8Array(this.carry.length + bytes.length);
      data.set(this.carry);
      data.set(bytes, this.carry.length);
    }
    const usable = data.length - (data.length % 2);
    this.carry = data.slice(usable);
    if (usable === 0) return;

    const samples = usable / 2;
    const buf = this.ctx.createBuffer(1, samples, 24_000);
    const ch = buf.getChannelData(0);
    const view = new DataView(data.buffer, data.byteOffset, usable);
    for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const startAt = Math.max(this.nextTime, this.ctx.currentTime + 0.03);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      if (this.sources.length === 0) this.scheduleEnded();
    };
  }

  private scheduleEnded(): void {
    if (this.endTimer) window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => {
      if (this.sources.length === 0) this.onEnded?.();
    }, 120);
  }

  /** Barge-in: the patient started talking, so stop talking over them. */
  stop(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    this.nextTime = 0;
    this.carry = new Uint8Array(0);
    window.speechSynthesis?.cancel();
  }

  get playing(): boolean {
    return this.sources.length > 0;
  }

  /** Last resort when the server has no Urdu TTS configured. */
  speakFallback(text: string): void {
    if (!('speechSynthesis' in window)) { this.onEnded?.(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const ur = voices.find((v) => /^ur/i.test(v.lang)) ?? voices.find((v) => /^hi/i.test(v.lang));
    if (ur) u.voice = ur;
    u.lang = ur?.lang ?? 'ur-PK';
    u.rate = 0.9;
    u.onend = () => this.onEnded?.();
    u.onerror = () => this.onEnded?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
