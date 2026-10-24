/**
 * Proactive follow-up. Memory that produces agency rather than just recall:
 * when a concern's follow-up time arrives, the companion reaches out first.
 *
 * ── The 24-hour rule ────────────────────────────────────────────────────
 * Meta only permits free-form messages within 24 hours of the patient's last
 * inbound message. Outside that window a plain send fails with code 131047
 * and production would need an approved Message Template.
 *
 * So the scheduler is deliberately conservative:
 *   - inside the window  → send the check-in now
 *   - outside the window → do NOT burn retries. Mark the concern as deferred;
 *     it stays open and is delivered by greeting() the next time the patient
 *     opens the app or messages the bot. The memory still drives the
 *     conversation, just on the patient's next contact rather than ours.
 *
 * This is why open_concerns has no "sent" flag but a `notified_at` stamp:
 * the concern is the source of truth, the message is only one delivery route.
 */

import cron from 'node-cron';
import { q } from './db/client.ts';
import { sendText, sendVoice, whatsappConfigured } from './whatsapp/meta.ts';
import { notify } from './portal/notify.ts';

interface Due {
  id: string;
  patient_id: string;
  phone: string;
  summary_ur: string;
  detail: Record<string, unknown> | null;
  last_inbound: Date | null;
}

/** Meta: "Re-engagement message" — outside the 24-hour customer service window. */
const OUTSIDE_WINDOW = /131047|24 hour|re-?engagement/i;

export async function runFollowUps(): Promise<{ sent: number; deferred: number }> {
  if (!whatsappConfigured()) return { sent: 0, deferred: 0 };

  const due = await q<Due>(
    `SELECT c.id, c.patient_id, p.phone, c.summary_ur, c.detail,
            (SELECT max(t.created_at) FROM turns t
              WHERE t.patient_id = p.id AND t.role = 'patient') AS last_inbound
     FROM open_concerns c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.resolved_at IS NULL
       AND c.follow_up_at <= now()
       AND p.phone IS NOT NULL AND p.phone <> 'demo'
       AND (c.detail->>'notified_at') IS NULL
       AND (c.detail->>'deferred_at') IS NULL
     LIMIT 20`,
  );

  let sent = 0;
  let deferred = 0;

  for (const c of due) {
    // Cheap pre-check so we do not spend an API call we know will be refused.
    const hours = c.last_inbound
      ? (Date.now() - new Date(c.last_inbound).getTime()) / 3_600_000
      : Infinity;

    if (hours > 23) {
      await mark(c.id, 'deferred_at');
      deferred++;
      continue;
    }

    try {
      await sendText(c.phone, c.summary_ur);
      await sendVoice(c.phone, c.summary_ur);
      await mark(c.id, 'notified_at');
      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (OUTSIDE_WINDOW.test(msg)) {
        // The window closed between the check and the send.
        await mark(c.id, 'deferred_at');
        deferred++;
      } else {
        // Leave it unmarked so a transient failure is retried next tick.
        console.error('follow-up failed', c.id, msg.slice(0, 200));
      }
    }
  }

  return { sent, deferred };
}

function mark(id: string, field: 'notified_at' | 'deferred_at'): Promise<unknown> {
  return q(
    `UPDATE open_concerns
     SET detail = COALESCE(detail,'{}'::jsonb) || jsonb_build_object($2::text, now())
     WHERE id = $1`,
    [id, field],
  );
}

/** Appointments and tests due in the next 24 hours: remind the patient and their family once. */
export async function runAppointmentReminders(): Promise<number> {
  const due = await q<{ id: string; patient_id: string; kind: string; title: string; due_at: string; doctor: string }>(
    `SELECT o.id, o.patient_id, o.kind, o.title, o.due_at, u.name AS doctor
     FROM care_orders o JOIN users u ON u.id = o.doctor_id
     WHERE o.kind IN ('appointment','test') AND o.status='active' AND o.reminded_at IS NULL
       AND o.due_at > now() AND o.due_at <= now() + interval '24 hours'
     LIMIT 50`,
  ).catch(() => []);
  for (const o of due) {
    const when = new Date(o.due_at).toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });
    await notify({
      patientId: o.patient_id, audience: 'everyone', kind: 'appointment', severity: 'info',
      title: `Reminder: ${o.title} — ${when}`, body: `Assigned by Dr. ${o.doctor.replace(/^dr\.?\s*/i, '')}`,
      whatsappText: `SehatSaathi یاد دہانی: ${o.title} — ${when}\nReminder: ${o.title} — ${when}`,
    });
    await q(`UPDATE care_orders SET reminded_at = now() WHERE id=$1`, [o.id]);
  }
  return due.length;
}

export function startScheduler(): void {
  cron.schedule('0 * * * *', () => { void runAppointmentReminders(); }, { timezone: 'Asia/Karachi' });
  // Every 30 minutes, 08:00–21:00 Pakistan time — no 3 a.m. check-ins.
  cron.schedule('*/30 8-21 * * *', () => { void runFollowUps(); }, { timezone: 'Asia/Karachi' });
}
