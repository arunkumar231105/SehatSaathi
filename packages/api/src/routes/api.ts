import type { FastifyInstance } from 'fastify';
import { q, one } from '../db/client.ts';
import { respond, ensureSession, greeting, actionPlan } from '../orchestrator/turn.ts';
import { getProfile, longitudinal, openConcerns, resolveConcern } from '../memory/engine.ts';
import { speakUrdu, URDU_VOICES } from '../voice/azure-tts.ts';
import { bus, type AlertEvent } from '../bus.ts';
import { whatsappConfigured, handleWebhook } from '../whatsapp/meta.ts';
import { medicinePicture } from '../meds/service.ts';
import { patientAccess, currentUser, canView } from '../portal/auth.ts';
import { readGlucometer, readingAsText } from '../vision/glucometer.ts';

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // Every /api/patients/:id/... route checks the record is this caller's to see.
  app.addHook('preHandler', async (req, reply) => {
    const m = req.url.match(/^\/api\/patients\/([0-9a-f-]{36})\//i);
    if (m && !(await patientAccess(req, m[1]!))) {
      return reply.code(403).send({ error: 'Sign in as this patient or a member of their care team.' });
    }
  });

  // ── patients ───────────────────────────────────────────────────────────
  app.post<{ Body: { displayName?: string; caregiverName?: string; caregiverPhone?: string } }>(
    '/api/patients',
    async (req) => {
      const b = req.body ?? {};
      const row = await one<{ id: string }>(
        `INSERT INTO patients (display_name, caregiver_name, caregiver_phone) VALUES ($1,$2,$3) RETURNING id`,
        [b.displayName ?? null, b.caregiverName ?? null, b.caregiverPhone ?? null],
      );
      return { id: row!.id };
    },
  );

  /** The demo patient — seeded with 14 days of history. */
  app.get('/api/patients/demo', async (_req, reply) => {
    const row = await one<{ id: string }>(`SELECT id FROM patients WHERE phone='demo'`);
    if (!row) return reply.code(404).send({ error: 'run the seed script' });
    return { id: row.id };
  });

  /** Cheap validity check: a cached browser id can outlive the row. */
  app.get<{ Params: { id: string } }>('/api/patients/:id/exists', async (req) => {
    const row = await one(`SELECT 1 FROM patients WHERE id = $1`, [req.params.id]).catch(() => undefined);
    return { exists: !!row };
  });

  app.get<{ Params: { id: string } }>('/api/patients/:id/summary', async (req, reply) => {
    const p = await one(`SELECT id, display_name, caregiver_name, caregiver_phone, created_at FROM patients WHERE id=$1`, [req.params.id]);
    if (!p) return reply.code(404).send({ error: 'not found' });
    const [facts, features, concerns, alerts] = await Promise.all([
      getProfile(req.params.id),
      longitudinal(req.params.id),
      openConcerns(req.params.id),
      q(`SELECT id, severity, rule_id, reason_ur, reason_en, acknowledged_at, created_at FROM alerts WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 10`, [req.params.id]),
    ]);
    // English-first: the dashboard is read by caregivers and clinicians.
    const meds = await medicinePicture(req.params.id, 'en');
    return { patient: p, facts, features, concerns, alerts, medicines: { cards: meds.cards, unknown: meds.unknown, checks: meds.checks } };
  });

  app.get<{ Params: { id: string } }>('/api/patients/:id/timeline', async (req) => {
    const id = req.params.id;
    const [readings, meals, symptoms, meds, turns] = await Promise.all([
      q(`SELECT id, mg_dl, context, taken_at FROM readings WHERE patient_id=$1 ORDER BY taken_at DESC LIMIT 120`, [id]),
      q(`SELECT id, description_ur, items, eaten_at FROM meals WHERE patient_id=$1 ORDER BY eaten_at DESC LIMIT 60`, [id]),
      q(`SELECT id, code, severity, reported_at FROM symptoms WHERE patient_id=$1 ORDER BY reported_at DESC LIMIT 60`, [id]),
      q(`SELECT e.id, e.taken, e.occurred_at, m.name FROM med_events e LEFT JOIN medications m ON m.id=e.medication_id WHERE e.patient_id=$1 ORDER BY occurred_at DESC LIMIT 60`, [id]),
      q(`SELECT id, role, text_ur, created_at FROM turns WHERE patient_id=$1 AND text_ur IS NOT NULL ORDER BY created_at DESC LIMIT 40`, [id]),
    ]);
    return { readings, meals, symptoms, meds, turns };
  });

  /** Profile facts with the exact utterance each one was learned from. */
  app.get<{ Params: { id: string } }>('/api/patients/:id/memory', async (req) => {
    const facts = await q(
      `SELECT f.id, f.key, f.value, f.confidence, f.learned_at, f.supersedes, f.active,
              t.text_ur AS source_text, t.created_at AS source_at
       FROM profile_facts f LEFT JOIN turns t ON t.id = f.source_turn_id
       WHERE f.patient_id=$1 ORDER BY f.key, f.learned_at DESC`,
      [req.params.id],
    );
    const concerns = await openConcerns(req.params.id);
    const episodes = await q(`SELECT count(*)::int AS n FROM turns WHERE patient_id=$1 AND embedding IS NOT NULL`, [req.params.id]);
    return { facts, concerns, episodicCount: episodes[0]?.n ?? 0 };
  });

  app.post<{ Params: { id: string } }>('/api/concerns/:id/resolve', async (req, reply) => {
    const c = await one<{ patient_id: string }>(`SELECT patient_id FROM open_concerns WHERE id=$1`, [req.params.id]);
    if (c && !(await patientAccess(req, c.patient_id))) return reply.code(403).send({ error: 'not allowed' });
    await resolveConcern(req.params.id);
    return { ok: true };
  });

  /** A concrete weekly plan built from this patient's own readings. */
  app.get<{ Params: { id: string }; Querystring: { lang?: 'ur' | 'en' } }>(
    '/api/patients/:id/plan',
    async (req) => actionPlan(req.params.id, req.query.lang ?? 'ur'),
  );

  /** The patient's own medicines explained, rule-based checks, and questions for the doctor. */
  app.get<{ Params: { id: string }; Querystring: { lang?: 'ur' | 'en' } }>(
    '/api/patients/:id/medicines',
    async (req) => medicinePicture(req.params.id, req.query.lang ?? 'ur'),
  );

  /**
   * Read a glucometer photo. Returns what was read; nothing is logged until
   * the patient confirms it and it is sent as an ordinary turn.
   */
  app.post<{ Params: { id: string }; Body: { image?: string; lang?: 'ur' | 'en' } }>(
    '/api/patients/:id/photo-reading',
    { bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      const image = req.body?.image ?? '';
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return reply.code(400).send({ error: 'Send a JPEG, PNG or WebP photo.' });
      try {
        const r = await readGlucometer(image);
        const readable = r.mgDl !== null && r.confidence >= 0.6;
        return { ...r, readable, text: readable ? readingAsText(r, req.body?.lang ?? 'ur') : null };
      } catch (err) {
        req.log.warn({ err }, 'photo reading failed');
        return reply.code(502).send({ error: 'Could not read the photo right now. Please type the number.' });
      }
    },
  );

  /** Memory-driven opening line for today. */
  app.get<{ Params: { id: string }; Querystring: { lang?: 'ur' | 'en' } }>('/api/patients/:id/greeting', async (req) => {
    const g = await greeting(req.params.id, req.query.lang ?? 'ur');
    return { textUr: g.textUr, concerns: g.concerns };
  });

  /** Text-channel turn (typed input, tests, and the demo script). */
  app.post<{ Params: { id: string }; Body: { text: string; lang?: 'ur' | 'en' } }>('/api/patients/:id/turn', async (req, reply) => {
    const text = (req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'text required' });
    const exists = await one(`SELECT 1 FROM patients WHERE id = $1`, [req.params.id]);
    if (!exists) return reply.code(404).send({ error: 'unknown patient', code: 'PATIENT_NOT_FOUND' });
    const sessionId = await ensureSession(req.params.id, 'api');
    const r = await respond({ patientId: req.params.id, sessionId, userTextUr: text, channel: 'api', lang: req.body?.lang ?? 'ur' });
    return {
      replyUr: r.replyUr, severity: r.severity, findings: r.findings,
      extraction: r.extraction, alertId: r.alertId,
    };
  });

  // ── speech ─────────────────────────────────────────────────────────────
  app.get('/api/voices', async () => ({
    configured: !!process.env.AZURE_SPEECH_KEY,
    voices: URDU_VOICES,
    current: process.env.AZURE_TTS_VOICE ?? 'ur-PK-UzmaNeural',
  }));

  /** Raw 24 kHz PCM for a line of Urdu — used for the greeting. */
  app.get<{ Querystring: { text?: string; voice?: string; lang?: 'ur' | 'en' } }>('/api/tts', async (req, reply) => {
    const text = (req.query.text ?? '').slice(0, 600);
    if (!text) return reply.code(400).send({ error: 'text required' });
    if (!process.env.AZURE_SPEECH_KEY) return reply.code(503).send({ error: 'tts not configured' });
    // The voice is chosen from lang inside azure-tts; an ur-PK voice reading
    // English is as wrong as the reverse.
    const pcm = await speakUrdu(text, { voice: req.query.voice, lang: req.query.lang });
    return reply.header('Content-Type', 'application/octet-stream').send(pcm);
  });

  // ── caregiver ──────────────────────────────────────────────────────────
  // The live alert dashboard used to list every patient to anyone. It now
  // shows a signed-in doctor or family member only the people on their care team.
  const careUser = async (req: Parameters<typeof currentUser>[0], reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const u = await currentUser(req);
    if (!u || u.role === 'patient') { reply.code(401).send({ error: 'Sign in as a doctor or family member to see the dashboard.' }); return null; }
    return u;
  };

  app.get('/api/care/alerts', async (req, reply) => {
    const u = await careUser(req, reply); if (!u) return;
    return q(
      `SELECT a.id, a.severity, a.rule_id, a.reason_ur, a.reason_en, a.acknowledged_at, a.created_at,
              p.id AS patient_id, p.display_name, p.phone, p.caregiver_phone,
              t.text_ur AS trigger_text
       FROM alerts a JOIN patients p ON p.id=a.patient_id LEFT JOIN turns t ON t.id=a.turn_id
       WHERE a.patient_id IN (SELECT patient_id FROM care_team WHERE user_id=$1)
       ORDER BY a.created_at DESC LIMIT 50`,
      [u.id],
    );
  });

  app.post<{ Params: { id: string } }>('/api/care/alerts/:id/ack', async (req, reply) => {
    const u = await careUser(req, reply); if (!u) return;
    const a = await one<{ patient_id: string }>(`SELECT patient_id FROM alerts WHERE id=$1`, [req.params.id]);
    if (!a || !(await canView(u, a.patient_id))) return reply.code(403).send({ error: 'not allowed' });
    await q(`UPDATE alerts SET acknowledged_at = now() WHERE id=$1`, [req.params.id]);
    return { ok: true };
  });

  app.get('/api/care/patients', async (req, reply) => {
    const u = await careUser(req, reply); if (!u) return;
    return q(
      `SELECT p.id, p.display_name, p.phone, p.caregiver_name, p.caregiver_phone,
              (SELECT mg_dl FROM readings r WHERE r.patient_id=p.id ORDER BY taken_at DESC LIMIT 1) AS last_mg_dl,
              (SELECT taken_at FROM readings r WHERE r.patient_id=p.id ORDER BY taken_at DESC LIMIT 1) AS last_at,
              (SELECT count(*)::int FROM alerts a WHERE a.patient_id=p.id AND a.acknowledged_at IS NULL AND a.severity='red') AS open_red,
              (SELECT count(*)::int FROM open_concerns c WHERE c.patient_id=p.id AND c.resolved_at IS NULL) AS open_concerns
       FROM patients p WHERE p.id IN (SELECT patient_id FROM care_team WHERE user_id=$1)
       ORDER BY open_red DESC, last_at DESC NULLS LAST LIMIT 50`,
      [u.id],
    );
  });

  /** Server-sent events: a new alert lights up the dashboard instantly. */
  app.get('/api/care/stream', async (req, reply) => {
    const u = await careUser(req, reply); if (!u) return;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const onAlert = async (a: AlertEvent) => { if (await canView(u, a.patientId)) reply.raw.write(`event: alert\ndata: ${JSON.stringify(a)}\n\n`); };
    bus.on('alert', onAlert);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => { bus.off('alert', onAlert); clearInterval(ping); });
    await new Promise(() => undefined); // hold the connection open
  });

  // ── whatsapp ───────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>('/api/whatsapp/webhook', async (req, reply) => {
    const mode = req.query['hub.mode'];
    const tok = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && tok && tok === process.env.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send('forbidden');
  });

  app.post('/api/whatsapp/webhook', async (req, reply) => {
    if (whatsappConfigured()) handleWebhook(req.body as Parameters<typeof handleWebhook>[0]);
    return reply.code(200).send('ok'); // Meta retries anything slower than ~a few seconds
  });

  app.get('/api/whatsapp/status', async () => ({
    configured: whatsappConfigured(),
    // The number patients message. Shown on the landing page and encoded in the QR.
    number: process.env.WHATSAPP_DISPLAY_NUMBER || null,
  }));
}
