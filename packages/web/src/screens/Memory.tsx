import { useEffect, useState } from 'react';
import { get, post, fmtDate, createPatient, useDemoPatient } from '../api.ts';
import { t as tr, lang } from '../i18n.ts';
import { Icon, Skeleton } from '../ui/Icon.tsx';

interface Fact {
  id: string; key: string; value: unknown; confidence: number; learned_at: string;
  supersedes: string | null; active: boolean; source_text: string | null; source_at: string | null;
}
interface Concern { id: string; kind: string; summary_ur: string; summary_en: string | null; raised_at: string; follow_up_at: string | null }
interface Data { facts: Fact[]; concerns: Concern[]; episodicCount: number }

const KEY_EN: Record<string, string> = {
  name: 'Name', age: 'Age', gender: 'Gender', diabetes_type: 'Diabetes type', diagnosis_year: 'Diagnosed',
  medications: 'Medicines', insulin: 'Insulin', comorbidities: 'Other conditions', allergies: 'Allergies',
  roti_per_meal: 'Rotis per meal', diet_habits: 'Eating habits', fasts_in_ramzan: 'Fasts in Ramzan',
  exercise: 'Exercise', smoking: 'Smoking', work: 'Work', caregiver: 'Family contact', literacy: 'Literacy',
  lives_with: 'Lives with', doctor: 'Doctor', glucometer: 'Glucometer', pregnant: 'Pregnant',
};
const KIND_EN: Record<string, string> = { symptom: 'symptom', contradiction: 'conflict', adherence: 'medicine', trend: 'trend' };
const KEY_UR: Record<string, string> = {
  name: 'نام', age: 'عمر', gender: 'جنس', diabetes_type: 'ذیابیطس کی قسم', diagnosis_year: 'کب سے',
  medications: 'دوائیں', insulin: 'انسولین', comorbidities: 'دیگر بیماریاں', allergies: 'الرجی',
  roti_per_meal: 'روٹی فی کھانا', diet_habits: 'کھانے کی عادت', fasts_in_ramzan: 'رمضان کے روزے',
  exercise: 'ورزش', smoking: 'سگریٹ', work: 'کام', caregiver: 'گھر کا رابطہ', literacy: 'پڑھائی',
  lives_with: 'کس کے ساتھ رہتے ہیں', doctor: 'ڈاکٹر', glucometer: 'گلوکومیٹر', pregnant: 'حمل',
};
const KIND_UR: Record<string, string> = { symptom: 'علامت', contradiction: 'تضاد', adherence: 'دوا', trend: 'رجحان' };

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(lang() === 'en' ? ', ' : '، ')
  : typeof v === 'boolean' ? (lang() === 'en' ? (v ? 'Yes' : 'No') : (v ? 'ہاں' : 'نہیں'))
  : String(v);

export default function Memory({ patientId, onPatientChange }: { patientId: string; onPatientChange: (id: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [showOld, setShowOld] = useState(false);
  const load = () => get<Data>(`/api/patients/${patientId}/memory`).then(setD);
  useEffect(() => { void load(); }, [patientId]);
  const s = tr();
  if (!d) return <section className="screen"><Skeleton /></section>;

  const active = d.facts.filter((f) => f.active);
  const old = d.facts.filter((f) => !f.active);

  return (
    <section className="screen">
      <header className="screen__head">
        <h2>{s.memoryTitle}</h2>
        <p className="muted">{s.memoryCount(active.length, d.episodicCount)}</p>
      </header>

      {d.concerns.length > 0 && (
        <div className="card card--concern">
          <div className="card__h"><Icon name="bell" size={18} /> {s.concernsTitle}</div>
          {d.concerns.map((c) => (
            <div key={c.id} className="concern">
              <span className={`tag tag--${c.kind}`}>{(lang() === 'en' ? KIND_EN : KIND_UR)[c.kind] ?? c.kind}</span>
              <div>{lang() === 'en' ? (c.summary_en ?? c.summary_ur) : c.summary_ur}</div>
              <div className="muted small">{lang() === 'en' ? `${s.since} ${fmtDate(c.raised_at)}` : `${fmtDate(c.raised_at)} ${s.since}`}</div>
              <button className="btn btn--sm btn--soft" onClick={() => post(`/api/concerns/${c.id}/resolve`).then(load)}><Icon name="check" size={16} /> {s.resolved}</button>
            </div>
          ))}
        </div>
      )}

      <div className="facts">
      {active.map((f) => (
        <div key={f.id} className="fact">
          <div className="fact__k">{(lang() === 'en' ? KEY_EN : KEY_UR)[f.key] ?? f.key}</div>
          <div className="fact__v">{show(f.value)}</div>
          <div className="fact__meta">
            <span title="confidence">{s.confidence(Math.round(f.confidence * 100))}</span>
            {f.supersedes && <span className="tag tag--contradiction">{s.changedBefore}</span>}
          </div>
          {f.source_text && (
            <div className="fact__src">
              <span className="muted small">{s.youSaidOn(f.source_at ? fmtDate(f.source_at) : '')}</span>
              <q>{f.source_text}</q>
            </div>
          )}
        </div>
      ))}
      </div>

      {old.length > 0 && (
        <>
          <button className="link" onClick={() => setShowOld((v) => !v)}>
            {showOld ? s.hideOld : s.showOld(old.length)}
          </button>
          {showOld && old.map((f) => (
            <div key={f.id} className="fact fact--old">
              <div className="fact__k">{(lang() === 'en' ? KEY_EN : KEY_UR)[f.key] ?? f.key}</div>
              <div className="fact__v">{show(f.value)}</div>
              <div className="muted small">{fmtDate(f.learned_at)} — {s.changedLater}</div>
            </div>
          ))}
        </>
      )}

      <div className="card">
        <div className="card__h"><Icon name="user" size={18} /> {s.patient}</div>
        <div className="row-btns">
          <button className="btn btn--ghost" onClick={() => useDemoPatient().then(onPatientChange)}>{s.demoPatient}</button>
          <button className="btn btn--ghost" onClick={() => createPatient().then(onPatientChange)}>{s.newPatient}</button>
        </div>
      </div>
    </section>
  );
}
