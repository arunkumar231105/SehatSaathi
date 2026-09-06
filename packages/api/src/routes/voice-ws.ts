/**
 * Browser voice socket: /ws/voice
 *
 *   client → server   binary frames  = 16 kHz PCM16 mono while the button is held
 *                     text frames    = {"type":"start","patientId"} | {"type":"commit"} | {"type":"cancel"} | {"type":"greet"}
 *   server → client   {"type":"state","state":"listening|thinking|speaking|idle"}
 *                     {"type":"user_transcript","text"} · {"type":"agent_transcript","text"}
 *                     {"type":"audio","pcm":<base64 24kHz PCM16>} · {"type":"no_tts","text"}   ← client falls back to browser speech
 *                     {"type":"done","severity","findings"} · {"type":"error","message"}
 *
 * The API key never reaches the browser: the socket terminates here and this
 * process talks to Groq / Qwen / Azure on the patient's behalf.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { CascadeAdapter } from '../voice/cascade.ts';
import type { VoiceSession } from '../voice/types.ts';
import { respond, ensureSession, greeting } from '../orchestrator/turn.ts';
import { speakUrduStream } from '../voice/azure-tts.ts';

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/voice', { websocket: true }, (socket: WebSocket) => {
    let patientId: string | null = null;
    let sessionId: string | null = null;
    let session: VoiceSession | null = null;

    const send = (o: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o));
    };

    const speak = async (text: string) => {
      if (!process.env.AZURE_SPEECH_KEY) { send({ type: 'no_tts', text }); return; }
      try {
        for await (const chunk of speakUrduStream(text)) send({ type: 'audio', pcm: chunk.toString('base64') });
      } catch {
        send({ type: 'no_tts', text });
      }
    };

    async function start(pid: string) {
      patientId = pid;
      sessionId = await ensureSession(pid, 'web');

      const adapter = new CascadeAdapter(async (userTextUr) => {
        send({ type: 'state', state: 'thinking' });
        const r = await respond({ patientId: pid, sessionId: sessionId!, userTextUr, channel: 'web' });
        lastTurn = { severity: r.severity, findings: r.findings };
        return { replyUr: r.replyUr, audioOverride: r.audioOverride };
      });
      session = await adapter.open({ instructions: '' });

      session.on('userTranscript', (text) => send({ type: 'user_transcript', text }));
      session.on('agentTranscript', (text) => { send({ type: 'agent_transcript', text }); send({ type: 'state', state: 'speaking' }); });
      session.on('audio', (pcm) => send({ type: 'audio', pcm: pcm.toString('base64') }));
      session.on('turnDone', () => { send({ type: 'done', ...lastTurn }); send({ type: 'state', state: 'idle' }); lastTurn = {}; });
      session.on('error', (err) => {
        // A failed TTS still leaves us with the text — let the browser speak it.
        if (/azure tts/i.test(err.message) && lastText) send({ type: 'no_tts', text: lastText });
        else send({ type: 'error', message: err.message });
        send({ type: 'state', state: 'idle' });
      });
      session.on('agentTranscript', (text) => { lastText = text; });

      send({ type: 'ready', tts: !!process.env.AZURE_SPEECH_KEY, asr: !!process.env.GROQ_API_KEY });
    }

    let lastTurn: Record<string, unknown> = {};
    let lastText = '';

    socket.on('message', async (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          session?.appendAudio(Buffer.from(data));
          return;
        }
        const msg = JSON.parse(data.toString()) as { type: string; patientId?: string };
        switch (msg.type) {
          case 'start':
            if (msg.patientId) await start(msg.patientId);
            break;
          case 'commit':
            send({ type: 'state', state: 'thinking' });
            session?.commit();
            break;
          case 'cancel':
            session?.cancel();
            send({ type: 'state', state: 'idle' });
            break;
          case 'greet': {
            if (!patientId) break;
            const g = await greeting(patientId);
            send({ type: 'agent_transcript', text: g.textUr });
            send({ type: 'state', state: 'speaking' });
            await speak(g.textUr);
            send({ type: 'done' });
            send({ type: 'state', state: 'idle' });
            break;
          }
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on('close', () => session?.close());
  });
}
