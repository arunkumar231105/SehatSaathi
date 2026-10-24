import type { FastifyInstance } from 'fastify';
import { q, one } from '../db/client.ts';
import {
  hashPassword, verifyPassword, normalizePhone, startSession, endSession, currentUser,
  requireUser, canView, isDoctorOf, shareCodeFor, newShareCode, type Role, type User,
} from '../portal/auth.ts';
import { progress } from '../portal/progress.ts';
import { notify, type NotifyEvent } from '../portal/notify.ts';
import { getProfile, upsertFact, openConcerns } from '../memory/engine.ts';
import { medicinePicture } from '../meds/service.ts';
import { bus, type AlertEvent } from '../bus.ts';

const ROLES: Role[] = ['patient', 'doctor', 'family'];
const KINDS = ['medicine', 'precaution', 'appointment', 'test'] as const;
type Kind = (typeof KINDS)[number];

/** Demo accounts, reachable from the "try it" buttons without a password. */
export const DEMO_PHONES: Record<Role, string> = { doctor: '923000000001', family: '923000000002', patient: '923000000003' };

const publicUser = (u: User) => ({ id: u.id, role: u.role, name: u.name, phone: u.phone, patientId: u.patient_id, specialty: u.specialty });

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One line per patient for the doctor's and family's patient lists. */
async function patientCard(patientId: string, relation: string | null, label: string | null) {
  const p = await one<{ id: string; display_name: string | null; phone: string | null }>(
    `SELECT id, display_name, phone FROM patients WHERE id=$1`, [patientId],
  );
  const readings = await q<{ mg_dl: number; taken_at: string; context: string | null }>(
    `SELECT mg_dl, taken_at, context FROM readings WHERE patient_id=$1 AND taken_at > now() - interval '90 days' ORDER BY taken_at DESC`,
    [patientId],
  );
  const pr = progress(readings);
  const [red, next] = await Promise.all([
    one<{ n: number }>(`SELECT count(*)::int AS n FROM alerts WHERE patient_id=$1 AND severity='red' AND acknowledged_at IS NULL`, [patientId]),
    one<{ title: string; due_at: string }>(
      `SELECT title, due_at FROM care_orders WHERE patient_id=$1 AND kind IN ('appointment','test') AND status='active' AND due_at > now() ORDER BY due_at LIMIT 1`,
      [patientId],
    ),
  ]);
  return {
    id: patientId, name: p?.display_name ?? 'Unnamed patient', relation, label,
    lastReading: readings[0] ? { mgDl: readings[0].mg_dl, at: readings[0].taken_at } : null,
    stage: pr.stage, trend: pr.trend, estimatedA1c: pr.estimatedA1c, timeInRange90: pr.timeInRange90,
    openEmergencies: red?.n ?? 0, nextAppointment: next ?? null,
  };
}

/** Keep the profile's medicine list — what the companion and Medicines screen read — in step with the doctor's orders. */
async function syncMedicineFact(patientId: string, add?: string, remove?: string) {
  const cur = (await getProfile(patientId)).find((f) => f.key === 'medications')?.value;
  let list = Array.isArray(cur) ? cur.map(String) : cur ? [String(cur)] : [];
  if (remove) list = list.filter((x) => x !== remove);
  if (add && !list.includes(add)) list = [...list, add];
  await upsertFact({ patientId, key: 'medications', value: list, confidence: 1 });
}

