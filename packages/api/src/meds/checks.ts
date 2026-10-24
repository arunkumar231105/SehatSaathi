/**
 * Medicine safety checks and questions for the doctor.
 *
 * Same principle as safety/rules.ts: these are fixed rules over the patient's
 * recorded medicines, readings and profile — not model judgements — so the
 * same record always produces the same flags, and every flag is inspectable.
 *
 * Every output points the patient TOWARD their doctor. Nothing here tells
 * anyone to start, stop, skip or change a medicine or a dose; where a leaflet
 * says "speak to your doctor the same day", that is exactly what we say.
 */

import { identifyList, type Identified, type Medicine, type MedClass } from './reference.ts';
import type { SymptomCode } from '../safety/rules.ts';

export interface MedCheckInput {
  /** The patient's recorded medicine list, as stored ("Metformin (Glucophage) 500mg twice daily"). */
  medications: string[];
  /** Readings from the last 14+ days. */
  readings: { mg_dl: number; taken_at: string | Date }[];
  missedDoses7: number;
  risingFastingDays: number;
  timeInRange14: number | null;
  fastsInRamzan: boolean;
  pregnant: boolean;
  /** Free-text conditions from the profile ("hypertension", "heart failure", "kidney disease"). */
  conditions: string[];
  /** Symptoms reported in the current conversation. */
  symptoms: SymptomCode[];
  /** Latest kidney function from a lab result, mL/min/1.73m², if known. */
  egfr?: number | null;
}

export interface MedCheck {
  id: string;
  /** 'today' — speak to a doctor the same day. 'review' — raise at the next visit. */
  urgency: 'today' | 'review';
  clinicianEn: string;
  patientEn: string;
  patientUr: string;
}

export interface DoctorQuestion { en: string; ur: string }

const DAY = 86_400_000;
/** "Metformin (Glucophage) 500mg twice daily" -> "Metformin (Glucophage)": the name a patient recognises, without the dose. */
export const shortName = (entry: string) => entry.split(/\s+\d/)[0]!.trim() || entry;
const has = (meds: Medicine[], cls: MedClass) => meds.some((m) => m.classId === cls);
const names = (meds: Medicine[], cls?: MedClass) =>
  [...new Set(meds.filter((m) => !cls || m.classId === cls).map((m) => m.generic))].join(', ');

