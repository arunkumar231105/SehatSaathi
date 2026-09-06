/**
 * Seed the demo patient with 14 days of history.
 *
 * Without this there is nothing to remember, and the memory demo — the whole
 * MemoryAgent thesis — cannot be shown. The data is shaped so that every
 * memory feature has something to say:
 *
 *   - fasting readings rising over the last 5 mornings   → dawn / trend remark
 *   - a biryani dinner followed by a 230 post-meal spike  → spike-food insight
 *   - foot numbness reported a week ago, never resolved   → unprompted follow-up
 *   - Metformin "once daily" then "twice daily"           → contradiction concern
 *   - two missed evening doses                            → adherence note
 *
 *   docker compose exec api npm run seed
 */

import 'dotenv/config';
import { q, one } from '../src/db/client.ts';
import { storeTurn, upsertFact, raiseConcern } from '../src/memory/engine.ts';
import { ingest } from '../src/rag/kb.ts';

const DAY = 86_400_000;
const ago = (days: number, hour = 8) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

async function main() {
  console.log('\n  Seeding demo patient…');
  const old = await one<{ id: string }>(`SELECT id FROM patients WHERE phone='demo'`);
  if (old) await q(`DELETE FROM patients WHERE id=$1`, [old.id]);

  const p = await one<{ id: string }>(
    `INSERT INTO patients (display_name, phone, caregiver_name, caregiver_phone)
     VALUES ('راشدہ بی بی', 'demo', 'بلال (بیٹا)', $1) RETURNING id`,
    [process.env.DEMO_CAREGIVER_PHONE ?? '+923001234567'],
  );
  const pid = p!.id;
  const s = await one<{ id: string }>(`INSERT INTO sessions (patient_id, voice_plan, started_at, ended_at) VALUES ($1,'seed',$2,$2) RETURNING id`, [pid, ago(14)]);
  const sid = s!.id;

  const met = await one<{ id: string }>(
    `INSERT INTO medications (patient_id, name, dose, schedule) VALUES ($1,'Metformin (Glucophage)','500 mg','twice daily after meals') RETURNING id`,
    [pid],
  );

  // ── conversations (provenance for facts) ────────────────────────────
  const turn = async (days: number, role: 'patient' | 'agent', textUr: string, hour = 9) => {
    const id = await storeTurn({ patientId: pid, sessionId: sid, role, textUr });
    await q(`UPDATE turns SET created_at=$2 WHERE id=$1`, [id, ago(days, hour)]);
    return id;
  };

  const t14a = await turn(14, 'patient', 'میرا نام راشدہ بی بی ہے، عمر اٹھاون سال۔ مجھے دو ہزار انیس سے شوگر ہے۔ ڈاکٹر نے گلوکوفیج دی ہے، دن میں ایک بار۔');
  await turn(14, 'agent', 'راشدہ بی بی، خوش آمدید۔ میں آپ کی شوگر کا خیال رکھنے میں مدد کروں گی۔ آج شوگر کتنی تھی؟');
  const t13 = await turn(13, 'patient', 'میں لاہور میں بیٹے بلال کے ساتھ رہتی ہوں۔ صبح خالی پیٹ ایک سو بیس تھی۔ میں دن میں تین روٹی کھاتی ہوں اور چار دفعہ چائے، دو چمچ چینی کے ساتھ۔');
  await turn(13, 'agent', 'آپ نے بتایا خالی پیٹ شوگر 120، یہ اچھی ہے۔ چائے میں چینی کم کریں تو اور بہتر ہوگا۔');
  const t11 = await turn(11, 'patient', 'ڈاکٹر نے کہا ہے گلوکوفیج دن میں دو بار لوں، صبح اور رات کھانے کے بعد۔ رمضان میں روزے رکھتی ہوں۔');
  await turn(11, 'agent', 'ٹھیک ہے، دن میں دو بار۔ رمضان سے پہلے ڈاکٹر سے دوا کا وقت ضرور پوچھ لیجیے گا۔');
  const t7 = await turn(7, 'patient', 'آج صبح ایک سو تیس تھی۔ کچھ دن سے دائیں پاؤں کی انگلیاں سن ہو جاتی ہیں۔');
  await turn(7, 'agent', 'آپ نے بتایا شوگر 130۔ پاؤں کا سن ہونا اہم ہے، ڈاکٹر کو ضرور بتائیں۔ روز پاؤں چیک کریں۔');
  await turn(4, 'patient', 'رات کو بریانی کھائی تھی، کھانے کے بعد دو سو تیس آئی۔ رات کی دوا رہ گئی۔', 22);
  await turn(4, 'agent', 'آپ نے بتایا کھانے کے بعد 230۔ بریانی کے بعد شوگر بڑھ جاتی ہے، تھوڑی مقدار لیں اور چہل قدمی کریں۔', 22);
  await turn(2, 'patient', 'صبح ایک سو پچاس تھی۔ رات کی دوا پھر بھول گئی۔');
  await turn(2, 'agent', 'آپ نے بتایا خالی پیٹ 150۔ دوا وقت پر لینا بہت ضروری ہے، فون میں الارم لگا لیں۔');
  await turn(1, 'patient', 'صبح ایک سو پینسٹھ۔');
  await turn(1, 'agent', 'آپ نے بتایا خالی پیٹ 165۔ صبح کی شوگر کچھ دن سے بڑھ رہی ہے۔ رات کا کھانا جلدی کر کے دیکھیں۔');

  // ── profile facts with provenance (and one contradiction) ───────────
  const f = (key: string, value: unknown, src: string, confidence = 0.9) =>
    upsertFact({ patientId: pid, key, value, confidence, sourceTurnId: src });
  await f('name', 'راشدہ بی بی', t14a);
  await f('age', 58, t14a);
  await f('diabetes_type', 'type 2', t14a);
  await f('diagnosis_year', 2019, t14a);
  await f('medications', ['Metformin (Glucophage) 500mg once daily'], t14a);
  await f('lives_with', 'son Bilal, Lahore', t13);
  await f('roti_per_meal', 3, t13);
  await f('diet_habits', 'chai 4x/day with 2 sugars', t13);
  await f('fasts_in_ramzan', true, t11);
  await f('caregiver', 'Bilal (son)', t13);
  await f('literacy', 'low', t14a, 0.6);
  // Contradiction: "twice daily" supersedes "once daily" → concern raised.
  await f('medications', ['Metformin (Glucophage) 500mg twice daily after meals'], t11);

  // ── readings: stable, then rising fasting + a biryani spike ─────────
  const r = (days: number, mgDl: number, ctx: string, hour: number) =>
    q(`INSERT INTO readings (patient_id, mg_dl, context, taken_at) VALUES ($1,$2,$3,$4)`, [pid, mgDl, ctx, ago(days, hour)]);
  const fasting = [118, 122, 120, 126, 119, 128, 124, 130, 132, 135, 142, 150, 158, 165];
  for (let d = 14; d >= 1; d--) await r(d, fasting[14 - d]!, 'fasting', 7);
  await r(12, 168, 'post_meal', 14); await r(9, 172, 'post_meal', 14); await r(6, 181, 'post_meal', 21);
  await r(4, 230, 'post_meal', 22); await r(3, 176, 'post_meal', 14);

  // ── meals ───────────────────────────────────────────────────────────
  const m = (days: number, desc: string, items: string[], hour: number) =>
    q(`INSERT INTO meals (patient_id, description_ur, items, eaten_at) VALUES ($1,$2,$3,$4)`, [pid, desc, JSON.stringify(items), ago(days, hour)]);
  await m(4, 'بریانی', ['biryani', 'raita'], 20);
  await m(6, 'روٹی سالن', ['roti', 'sabzi'], 20);
  await m(9, 'دال چاول', ['daal', 'chawal'], 13);
  await m(12, 'روٹی دال', ['roti', 'daal'], 13);

  // ── medication events: mostly taken, two missed evenings ────────────
  for (let d = 10; d >= 1; d--) {
    await q(`INSERT INTO med_events (patient_id, medication_id, taken, occurred_at) VALUES ($1,$2,true,$3)`, [pid, met!.id, ago(d, 9)]);
    const missed = d === 4 || d === 2;
    await q(`INSERT INTO med_events (patient_id, medication_id, taken, occurred_at) VALUES ($1,$2,$3,$4)`, [pid, met!.id, !missed, ago(d, 21)]);
  }

  // ── symptom + open concern (follow-up already due) ──────────────────
  await q(`INSERT INTO symptoms (patient_id, turn_id, code, severity, reported_at) VALUES ($1,$2,'foot_numbness','mild',$3)`, [pid, t7, ago(7)]);
  await raiseConcern({
    patientId: pid, kind: 'symptom',
    summaryUr: 'پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے — اب کیسا ہے؟',
    summaryEn: 'Reported foot numbness 7 days ago — check whether it persists',
    detail: { code: 'foot_numbness' }, followUpAt: ago(4),
  });
  await q(`UPDATE open_concerns SET raised_at=$2 WHERE patient_id=$1 AND detail->>'code'='foot_numbness'`, [pid, ago(7)]);

  // ── an amber alert from the biryani night ───────────────────────────
  await q(
    `INSERT INTO alerts (patient_id, severity, rule_id, reason_ur, reason_en, created_at)
     VALUES ($1,'amber','AMBER_SINGLE_HIGH','آپ کی شوگر معمول سے زیادہ ہے۔','Single reading between 180 and 300 mg/dL.',$2)`,
    [pid, ago(4, 22)],
  );

  console.log('  Ingesting knowledge base…');
  const n = await ingest();
  console.log(`  KB chunks: ${n || 'already present'}`);

  // Give the async embeddings a moment before the process exits.
  await new Promise((res) => setTimeout(res, 8_000));
  const emb = await q<{ n: number }>(`SELECT count(*)::int AS n FROM turns WHERE patient_id=$1 AND embedding IS NOT NULL`, [pid]);
  console.log(`  Demo patient ${pid}\n  Embedded turns: ${emb[0]?.n}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
