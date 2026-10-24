/**
 * Dose reminders.
 *
 * A medicine's schedule is free text — "twice daily after meals", "subah
 * nashte ke baad", "رات کو سونے سے پہلے" — written by a doctor or spoken by a
 * patient. slotsFor() turns it into the times of day to remind at. It errs
 * toward fewer reminders: an unclear schedule gets one morning reminder,
 * never a guessed extra dose.
 *
 * Reminders say when, never how much more: the dose text is the doctor's,
 * repeated verbatim.
 */

import { q, one } from '../db/client.ts';
import { sendText, whatsappConfigured } from '../whatsapp/meta.ts';
import { notify } from '../portal/notify.ts';

export type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

/** Pakistan time, minutes after midnight, when each slot's reminder goes out. */
export const SLOT_TIME: Record<Slot, number> = { morning: 8 * 60, afternoon: 13 * 60 + 30, evening: 18 * 60 + 30, night: 21 * 60 + 30 };
const SLOT_UR: Record<Slot, string> = { morning: 'صبح', afternoon: 'دوپہر', evening: 'شام', night: 'رات' };

export function slotsFor(schedule: string | null | undefined): Slot[] {
  const s = ` ${(schedule ?? '').toLowerCase()} `;
  const out = new Set<Slot>();
  if (/breakfast|morning|subah|nasht|صبح|ناشت/.test(s)) out.add('morning');
  if (/lunch|afternoon|dopahar|dopehar|دوپہر/.test(s)) out.add('afternoon');
  if (/evening|shaam|sham\b|شام/.test(s)) out.add('evening');
  if (/night|dinner|bedtime|raat|sone|رات|سونے/.test(s)) out.add('night');
  if (out.size) return [...out];
  if (/three times|thrice|\btds\b|\btid\b|3 ?x|3 times|teen (bar|dafa)|تین/.test(s)) return ['morning', 'afternoon', 'night'];
  if (/twice|\bbd\b|\bbid\b|2 ?x|2 times|do (bar|dafa)|دو بار|دو دفعہ/.test(s)) return ['morning', 'night'];
  return ['morning'];
}

/** Which slot is due now (within 45 minutes after its time), in Pakistan time. */
export function dueSlot(now = new Date()): { slot: Slot; day: string } | null {
  const pk = new Date(now.getTime() + 5 * 3_600_000);          // Asia/Karachi is UTC+5, no DST
  const minutes = pk.getUTCHours() * 60 + pk.getUTCMinutes();
  const day = pk.toISOString().slice(0, 10);
  for (const [slot, t] of Object.entries(SLOT_TIME) as [Slot, number][]) {
    if (minutes >= t && minutes < t + 45) return { slot, day };
  }
  return null;
}

export async function runDoseReminders(now = new Date()): Promise<number> {
  const due = dueSlot(now);
  if (!due) return 0;
  const meds = await q<{ id: string; patient_id: string; name: string; dose: string | null; schedule: string | null; phone: string | null; last_inbound: string | null }>(
    `SELECT m.id, m.patient_id, m.name, m.dose, m.schedule, p.phone,
            (SELECT max(t.created_at) FROM turns t WHERE t.patient_id=p.id AND t.role='patient') AS last_inbound
     FROM medications m JOIN patients p ON p.id=m.patient_id
     WHERE m.active AND p.reminders_on
       AND NOT EXISTS (SELECT 1 FROM dose_reminders r WHERE r.medication_id=m.id AND r.slot=$1 AND r.day=$2)`,
    [due.slot, due.day],
  ).catch(() => []);

  let sent = 0;
  for (const m of meds) {
    if (!slotsFor(m.schedule).includes(due.slot)) continue;
    const what = [m.name, m.dose].filter(Boolean).join(' ');
    const text = `💊 ${SLOT_UR[due.slot]} کی دوا کا وقت: ${what}۔ دوا لینے کے بعد "ہاں" لکھ کر بتا دیں۔\nTime for your ${due.slot} medicine: ${what}. Reply "haan" once you have taken it.`;
    let channel = 'portal';
    const phone = m.phone && m.phone !== 'demo' ? m.phone.replace(/\D/g, '') : null;
    // Meta delivers free-form messages only inside the 24-hour window.
    const inWindow = m.last_inbound && Date.now() - new Date(m.last_inbound).getTime() < 23 * 3_600_000;
    if (phone && inWindow && whatsappConfigured()) {
      try { await sendText(phone, text); channel = 'whatsapp'; } catch { channel = 'portal'; }
    }
    await notify({ patientId: m.patient_id, audience: 'patient', kind: 'reminder', severity: 'info', title: `Time for your ${due.slot} medicine: ${what}` });
    await q(
      `INSERT INTO dose_reminders (medication_id, patient_id, slot, day, channel) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [m.id, m.patient_id, due.slot, due.day, channel],
    );
    sent++;
  }
  return sent;
}

/**
 * "haan" a little after a reminder means the dose was taken. Returns the
 * medicine it was logged against, or null if this reply is not about a dose.
 */
export async function logReminderReply(patientId: string, text: string): Promise<string | null> {
  const t = text.trim().toLowerCase();
  if (t.length > 25) return null;
  const no = /نہیں|(^|\s)(nahi|nahin|no)(\s|$)/.test(t);
  const yes = !no && /^(ہاں|جی|لے لی|لی|haan|han|ha|ji|jee|yes|done|le li|li|taken|ok)/.test(t);
  if (!yes) return null;
  // One "haan" answers the whole reminder: every medicine due at that time.
  const due = await q<{ medication_id: string; name: string }>(
    `SELECT r.medication_id, m.name FROM dose_reminders r JOIN medications m ON m.id=r.medication_id
     WHERE r.patient_id=$1 AND r.sent_at > now() - interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM med_events e WHERE e.medication_id=r.medication_id AND e.occurred_at > r.sent_at)
     ORDER BY r.sent_at DESC`,
    [patientId],
  );
  if (!due.length) return null;
  for (const r of due) await q(`INSERT INTO med_events (patient_id, medication_id, taken) VALUES ($1,$2,true)`, [patientId, r.medication_id]);
  return due.map((r) => r.name).join(', ');
}