export async function portalRoutes(app: FastifyInstance): Promise<void> {
  // ── accounts ───────────────────────────────────────────────────────────
  app.post<{ Body: { role?: Role; name?: string; phone?: string; password?: string; specialty?: string; deviceRecordId?: string } }>(
    '/api/auth/register',
    async (req, reply) => {
      const b = req.body ?? {};
      const role = b.role;
      const name = (b.name ?? '').trim();
      const phone = normalizePhone(b.phone ?? '');
      if (!role || !ROLES.includes(role)) return reply.code(400).send({ error: 'Choose patient, doctor or family.' });
      if (name.length < 2) return reply.code(400).send({ error: 'Please enter your name.' });
      if (phone.length < 11 || phone.length > 13) return reply.code(400).send({ error: 'Enter a mobile number like 0300 1234567.' });
      if ((b.password ?? '').length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters.' });
      if (await one(`SELECT 1 FROM users WHERE phone=$1`, [phone])) return reply.code(409).send({ error: 'An account with this number already exists. Please sign in.' });

      let patientId: string | null = null;
      if (role === 'patient') {
        // Someone who already talks to the bot on WhatsApp keeps their whole history.
        const byPhone = await one<{ id: string }>(
          `SELECT p.id FROM patients p WHERE p.phone=$1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.patient_id=p.id)`, [phone],
        );
        const byDevice = !byPhone && b.deviceRecordId
          ? await one<{ id: string }>(
              `SELECT p.id FROM patients p WHERE p.id=$1 AND (p.phone IS NULL) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.patient_id=p.id)`,
              [b.deviceRecordId],
            ).catch(() => undefined)
          : undefined;
        patientId = byPhone?.id ?? byDevice?.id ?? null;
        if (patientId) await q(`UPDATE patients SET display_name = COALESCE(display_name, $2), phone = COALESCE(phone, $3) WHERE id=$1`, [patientId, name, phone]);
        else patientId = (await one<{ id: string }>(`INSERT INTO patients (display_name, phone) VALUES ($1,$2) RETURNING id`, [name, phone]))!.id;
      }
      const u = await one<User>(
        `INSERT INTO users (role, name, phone, password_hash, patient_id, specialty) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, role, name, phone, patient_id, specialty`,
        [role, name, phone, await hashPassword(b.password!), patientId, role === 'doctor' ? b.specialty?.trim() || null : null],
      );
      await startSession(reply, req, u!.id);
      return { user: publicUser(u!) };
    },
  );

  app.post<{ Body: { phone?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone ?? '');
    const row = await one<User & { password_hash: string }>(
      `SELECT id, role, name, phone, patient_id, specialty, password_hash FROM users WHERE phone=$1`, [phone],
    );
    // Same message either way, so the form cannot be used to discover accounts.
    if (!row || !(await verifyPassword(req.body?.password ?? '', row.password_hash))) {
      return reply.code(401).send({ error: 'That number and password do not match.' });
    }
    await startSession(reply, req, row.id);
    return { user: publicUser(row) };
  });

  /** One-tap demo sign-in for judges and visitors. Disable with DEMO_LOGINS=off. */
  app.post<{ Body: { role?: Role } }>('/api/auth/demo', async (req, reply) => {
    if (process.env.DEMO_LOGINS === 'off') return reply.code(404).send({ error: 'demo sign-in is disabled' });
    const role = req.body?.role;
    if (!role || !ROLES.includes(role)) return reply.code(400).send({ error: 'unknown role' });
    const u = await one<User>(`SELECT id, role, name, phone, patient_id, specialty FROM users WHERE phone=$1`, [DEMO_PHONES[role]]);
    if (!u) return reply.code(503).send({ error: 'Demo accounts are not set up yet.' });
    await startSession(reply, req, u.id);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => { await endSession(req, reply); return { ok: true }; });

  app.get('/api/auth/me', async (req) => {
    const u = await currentUser(req);
    if (!u) return { user: null };
    const unread = await one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [u.id]);
    return { user: publicUser(u), unread: unread?.n ?? 0, demo: Object.values(DEMO_PHONES).includes(u.phone) };
  });

  // ── care team ──────────────────────────────────────────────────────────
  app.get('/api/portal/share-code', async (req, reply) => {
    const u = await requireUser(req, reply, ['patient']); if (!u) return;
    return { code: await shareCodeFor(u.patient_id!) };
  });

  app.post('/api/portal/share-code/rotate', async (req, reply) => {
    const u = await requireUser(req, reply, ['patient']); if (!u) return;
    await q(`UPDATE patients SET share_code=$1 WHERE id=$2`, [newShareCode(), u.patient_id]);
    return { code: await shareCodeFor(u.patient_id!) };
  });

  app.post<{ Body: { code?: string; label?: string } }>('/api/portal/link', async (req, reply) => {
    const u = await requireUser(req, reply, ['doctor', 'family']); if (!u) return;
    const code = (req.body?.code ?? '').trim().toUpperCase();
    const p = await one<{ id: string; display_name: string | null }>(`SELECT id, display_name FROM patients WHERE share_code=$1`, [code]);
    if (!p) return reply.code(404).send({ error: 'No patient has that code. Ask them to check it on their “My care” screen.' });
    await q(
      `INSERT INTO care_team (patient_id, user_id, relation, label) VALUES ($1,$2,$3,$4)
       ON CONFLICT (patient_id, user_id) DO UPDATE SET label = COALESCE(EXCLUDED.label, care_team.label)`,
      [p.id, u.id, u.role, req.body?.label?.trim() || null],
    );
    await notify({
      patientId: p.id, audience: 'patient', kind: 'link', severity: 'info',
      title: u.role === 'doctor' ? `Dr. ${u.name.replace(/^dr\.?\s*/i, '')} joined your care team` : `${u.name} joined your care team`,
      body: u.role === 'doctor' ? 'They can now see your readings and send you instructions.' : 'They can now see your readings and will be alerted in an emergency.',
    });
    return { patient: await patientCard(p.id, u.role, req.body?.label ?? null) };
  });

  /** A patient removes someone; a doctor or family member removes themself. */
  app.delete<{ Params: { patientId: string; userId: string } }>('/api/portal/team/:patientId/:userId', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const allowed = (u.role === 'patient' && u.patient_id === req.params.patientId) || u.id === req.params.userId;
    if (!allowed) return reply.code(403).send({ error: 'not allowed' });
    await q(`DELETE FROM care_team WHERE patient_id=$1 AND user_id=$2`, [req.params.patientId, req.params.userId]);
    return { ok: true };
  });

  // ── patients ───────────────────────────────────────────────────────────
  app.get('/api/portal/patients', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    if (u.role === 'patient') return [await patientCard(u.patient_id!, null, null)];
    const links = await q<{ patient_id: string; relation: string; label: string | null }>(
      `SELECT patient_id, relation, label FROM care_team WHERE user_id=$1 ORDER BY created_at`, [u.id],
    );
    const cards = await Promise.all(links.map((l) => patientCard(l.patient_id, l.relation, l.label)));
    // Emergencies first, then whoever is doing worst.
    const rank = { very_high: 0, high: 1, above_target: 2, not_enough_data: 3, in_target: 4 } as const;
    return cards.sort((a, b) => b.openEmergencies - a.openEmergencies || rank[a.stage] - rank[b.stage]);
  });

  app.get<{ Params: { id: string }; Querystring: { lang?: 'ur' | 'en' } }>('/api/portal/patients/:id', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const id = req.params.id;
    if (!(await canView(u, id))) return reply.code(403).send({ error: 'You are not on this patient’s care team.' });
    const lang = req.query.lang ?? (u.role === 'patient' ? 'ur' : 'en');
    const [p, readings, alerts, orders, team, meds, concerns] = await Promise.all([
      one(`SELECT id, display_name, phone, created_at FROM patients WHERE id=$1`, [id]),
      q<{ mg_dl: number; taken_at: string; context: string | null }>(
        `SELECT mg_dl, taken_at, context FROM readings WHERE patient_id=$1 AND taken_at > now() - interval '90 days' ORDER BY taken_at DESC`, [id]),
      q(`SELECT a.id, a.severity, a.rule_id, a.reason_en, a.reason_ur, a.acknowledged_at, a.created_at, t.text_ur AS trigger_text
         FROM alerts a LEFT JOIN turns t ON t.id=a.turn_id WHERE a.patient_id=$1 ORDER BY a.created_at DESC LIMIT 20`, [id]),
      q(`SELECT o.*, u.name AS doctor_name FROM care_orders o JOIN users u ON u.id=o.doctor_id
         WHERE o.patient_id=$1 AND (o.status='active' OR o.created_at > now() - interval '30 days') ORDER BY o.status, o.due_at NULLS LAST, o.created_at DESC`, [id]),
      q(`SELECT u.id, u.name, u.role, u.specialty, t.relation, t.label FROM care_team t JOIN users u ON u.id=t.user_id WHERE t.patient_id=$1 ORDER BY t.relation, t.created_at`, [id]),
      medicinePicture(id, lang),
      openConcerns(id),
    ]);
    return {
      patient: p, progress: progress(readings), readings: readings.slice(0, 60), alerts, orders, team,
      medicines: meds, concerns, canAssign: await isDoctorOf(u, id),
      shareCode: u.role === 'patient' ? await shareCodeFor(id) : undefined,
    };
  });

  // ── doctor's orders ────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { kind?: Kind; title?: string; detail?: string; dose?: string; schedule?: string; dueAt?: string } }>(
    '/api/portal/patients/:id/orders',
    async (req, reply) => {
      const u = await requireUser(req, reply, ['doctor']); if (!u) return;
      const id = req.params.id;
      if (!(await isDoctorOf(u, id))) return reply.code(403).send({ error: 'Only this patient’s doctor can assign care.' });
      const b = req.body ?? {};
      if (!b.kind || !KINDS.includes(b.kind)) return reply.code(400).send({ error: 'Choose what you are assigning.' });
      const title = (b.title ?? '').trim();
      if (!title) return reply.code(400).send({ error: 'Please add a title.' });
      const dueAt = b.dueAt ? new Date(b.dueAt) : null;
      if ((b.kind === 'appointment' || b.kind === 'test') && (!dueAt || Number.isNaN(dueAt.getTime()))) {
        return reply.code(400).send({ error: 'Please choose a date and time.' });
      }

      let medicationId: string | null = null;
      if (b.kind === 'medicine') {
        const m = await one<{ id: string }>(
          `INSERT INTO medications (patient_id, name, dose, schedule) VALUES ($1,$2,$3,$4) RETURNING id`,
          [id, title, b.dose?.trim() || null, b.schedule?.trim() || null],
        );
        medicationId = m!.id;
        await syncMedicineFact(id, [title, b.dose, b.schedule].filter(Boolean).join(' '));
      }
      const order = await one(
        `INSERT INTO care_orders (patient_id, doctor_id, kind, title, detail, dose, schedule, due_at, medication_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [id, u.id, b.kind, title, b.detail?.trim() || null, b.dose?.trim() || null, b.schedule?.trim() || null, dueAt, medicationId],
      );

      const doc = `Dr. ${u.name.replace(/^dr\.?\s*/i, '')}`;
      const what = {
        medicine: { en: `New medicine: ${[title, b.dose, b.schedule].filter(Boolean).join(' · ')}`, ur: `نئی دوا: ${[title, b.dose, b.schedule].filter(Boolean).join(' · ')}` },
        precaution: { en: `New instruction: ${title}`, ur: `نئی ہدایت: ${title}` },
        appointment: { en: `Appointment: ${title} — ${dueAt ? fmtDate(dueAt) : ''}`, ur: `ملاقات: ${title} — ${dueAt ? fmtDate(dueAt) : ''}` },
        test: { en: `Test: ${title} — ${dueAt ? fmtDate(dueAt) : ''}`, ur: `ٹیسٹ: ${title} — ${dueAt ? fmtDate(dueAt) : ''}` },
      }[b.kind];
      await notify({
        patientId: id, audience: 'everyone', exceptUserId: u.id, kind: b.kind === 'appointment' || b.kind === 'test' ? 'appointment' : 'order',
        severity: 'info', title: `${doc}: ${what.en}`, body: b.detail?.trim() || undefined,
        whatsappText: `SehatSaathi — ${doc}\n${what.ur}\n${what.en}${b.detail ? `\n${b.detail}` : ''}`,
      });
      return { order };
    },
  );

  app.patch<{ Params: { id: string }; Body: { status?: 'done' | 'cancelled' } }>('/api/portal/orders/:id', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const o = await one<{ id: string; patient_id: string; kind: Kind; title: string; dose: string | null; schedule: string | null; medication_id: string | null }>(
      `SELECT id, patient_id, kind, title, dose, schedule, medication_id FROM care_orders WHERE id=$1`, [req.params.id],
    );
    if (!o) return reply.code(404).send({ error: 'not found' });
    const status = req.body?.status;
    // The doctor may cancel or close anything; the patient may tick off a test or instruction as done.
    const doctor = await isDoctorOf(u, o.patient_id);
    const patientDone = u.role === 'patient' && u.patient_id === o.patient_id && status === 'done' && o.kind !== 'medicine';
    if (!doctor && !patientDone) return reply.code(403).send({ error: 'not allowed' });
    if (status !== 'done' && status !== 'cancelled') return reply.code(400).send({ error: 'bad status' });
    await q(`UPDATE care_orders SET status=$1 WHERE id=$2`, [status, o.id]);
    if (o.kind === 'medicine' && status === 'cancelled') {
      if (o.medication_id) await q(`UPDATE medications SET active=false WHERE id=$1`, [o.medication_id]);
      await syncMedicineFact(o.patient_id, undefined, [o.title, o.dose, o.schedule].filter(Boolean).join(' '));
      await notify({
        patientId: o.patient_id, audience: 'everyone', exceptUserId: u.id, kind: 'order', severity: 'info',
        title: `Your doctor stopped: ${o.title}`, whatsappText: `SehatSaathi — آپ کے ڈاکٹر نے یہ دوا بند کر دی: ${o.title}\nYour doctor stopped: ${o.title}`,
      });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/portal/alerts/:id/ack', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const a = await one<{ patient_id: string }>(`SELECT patient_id FROM alerts WHERE id=$1`, [req.params.id]);
    if (!a || !(await canView(u, a.patient_id)) || u.role === 'patient') return reply.code(403).send({ error: 'not allowed' });
    await q(`UPDATE alerts SET acknowledged_at = now() WHERE id=$1 AND acknowledged_at IS NULL`, [req.params.id]);
    await notify({ patientId: a.patient_id, audience: 'team', exceptUserId: u.id, kind: 'alert', severity: 'info', title: `${u.name} is handling the emergency alert` });
    return { ok: true };
  });

  // ── notifications ──────────────────────────────────────────────────────
  app.get('/api/portal/notifications', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    return q(
      `SELECT n.id, n.patient_id, n.kind, n.severity, n.title, n.body, n.whatsapp, n.read_at, n.created_at, p.display_name AS patient_name
       FROM notifications n LEFT JOIN patients p ON p.id=n.patient_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`,
      [u.id],
    );
  });

  app.post('/api/portal/notifications/read', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    await q(`UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL`, [u.id]);
    return { ok: true };
  });

  /** Live notifications for the signed-in user only. */
  app.get('/api/portal/stream', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const onNotify = (n: NotifyEvent) => { if (n.userId === u.id) reply.raw.write(`event: notify\ndata: ${JSON.stringify(n)}\n\n`); };
    // Amber alerts are not pushed as notifications; refresh the open patient view instead.
    const onAlert = async (a: AlertEvent) => { if (await canView(u, a.patientId)) reply.raw.write(`event: alert\ndata: ${JSON.stringify({ patientId: a.patientId, severity: a.severity })}\n\n`); };
    bus.on('notify', onNotify);
    bus.on('alert', onAlert);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on('close', () => { clearInterval(ping); bus.off('notify', onNotify); bus.off('alert', onAlert); });
  });
}