export function medicineChecks(input: MedCheckInput): { checks: MedCheck[]; known: Identified[]; unknown: string[] } {
  const { known, unknown } = identifyList(input.medications);
  const all = known.flatMap((k) => k.medicines);
  const checks: MedCheck[] = [];
  const add = (c: MedCheck) => checks.push(c);

  // ── The same medicine twice, usually via a combination tablet ─────────────
  const seen = new Map<string, string>();
  for (const k of known) {
    for (const m of k.medicines) {
      const prev = seen.get(m.id);
      const here = shortName(k.asNamed);
      if (prev && prev !== here) {
        add({
          id: `DUPLICATE_${m.id.toUpperCase()}`, urgency: 'today',
          clinicianEn: `${m.generic} appears twice: "${prev}" and "${here}" — possible double dosing.`,
          patientEn: `Two of your medicines ("${prev}" and "${here}") both contain ${m.generic}. Please show both to your doctor or pharmacist soon to make sure you are not taking it twice — do not change anything until they tell you.`,
          patientUr: `آپ کی دو دواؤں ("${prev}" اور "${here}") میں ایک ہی دوا ${m.generic} ہے۔ دونوں جلد ڈاکٹر یا فارماسسٹ کو دکھائیں تاکہ یقین ہو کہ دوا دو بار تو نہیں لی جا رہی — ان کے کہنے تک خود کچھ نہ بدلیں۔`,
        });
      }
      seen.set(m.id, here);
    }
  }

  // ── Two medicines from the same family ────────────────────────────────────
  for (const cls of ['sulfonylurea', 'dpp4', 'sglt2'] as const) {
    const distinct = new Set(all.filter((m) => m.classId === cls).map((m) => m.id));
    if (distinct.size > 1) {
      add({
        id: `SAME_CLASS_${cls.toUpperCase()}`, urgency: 'review',
        clinicianEn: `Two ${cls} agents recorded together: ${names(all, cls)}.`,
        patientEn: `You have two medicines from the same family (${names(all, cls)}). They are not usually taken together — please ask your doctor at your next visit whether both are meant.`,
        patientUr: `آپ کے پاس ایک ہی قسم کی دو دوائیں ہیں (${names(all, cls)})۔ عام طور پر یہ ایک ساتھ نہیں لی جاتیں — اگلی بار ڈاکٹر سے پوچھیں کہ کیا دونوں لینی ہیں۔`,
      });
    }
  }

  // ── Lows on a medicine that causes them ───────────────────────────────────
  const lowCausers = all.filter((m) => m.causesLows);
  const lows = input.readings.filter((r) => r.mg_dl < 70 && Date.now() - new Date(r.taken_at).getTime() < 14 * DAY).length;
  if (lowCausers.length && lows > 0) {
    add({
      id: 'LOWS_ON_HYPO_CAUSING_MED', urgency: lows >= 2 ? 'today' : 'review',
      clinicianEn: `${lows} reading(s) <70 mg/dL in 14 days on ${names(lowCausers)}.`,
      patientEn: `Your sugar went below 70 ${lows === 1 ? 'once' : `${lows} times`} in the last two weeks, and ${names(lowCausers)} can cause lows. Tell your doctor ${lows >= 2 ? 'soon' : 'at your next visit'} — they may want to look at your treatment. Do not skip meals.`,
      patientUr: `پچھلے دو ہفتوں میں آپ کی شوگر ${lows === 1 ? 'ایک بار' : `${lows} بار`} 70 سے کم ہوئی، اور ${names(lowCausers)} سے شوگر کم ہو سکتی ہے۔ ${lows >= 2 ? 'جلد' : 'اگلی بار'} ڈاکٹر کو بتائیں — وہ علاج دیکھنا چاہیں گے۔ کھانا نہ چھوڑیں۔`,
    });
  }

  // ── Being unwell on medicines with sick-day warnings ──────────────────────
  const sick = input.symptoms.some((s) => ['vomiting', 'nausea', 'abdominal_pain', 'rapid_breathing', 'fruity_breath'].includes(s));
  if (sick && has(all, 'sglt2')) {
    add({
      id: 'SGLT2_WHILE_UNWELL', urgency: 'today',
      clinicianEn: `Vomiting/abdominal symptoms on an SGLT2 inhibitor (${names(all, 'sglt2')}) — euglycaemic DKA risk.`,
      patientEn: `With ${names(all, 'sglt2')}, being sick or having stomach pain can lead to a dangerous acid build-up even if your sugar is not very high. Contact your doctor today about your medicines.`,
      patientUr: `${names(all, 'sglt2')} کے ساتھ الٹی یا پیٹ درد ہو تو شوگر زیادہ نہ ہونے پر بھی جسم میں خطرناک تیزابیت ہو سکتی ہے۔ آج ہی اپنی دواؤں کے بارے میں ڈاکٹر سے رابطہ کریں۔`,
    });
  }
  if (input.symptoms.includes('vomiting') && has(all, 'biguanide')) {
    add({
      id: 'METFORMIN_WHILE_VOMITING', urgency: 'today',
      clinicianEn: 'Vomiting on metformin — dehydration / lactic acidosis risk.',
      patientEn: 'Vomiting while taking metformin can dehydrate you. Keep sipping water and speak to your doctor or pharmacist today about your medicines.',
      patientUr: 'میٹفارمن کے ساتھ الٹی ہو تو جسم میں پانی کی کمی ہو سکتی ہے۔ تھوڑا تھوڑا پانی پیتے رہیں اور آج ہی ڈاکٹر یا فارماسسٹ سے اپنی دواؤں کے بارے میں بات کریں۔',
    });
  }

  // ── Profile-based cautions ────────────────────────────────────────────────
  const cond = input.conditions.join(' ').toLowerCase();
  if (has(all, 'tzd') && /heart failure|heart|دل/.test(cond)) {
    add({
      id: 'PIOGLITAZONE_HEART', urgency: 'review',
      clinicianEn: 'Pioglitazone with a recorded heart condition — label warns against use in heart failure.',
      patientEn: 'Pioglitazone can cause fluid build-up, which matters with a heart condition. Ask your doctor whether it is right for you, and tell them at once about swollen legs or breathlessness.',
      patientUr: 'پائیوگلیٹازون سے جسم میں پانی رک سکتا ہے، جو دل کی بیماری میں اہم ہے۔ ڈاکٹر سے پوچھیں کہ یہ آپ کے لیے ٹھیک ہے، اور ٹانگوں میں سوجن یا سانس پھولنے پر فوراً بتائیں۔',
    });
  }
  // A measured eGFR beats a free-text condition: the leaflets set hard limits.
  if (input.egfr != null && has(all, 'biguanide') && input.egfr < 30) {
    add({
      id: 'METFORMIN_EGFR_BELOW_30', urgency: 'today',
      clinicianEn: `eGFR ${input.egfr} on metformin — contraindicated below 30 (label).`,
      patientEn: `Your latest kidney test (eGFR ${input.egfr}) is low, and metformin is not used when kidney function is this low. Please contact your doctor today about your medicines — do not change anything on your own.`,
      patientUr: `آپ کا گردوں کا تازہ ٹیسٹ (eGFR ${input.egfr}) کم ہے، اور اتنا کم ہو تو میٹفارمن استعمال نہیں ہوتی۔ آج ہی اپنی دواؤں کے بارے میں ڈاکٹر سے رابطہ کریں — خود سے کچھ نہ بدلیں۔`,
    });
  } else if (input.egfr != null && has(all, 'biguanide') && input.egfr < 45) {
    add({
      id: 'METFORMIN_EGFR_30_45', urgency: 'review',
      clinicianEn: `eGFR ${input.egfr} on metformin — dose review advised between 30 and 45 (label).`,
      patientEn: `Your latest kidney test (eGFR ${input.egfr}) means your metformin dose may need checking. Ask your doctor at your next visit.`,
      patientUr: `آپ کے گردوں کے تازہ ٹیسٹ (eGFR ${input.egfr}) کی وجہ سے میٹفارمن کی مقدار دیکھنے کی ضرورت ہو سکتی ہے۔ اگلی بار ڈاکٹر سے پوچھیں۔`,
    });
  } else if ((has(all, 'biguanide') || has(all, 'sglt2')) && /kidney|renal|گردے/.test(cond)) {
    add({
      id: 'KIDNEY_MONITORING', urgency: 'review',
      clinicianEn: `Kidney disease recorded with ${names(all.filter((m) => m.classId === 'biguanide' || m.classId === 'sglt2'))} — dose depends on eGFR.`,
      patientEn: 'With a kidney problem, the right dose of some diabetes medicines depends on a kidney blood test. Ask your doctor when your kidney test was last done.',
      patientUr: 'گردوں کی تکلیف میں کچھ شوگر کی دواؤں کی مقدار گردوں کے خون کے ٹیسٹ پر منحصر ہوتی ہے۔ ڈاکٹر سے پوچھیں کہ گردوں کا ٹیسٹ آخری بار کب ہوا۔',
    });
  }
  if (input.pregnant && all.some((m) => m.classId !== 'insulin' && m.classId !== 'biguanide')) {
    add({
      id: 'PREGNANCY_ORAL_AGENT', urgency: 'today',
      clinicianEn: `Pregnancy recorded with ${names(all.filter((m) => m.classId !== 'insulin' && m.classId !== 'biguanide'))}.`,
      patientEn: 'Some diabetes tablets are not used in pregnancy. Please see your doctor soon so they can check your medicines — do not stop anything on your own.',
      patientUr: 'حمل میں شوگر کی کچھ گولیاں استعمال نہیں ہوتیں۔ جلد ڈاکٹر کو دکھائیں تاکہ وہ آپ کی دوائیں دیکھ لیں — خود سے کوئی دوا بند نہ کریں۔',
    });
  }
  if (input.fastsInRamzan && (lowCausers.length || has(all, 'sglt2'))) {
    add({
      id: 'RAMZAN_PLAN', urgency: 'review',
      clinicianEn: `Fasts in Ramzan on ${names(all.filter((m) => m.causesLows || m.classId === 'sglt2'))} — needs a pre-Ramadan plan (IDF-DAR).`,
      patientEn: `You fast in Ramzan, and ${names(all.filter((m) => m.causesLows || m.classId === 'sglt2'))} can cause lows or dehydration while fasting. See your doctor 6–8 weeks before Ramzan to plan your medicine times.`,
      patientUr: `آپ رمضان میں روزے رکھتے ہیں، اور ${names(all.filter((m) => m.causesLows || m.classId === 'sglt2'))} سے روزے میں شوگر کم یا پانی کی کمی ہو سکتی ہے۔ رمضان سے 6–8 ہفتے پہلے ڈاکٹر سے دواؤں کے وقت طے کریں۔`,
    });
  }

  return { checks, known, unknown };
}

