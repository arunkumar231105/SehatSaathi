/**
 * One place every notification goes through — emergencies, alerts, doctor's
 * orders, appointment reminders.
 *
 * Each recipient gets an in-portal notification (stored, and pushed live over
 * SSE). WhatsApp is attempted as well, but it is the less reliable route:
 * Meta only delivers free-form messages to someone who has messaged the bot
 * in the last 24 hours, and a test number reaches only verified recipients.
 * So the outcome of every WhatsApp attempt is recorded on the notification
 * rather than assumed.
 */

import { q, one } from '../db/client.ts';
import { bus } from '../bus.ts';
import { sendText, whatsappConfigured } from '../whatsapp/meta.ts';
import type { Finding } from '../safety/rules.ts';

export type Audience = 'patient' | 'doctors' | 'family' | 'team' | 'everyone';
export type Severity = 'info' | 'warning' | 'emergency';

export interface NotifyEvent {
  userId: string;
  id: string;
  patientId: string;
  kind: string;
  severity: Severity;
  title: string;
  body: string | null;
  at: string;
}

interface Recipient { id: string; phone: string; role: string; relation: string | null }

async function recipients(patientId: string, audience: Audience): Promise<Recipient[]> {
  const team = await q<Recipient>(
    `SELECT u.id, u.phone, u.role, t.relation FROM care_team t JOIN users u ON u.id = t.user_id WHERE t.patient_id=$1`,
    [patientId],
  );
  const self = await q<Recipient>(`SELECT id, phone, role, NULL AS relation FROM users WHERE patient_id=$1`, [patientId]);
  const pick = {
    patient: self,
    doctors: team.filter((r) => r.relation === 'doctor'),
    family: team.filter((r) => r.relation === 'family'),
    team,
    everyone: [...self, ...team],
  }[audience];
  return [...new Map(pick.map((r) => [r.id, r])).values()];
}

async function whatsapp(phone: string, text: string): Promise<string> {
  if (!whatsappConfigured()) return 'not configured';
  try {
    await sendText(phone.replace(/\D/g, ''), text);
    return 'sent';
  } catch (err) {
    return `failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`;
  }
}

export async function notify(n: {
  patientId: string;
  audience: Audience;
  kind: string;
  severity: Severity;
  title: string;
  body?: string;
  /** Plain-text WhatsApp message; omit to skip WhatsApp. */
  whatsappText?: string;
  /** Don't notify the person who caused it (the doctor who wrote the order). */
  exceptUserId?: string;
}): Promise<number> {
  const rs = (await recipients(n.patientId, n.audience)).filter((r) => r.id !== n.exceptUserId);
  for (const r of rs) {
    const wa = n.whatsappText ? await whatsapp(r.phone, n.whatsappText) : null;
    const row = await one<{ id: string; created_at: string }>(
      `INSERT INTO notifications (user_id, patient_id, kind, severity, title, body, whatsapp)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [r.id, n.patientId, n.kind, n.severity, n.title, n.body ?? null, wa],
    );
    const ev: NotifyEvent = {
      userId: r.id, id: row!.id, patientId: n.patientId, kind: n.kind, severity: n.severity,
      title: n.title, body: n.body ?? null, at: row!.created_at,
    };
    bus.emit('notify', ev);
  }
  return rs.length;
}

/**
 * A red finding: everyone on the care team, at once, with the patient's own
 * words. Also the legacy single caregiver number for patients who have not
 * set up accounts yet. Returns how many people were reached in some way.
 */
export async function notifyEmergency(patientId: string, f: Finding, patientWords: string): Promise<number> {
  const p = await one<{ display_name: string | null; phone: string | null; caregiver_phone: string | null }>(
    `SELECT display_name, phone, caregiver_phone FROM patients WHERE id=$1`, [patientId],
  );
  const who = p?.display_name ?? 'Your patient';
  const contact = p?.phone && p.phone !== 'demo' ? `\nContact: +${p.phone.replace(/\D/g, '')}` : '';
  const text = `🚨 SehatSaathi EMERGENCY — ${who}\n${f.reasonEn}\nThey said: «${patientWords.slice(0, 200)}»\n${f.reasonUr}${contact}\nIf you cannot reach them, call 1122.`;

  const n = await notify({
    patientId, audience: 'team', kind: 'emergency', severity: 'emergency',
    title: `Emergency: ${who}`, body: `${f.reasonEn} They said: «${patientWords.slice(0, 200)}»`,
    whatsappText: text,
  });

  let legacy = 0;
  if (p?.caregiver_phone) {
    const already = await one(`SELECT 1 FROM care_team t JOIN users u ON u.id=t.user_id WHERE t.patient_id=$1 AND u.phone=$2`,
      [patientId, p.caregiver_phone.replace(/\D/g, '')]);
    if (!already && (await whatsapp(p.caregiver_phone, text)) === 'sent') legacy = 1;
  }
  return n + legacy;
}
