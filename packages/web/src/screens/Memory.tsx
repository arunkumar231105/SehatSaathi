import { useEffect, useState } from 'react';
import { get, post, fmtDate, createPatient, useDemoPatient } from '../api.ts';

interface Fact {
  id: string; key: string; value: unknown; confidence: number; learned_at: string;
  supersedes: string | null; active: boolean; source_text: string | null; source_at: string | null;
}
interface Concern { id: string; kind: string; summary_ur: string; summary_en: string | null; raised_at: string; follow_up_at: string | null }
interface Data { facts: Fact[]; concerns: Concern[]; episodicCount: number }

const KEY_UR: Record<string, string> = {
  name: 'نام', age: 'عمر', gender: 'جنس', diabetes_type: 'ذیابیطس کی قسم', diagnosis_year: 'کب سے',
  medications: 'دوائیں', insulin: 'انسولین', comorbidities: 'دیگر بیماریاں', allergies: 'الرجی',
  roti_per_meal: 'روٹی فی کھانا', diet_habits: 'کھانے کی عادت', fasts_in_ramzan: 'رمضان کے روزے',
  exercise: 'ورزش', smoking: 'سگریٹ', work: 'کام', caregiver: 'گھر کا رابطہ', literacy: 'پڑھائی',
  lives_with: 'کس کے ساتھ رہتے ہیں', doctor: 'ڈاکٹر', glucometer: 'گلوکومیٹر', pregnant: 'حمل',
};
const KIND_UR: Record<string, string> = { symptom: 'علامت', contradiction: 'تضاد', adherence: 'دوا', trend: 'رجحان' };

const show = (v: unknown) => (Array.isArray(v) ? v.join('، ') : typeof v === 'boolean' ? (v ? 'ہاں' : 'نہیں') : String(v));

export default function Memory({ patientId, onPatientChange }: { patientId: string; onPatientChange: (id: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [showOld, setShowOld] = useState(false);
  const load = () => get<Data>(`/api/patients/${patientId}/memory`).then(setD);
  useEffect(() => { void load(); }, [patientId]);
  if (!d) return <div className="loading">لوڈ ہو رہا ہے…</div>;

  const active = d.facts.filter((f) => f.active);
  const old = d.facts.filter((f) => !f.active);

  return (
    <section className="screen">
      <h2>میں آپ کے بارے میں کیا جانتی ہوں</h2>
      <p className="muted">{active.length} باتیں یاد ہیں · {d.episodicCount} گفتگو محفوظ</p>

      {d.concerns.length > 0 && (
        <div className="card card--concern">
          <div className="card__h">جن باتوں کا پوچھنا ہے</div>
          {d.concerns.map((c) => (
            <div key={c.id} className="concern">
              <span className={`tag tag--${c.kind}`}>{KIND_UR[c.kind] ?? c.kind}</span>
              <div>{c.summary_ur}</div>
              <div className="muted small">{fmtDate(c.raised_at)} سے</div>
              <button className="link" onClick={() => post(`/api/concerns/${c.id}/resolve`).then(load)}>حل ہو گیا</button>
            </div>
          ))}
        </div>
      )}

      {active.map((f) => (
        <div key={f.id} className="fact">
          <div className="fact__k">{KEY_UR[f.key] ?? f.key}</div>
          <div className="fact__v">{show(f.value)}</div>
          <div className="fact__meta">
            <span title="confidence">{Math.round(f.confidence * 100)}٪ یقین</span>
            {f.supersedes && <span className="tag tag--contradiction">پہلے کچھ اور تھا</span>}
          </div>
          {f.source_text && (
            <div className="fact__src">
              <span className="muted small">{f.source_at ? fmtDate(f.source_at) : ''} کو آپ نے کہا:</span>
              <q>{f.source_text}</q>
            </div>
          )}
        </div>
      ))}

      {old.length > 0 && (
        <>
          <button className="link" onClick={() => setShowOld((s) => !s)}>
            {showOld ? 'پرانی باتیں چھپائیں' : `پرانی باتیں دیکھیں (${old.length})`}
          </button>
          {showOld && old.map((f) => (
            <div key={f.id} className="fact fact--old">
              <div className="fact__k">{KEY_UR[f.key] ?? f.key}</div>
              <div className="fact__v">{show(f.value)}</div>
              <div className="muted small">{fmtDate(f.learned_at)} — بعد میں بدل گیا</div>
            </div>
          ))}
        </>
      )}

      <div className="card">
        <div className="card__h">مریض</div>
        <div className="row-btns">
          <button className="btn btn--ghost" onClick={() => useDemoPatient().then(onPatientChange)}>ڈیمو مریض (راشدہ بی بی)</button>
          <button className="btn btn--ghost" onClick={() => createPatient().then(onPatientChange)}>نیا مریض شروع کریں</button>
        </div>
      </div>
    </section>
  );
}
