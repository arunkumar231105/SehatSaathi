import 'dotenv/config';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { pool } from './db/client.ts';
import { apiRoutes } from './routes/api.ts';
import { voiceRoutes } from './routes/voice-ws.ts';
import { warmClips } from './safety/clips.ts';
import { ingest } from './rag/kb.ts';
import { startScheduler } from './scheduler.ts';
import { migrate } from './db/migrate.ts';
import { portalRoutes } from './routes/portal.ts';

const PORT = Number(process.env.PORT ?? 3000);

// Bind 0.0.0.0 so the host nginx can reach us across the Docker network. This
// is only safe because the api service is published on 127.0.0.1 only — the
// DASHSCOPE / GROQ / AZURE keys live in this process and must stay unreachable
// from the public internet.
const HOST = '0.0.0.0';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(websocket, { options: { maxPayload: 4 * 1024 * 1024 } });

/**
 * Health, but useful: reports whether THIS container can reach each provider.
 * Some hosts allow outbound HTTPS while silently dropping long-lived
 * WebSockets, so /api/health/ws probes that separately.
 */
app.get('/api/health', async () => {
  const [db, modelStudio] = await Promise.all([checkDb(), checkModelStudio()]);
  return {
    ok: db && modelStudio,
    db,
    modelStudio,
    voicePlan: process.env.VOICE_PLAN ?? 'B',
    asr: !!process.env.GROQ_API_KEY,
    tts: !!process.env.AZURE_SPEECH_KEY,
    whatsapp: !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
});

async function checkDb(): Promise<boolean> {
  try { await pool.query('SELECT 1'); return true; } catch (err) { app.log.error({ err }, 'db down'); return false; }
}

async function checkModelStudio(): Promise<boolean> {
  const base = process.env.DASHSCOPE_BASE_URL;
  if (!base) return false;
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}` },
      signal: AbortSignal.timeout(5_000),
    });
    // 401 still proves reachability — we got to the auth layer.
    return res.status === 200 || res.status === 401;
  } catch (err) { app.log.error({ err }, 'model studio unreachable'); return false; }
}

app.get('/api/health/ws', async () => {
  const { default: WebSocket } = await import('ws');
  const base = process.env.REALTIME_WS_URL ?? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
  const url = `${base}?model=${process.env.MODEL_VOICE_REALTIME}`;
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` } });
    const done = (reachable: boolean, detail: string) => { try { ws.close(); } catch { /* noop */ } resolve({ reachable, detail }); };
    const timer = setTimeout(() => done(false, 'timeout after 8s'), 8_000);
    ws.on('open', () => { clearTimeout(timer); done(true, 'handshake ok'); });
    ws.on('error', (e: Error) => { clearTimeout(timer); done(false, e.message); });
  });
});

// Additive, idempotent — creates the portal tables on an existing database.
await migrate();

await app.register(apiRoutes);
await app.register(portalRoutes);
await app.register(voiceRoutes);

await app.listen({ port: PORT, host: HOST });

// Boot-time work that must not delay listening.
setImmediate(async () => {
  try { const n = await ingest(); if (n) app.log.info({ n }, 'kb ingested'); } catch (err) { app.log.warn({ err }, 'kb ingest skipped'); }
  try { const n = await warmClips(); app.log.info({ n }, 'safety clips warmed'); } catch (err) { app.log.warn({ err }, 'clip warm skipped'); }
  startScheduler();
});