/**
 * Questions to take to the next appointment, built from the patient's own
 * record. A low-literacy patient often leaves a 5-minute visit without having
 * said the one thing that mattered; this is that thing, written down.
 */
export function doctorQuestions(input: MedCheckInput, checks: MedCheck[], known: Identified[], unknown: string[]): DoctorQuestion[] {
  const out: DoctorQuestion[] = [];
  const medList = known.map((k) => shortName(k.asNamed)).join(', ');

  for (const c of checks.filter((x) => x.urgency === 'today')) out.push({ en: c.patientEn, ur: c.patientUr });

  if (input.risingFastingDays >= 3) {
    out.push({
      en: `My morning (fasting) sugar has risen ${input.risingFastingDays} days in a row${medList ? ` while taking ${medList}` : ''}. Does my treatment need a review?`,
      ur: `میری صبح خالی پیٹ کی شوگر ${input.risingFastingDays} دن سے مسلسل بڑھ رہی ہے${medList ? ` حالانکہ میں ${medList} لے رہا/رہی ہوں` : ''}۔ کیا میرے علاج پر دوبارہ غور کی ضرورت ہے؟`,
    });
  }
  if (input.timeInRange14 !== null && input.timeInRange14 < 50) {
    out.push({
      en: `Only ${input.timeInRange14}% of my readings in the last two weeks were between 70 and 180. What should we change?`,
      ur: `پچھلے دو ہفتوں میں میری صرف ${input.timeInRange14}٪ ریڈنگز 70 سے 180 کے درمیان تھیں۔ ہمیں کیا بدلنا چاہیے؟`,
    });
  }
  if (input.missedDoses7 >= 2) {
    out.push({
      en: `I missed my medicine ${input.missedDoses7} times this week. Could the timing or number of doses be made simpler for me?`,
      ur: `اس ہفتے میری دوا ${input.missedDoses7} بار رہ گئی۔ کیا دوا کا وقت یا تعداد میرے لیے آسان کی جا سکتی ہے؟`,
    });
  }
  for (const c of checks.filter((x) => x.urgency === 'review')) out.push({ en: c.patientEn, ur: c.patientUr });
  for (const u of unknown) {
    out.push({ en: `What is "${u}" for, and how should I take it?`, ur: `"${u}" کس لیے ہے اور اسے کیسے لینا ہے؟` });
  }
  if (!known.length && !unknown.length) {
    out.push({ en: 'Please write down the names and times of all my diabetes medicines for me.', ur: 'براہِ کرم میری شوگر کی تمام دواؤں کے نام اور وقت لکھ دیں۔' });
  }
  out.push({ en: 'When should I next have my HbA1c (3-month sugar) test, and my kidney and eye checks?', ur: 'میرا اگلا HbA1c (تین مہینے کی شوگر) کا ٹیسٹ، اور گردوں اور آنکھوں کا معائنہ کب ہونا چاہیے؟' });
  return out.slice(0, 6);
}
