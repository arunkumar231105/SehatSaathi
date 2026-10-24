/**
 * A patient's medicines, explained and checked — assembled from their record.
 * Shared by the conversation (turn.ts), the app's Medicines screen, the
 * caregiver dashboard and the WhatsApp "doctor" command.
 */

import { q } from '../db/client.ts';
import { getProfile, longitudinal, type Features, type ProfileFact } from '../memory/engine.ts';
import { medicineChecks, doctorQuestions, type MedCheck, type DoctorQuestion, type MedCheckInput } from './checks.ts';
import type { Medicine, Source } from './reference.ts';
import type { SymptomCode } from '../safety/rules.ts';

type Lang = 'ur' | 'en';

export interface MedicineCard {
  asNamed: string;
  generic: string;
  brands: string[];
  causesLows: boolean;
  purpose: string;
  take: string;
  sideEffects: string;
  missedDose: string;
  warning: string;
  sources: Source[];
}

export interface MedicinePicture {
  cards: MedicineCard[];
  unknown: string[];
  checks: MedCheck[];
  questions: DoctorQuestion[];
}

const val = (facts: ProfileFact[], k: string) => facts.find((f) => f.key === k)?.value;
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v] : [];

/** The recorded medicine list: the profile fact first (it carries corrections), else the medications table. */
export async function medicineList(patientId: string, facts: ProfileFact[]): Promise<string[]> {
  const fromFacts = asList(val(facts, 'medications'));
  if (fromFacts.length) return fromFacts;
  const rows = await q<{ name: string; dose: string | null; schedule: string | null }>(
    `SELECT name, dose, schedule FROM medications WHERE patient_id=$1 AND active`, [patientId],
  );
  return rows.map((r) => [r.name, r.dose, r.schedule].filter(Boolean).join(' '));
}

export function checkInput(meds: string[], facts: ProfileFact[], f: Features, symptoms: SymptomCode[] = [], egfr: number | null = null): MedCheckInput {
  return {
    medications: meds,
    readings: f.readings.map((r) => ({ mg_dl: r.mg_dl, taken_at: r.taken_at })),
    missedDoses7: f.missedDoses7,
    risingFastingDays: f.risingFastingDays,
    timeInRange14: f.timeInRange14,
    fastsInRamzan: val(facts, 'fasts_in_ramzan') === true,
    pregnant: val(facts, 'pregnant') === true,
    conditions: asList(val(facts, 'comorbidities')),
    symptoms,
    egfr,
  };
}

export async function latestLab(patientId: string, kind: string): Promise<{ value: number; taken_on: string } | null> {
  const r = await q<{ value: string; taken_on: string }>(
    `SELECT value, taken_on FROM lab_results WHERE patient_id=$1 AND kind=$2 ORDER BY taken_on DESC, created_at DESC LIMIT 1`,
    [patientId, kind],
  ).catch(() => []);
  return r[0] ? { value: Number(r[0].value), taken_on: r[0].taken_on } : null;
}

export function card(asNamed: string, m: Medicine, lang: Lang): MedicineCard {
  return {
    asNamed, generic: m.generic, brands: m.brands, causesLows: m.causesLows,
    purpose: m.purpose[lang], take: m.take[lang], sideEffects: m.sideEffects[lang],
    missedDose: m.missedDose[lang], warning: m.warning[lang], sources: m.sources,
  };
}

export async function medicinePicture(patientId: string, lang: Lang, symptoms: SymptomCode[] = []): Promise<MedicinePicture> {
  const [facts, features] = await Promise.all([getProfile(patientId), longitudinal(patientId)]);
  const meds = await medicineList(patientId, facts);
  const egfr = await latestLab(patientId, 'egfr');
  const input = checkInput(meds, facts, features, symptoms, egfr?.value ?? null);
  const { checks, known, unknown } = medicineChecks(input);
  return {
    cards: known.flatMap((k) => k.medicines.map((m) => card(k.asNamed, m, lang))),
    unknown,
    checks,
    questions: doctorQuestions(input, checks, known, unknown),
  };
}

/** The doctor-visit list as one message, for WhatsApp and the "listen" button. */
export function questionsToText(qs: DoctorQuestion[], lang: Lang): string {
  const head = lang === 'en' ? 'Things to ask or tell your doctor at your next visit:' : 'اگلی بار ڈاکٹر سے یہ باتیں پوچھیں یا بتائیں:';
  return [head, ...qs.map((x, i) => `${i + 1}. ${lang === 'en' ? x.en : x.ur}`)].join('\n');
}
