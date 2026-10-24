/**
 * WhatsApp via the Meta Cloud API.
 *
 * Why WhatsApp at all: it is how Pakistan actually communicates. A voice note
 * to a saved contact is a lower barrier than installing anything, and it
 * works on the cheapest Android phone on 2G. The same orchestrator serves
 * both channels — WhatsApp is a transport, not a second product.
 *
 * Setup (developers.facebook.com → app → WhatsApp): the free test number can
 * message up to 5 verified recipients immediately, no business verification.
 *
 *   WHATSAPP_VERIFY_TOKEN      any string you choose; paste the same in Meta
 *   WHATSAPP_ACCESS_TOKEN      from the WhatsApp > API Setup page
 *   WHATSAPP_PHONE_NUMBER_ID   the "Phone number ID" (not the number itself)
 *   Webhook URL: https://<domain>/api/whatsapp/webhook   (subscribe: messages)
 */

import { q, one } from '../db/client.ts';
import { medicinePicture, questionsToText } from '../meds/service.ts';
import { transcribeFile } from '../voice/groq-asr.ts';
import { speakUrduOgg } from '../voice/azure-tts.ts';
import { respond, ensureSession, greeting, actionPlan } from '../orchestrator/turn.ts';
import { phrase } from '../safety/phrases.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';
const token = () => process.env.WHATSAPP_ACCESS_TOKEN ?? '';
const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';

export const whatsappConfigured = () => !!(token() && phoneId());

// ── outbound ─────────────────────────────────────────────────────────────

async function graph(path: string, body: unknown): Promise<Response> {
  return fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

export async function sendText(to: string, text: string): Promise<void> {
  const r = await graph(`${phoneId()}/messages`, {
    messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
  });
  if (!r.ok) throw new Error(`wa sendText ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function uploadMedia(ogg: Buffer): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg');
  form.append('file', new Blob([new Uint8Array(ogg)], { type: 'audio/ogg' }), 'reply.ogg');
  const r = await fetch(`${GRAPH}/${phoneId()}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`wa upload ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { id: string };
  return j.id;
}

export async function sendVoice(to: string, textUr: string): Promise<boolean> {
  if (!process.env.AZURE_SPEECH_KEY) return false;
  try {
    const ogg = await speakUrduOgg(textUr);
    const id = await uploadMedia(ogg);
    const r = await graph(`${phoneId()}/messages`, {
      messaging_product: 'whatsapp', to, type: 'audio', audio: { id },
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function markRead(messageId: string): Promise<void> {
  await graph(`${phoneId()}/messages`, {
    messaging_product: 'whatsapp', status: 'read', message_id: messageId,
  }).catch(() => undefined);
}

async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string }> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!meta.ok) throw new Error(`wa media meta ${meta.status}`);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
  const file = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!file.ok) throw new Error(`wa media download ${file.status}`);
  return { data: Buffer.from(await file.arrayBuffer()), mime: mime_type };
}

// ── patients keyed by phone ──────────────────────────────────────────────

async function patientForPhone(wa: string, profileName?: string): Promise<{ id: string; isNew: boolean }> {
  const cur = await one<{ id: string }>(`SELECT id FROM patients WHERE phone=$1`, [wa]);
  if (cur) return { id: cur.id, isNew: false };
  const row = await one<{ id: string }>(
    `INSERT INTO patients (phone, display_name) VALUES ($1,$2) RETURNING id`,
    [wa, profileName ?? null],
  );
  return { id: row!.id, isNew: true };
}

// ── inbound webhook ──────────────────────────────────────────────────────

interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string };
}

interface WaPayload {
  entry?: { changes?: { value?: { messages?: WaMessage[]; contacts?: { profile?: { name?: string } }[] } }[] }[];
}

/** Returns quickly; the actual turn runs after the 200 is sent. */
export function handleWebhook(payload: WaPayload): void {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const name = v?.contacts?.[0]?.profile?.name;
      for (const m of v?.messages ?? []) {
        setImmediate(() => { void handleMessage(m, name); });
      }
    }
  }
}

async function handleMessage(m: WaMessage, profileName?: string): Promise<void> {
  const { id: patientId, isNew } = await patientForPhone(m.from, profileName);
  await markRead(m.id);

  try {
    let textUr: string | null = null;

    if (m.type === 'text' && m.text?.body) {
      textUr = m.text.body.trim();
    } else if (m.type === 'audio' && m.audio?.id) {
      const { data, mime } = await downloadMedia(m.audio.id);
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'bin';
      textUr = (await transcribeFile(data, `note.${ext}`, mime)).text;
    } else {
      await sendText(m.from, phrase('welcome').ur);
      return;
    }

    if (!textUr || textUr.length < 2) {
      await sendText(m.from, phrase('didnt_catch').ur);
      return;
    }

    // "plan" / "منصوبہ" returns the full weekly plan rather than a
    // conversational turn — patients ask for it explicitly once they know
    // it exists, and it is the most useful single message we send.
    if (/^(plan|my plan|منصوبہ|پلان)\b/i.test(textUr.trim())) {
      const { text } = await actionPlan(patientId, 'ur');
      await sendText(m.from, text);
      await sendVoice(m.from, text);
      return;
    }

    // "doctor" / "ڈاکٹر" returns the list of things to raise at the next
    // appointment — built from the patient's own record and medicines.
    if (/^(doctor|daktar|dr|ڈاکٹر)\b/i.test(textUr.trim()) && textUr.trim().length < 20) {
      const pic = await medicinePicture(patientId, 'ur');
      const text = questionsToText(pic.questions, 'ur');
      await sendText(m.from, text);
      await sendVoice(m.from, text);
      return;
    }

    // First contact, or a bare greeting: open with memory-driven greeting.
    const bare = /^(hi|hello|salam|assalam|aoa|سلام|السلام|ہیلو|start)/i.test(textUr) && textUr.length < 30;
    if (isNew || bare) {
      const g = await greeting(patientId);
      await sendText(m.from, g.textUr);
      await sendVoice(m.from, g.textUr);
      if (bare) return;
    }

    const sessionId = await ensureSession(patientId, 'whatsapp');
    const r = await respond({ patientId, sessionId, userTextUr: textUr, channel: 'whatsapp' });

    // Text first (instant), then the voice note (a second or two later).
    await sendText(m.from, r.replyUr);
    await sendVoice(m.from, r.replyUr);

    // Emergency alerts to the doctor and family are sent from respond(), so
    // they go out the same way whichever channel the patient used.
  } catch (err) {
    await sendText(m.from, phrase('error').ur).catch(() => undefined);
    await q(`INSERT INTO sessions (patient_id, voice_plan, ended_at) VALUES ($1,'wa-error',now())`, [patientId]).catch(() => undefined);
    console.error('whatsapp turn failed', err);
  }
}
