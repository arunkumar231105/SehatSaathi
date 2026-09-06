/**
 * Proactive follow-up. Memory that produces agency rather than just recall:
 * when a concern's follow-up time arrives, the companion reaches out first.
 *
 * Web patients get it as their greeting when they next open the app.
 * WhatsApp patients get an actual message — that is the difference between
 * "an app that remembers" and "a companion that checks on you".
 */

import cron from 'node-cron';
import { q } from './db/client.ts';
import { sendText, sendVoice, whatsappConfigured } from './whatsapp/meta.ts';

interface Due {
  id: string;
  patient_id: string;
  phone: string;
  summary_ur: string;
  detail: Record<string, unknown> | null;
}

export async function runFollowUps(): Promise<number> {
  if (!whatsappConfigured()) return 0;
  const due = await q<Due>(
    `SELECT c.id, c.patient_id, p.phone, c.summary_ur, c.detail
     FROM open_concerns c JOIN patients p ON p.id=c.patient_id
     WHERE c.resolved_at IS NULL AND c.follow_up_at <= now()
       AND p.phone IS NOT NULL AND p.phone <> 'demo'
       AND (c.detail->>'notified_at') IS NULL
     LIMIT 20`,
  );
  let n = 0;
  for (const c of due) {
    try {
      await sendText(c.phone, c.summary_ur);
      await sendVoice(c.phone, c.summary_ur);
      await q(
        `UPDATE open_concerns SET detail = COALESCE(detail,'{}'::jsonb) || jsonb_build_object('notified_at', now()) WHERE id=$1`,
        [c.id],
      );
      n++;
    } catch (err) {
      console.error('follow-up failed', c.id, err);
    }
  }
  return n;
}

export function startScheduler(): void {
  // Every 30 minutes, 08:00–21:00 Pakistan time — no 3 a.m. check-ins.
  cron.schedule('*/30 8-21 * * *', () => { void runFollowUps(); }, { timezone: 'Asia/Karachi' });
}
