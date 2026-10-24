/**
 * Demo accounts for the doctor, family and patient portals, linked to the
 * demo patient (Rashida Bibi). Safe to run repeatedly; run it after seed.ts,
 * which recreates the demo patient.
 *
 *   docker compose exec api npm run seed:portals
 *
 * The demo accounts get a random password nobody knows: they are entered
 * through the one-tap demo buttons (/api/auth/demo), so no credential is ever
 * published on the site. Set DEMO_LOGINS=off to disable those buttons.
 *
 * It also backfills readings 31–90 days ago, only if the demo patient has
 * none, so the 3-month progress view has three months to compare.
 */

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { q, one, pool } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { hashPassword, shareCodeFor } from '../src/portal/auth.ts';
import { DEMO_PHONES } from '../src/routes/portal.ts';

const DAY = 86_400_000;

async function user(role: 'doctor' | 'family' | 'patient', name: string, extra: { patientId?: string; specialty?: string } = {}) {
  const phone = DEMO_PHONES[role];
  const existing = await one<{ id: string }>(`SELECT id FROM users WHERE phone=$1`, [phone]);
  if (existing) {
    await q(`UPDATE users SET name=$2, patient_id=COALESCE($3, patient_id), specialty=$4 WHERE id=$1`, [existing.id, name, extra.patientId ?? null, extra.specialty ?? null]);
    return existing.id;
  }
  const row = await one<{ id: string }>(
    `INSERT INTO users (role, name, phone, password_hash, patient_id, specialty) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [role, name, phone, await hashPassword(randomBytes(24).toString('base64')), extra.patientId ?? null, extra.specialty ?? null],
  );
  return row!.id;
}

async function main() {
  await migrate();
  const p = await one<{ id: string }>(`SELECT id FROM patients WHERE phone='demo'`);
  if (!p) throw new Error('No demo patient — run `npm run seed` first.');
  const pid = p.id;

  // A previous run may have linked a demo patient that seed.ts has since replaced.
  await q(`UPDATE users SET patient_id=NULL WHERE phone=$1 AND patient_id IS DISTINCT FROM $2`, [DEMO_PHONES.patient, pid]);

  const doctor = await user('doctor', 'Dr. Ayesha Khan', { specialty: 'Diabetologist, Lahore' });
  const family = await user('family', 'Bilal Ahmed');
  await user('patient', 'Rashida Bibi', { patientId: pid });

  await q(
    `INSERT INTO care_team (patient_id, user_id, relation, label) VALUES ($1,$2,'doctor','Diabetologist'), ($1,$3,'family','Son')
     ON CONFLICT (patient_id, user_id) DO NOTHING`,
    [pid, doctor, family],
  );
  const code = await shareCodeFor(pid);

  // ── Three months of history, gently improving ───────────────────────
  const older = await one<{ n: number }>(`SELECT count(*)::int AS n FROM readings WHERE patient_id=$1 AND taken_at < now() - interval '31 days'`, [pid]);
  let added = 0;
  if ((older?.n ?? 0) === 0) {
    for (let d = 31; d <= 90; d += 2) {
      // ~215 mg/dL three months ago easing to ~185 a month ago, with day-to-day noise.
      const base = 185 + (d - 31) * 0.5;
      const wobble = ((d * 37) % 41) - 20;
      const fasting = Math.round(base - 25 + wobble * 0.6);
      const post = Math.round(base + 25 + wobble);
      for (const [mg, ctx, hour] of [[fasting, 'fasting', 7], [post, 'post_meal', 14]] as const) {
        const t = new Date(Date.now() - d * DAY);
        t.setHours(hour, 15, 0, 0);
        await q(`INSERT INTO readings (patient_id, mg_dl, context, taken_at) VALUES ($1,$2,$3,$4)`, [pid, mg, ctx, t]);
        added++;
      }
    }
  }

  // ── What the doctor has assigned ─────────────────────────────────────
  const hasOrders = await one(`SELECT 1 FROM care_orders WHERE patient_id=$1`, [pid]);
  if (!hasOrders) {
    const at = (days: number, hour: number) => { const t = new Date(Date.now() + days * DAY); t.setHours(hour, 0, 0, 0); return t; };
    const order = (kind: string, title: string, detail: string | null, due: Date | null, dose: string | null = null, schedule: string | null = null) =>
      q(`INSERT INTO care_orders (patient_id, doctor_id, kind, title, detail, dose, schedule, due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pid, doctor, kind, title, detail, dose, schedule, due]);
    await order('precaution', 'Walk 20 minutes after dinner', 'Every evening, even slowly. It brings down the next morning’s sugar.', null);
    await order('precaution', 'Check both feet every night', 'Look between the toes for cuts or redness — tell me about any wound the same day.', null);
    await order('appointment', 'Follow-up visit, Diabetes Clinic', 'Bring your glucometer and this week’s readings.', at(6, 11));
    await order('test', 'HbA1c and kidney blood test', 'Fasting not needed for HbA1c.', at(13, 9));
  }

  console.log(`  Demo portals ready. Share code ${code}; ${added} historical readings added.`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
