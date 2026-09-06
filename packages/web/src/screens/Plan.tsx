import { useEffect, useState } from 'react';
import { get, getLang } from '../api.ts';
import { t as tr, lang } from '../i18n.ts';

interface Action {
  category: 'movement' | 'food' | 'medicine' | 'monitoring' | 'feet' | 'doctor';
  becauseEn: string; becauseUr: string;
  doEn: string; doUr: string;
  weight: number;
}
interface Data { text: string; actions: Action[] }

const ICON: Record<Action['category'], string> = {
  movement: '🚶', food: '🍽', medicine: '💊', monitoring: '🩸', feet: '🦶', doctor: '🩺',
};
const LABEL_UR: Record<Action['category'], string> = {
  movement: 'چہل قدمی', food: 'کھانا', medicine: 'دوا', monitoring: 'شوگر چیک', feet: 'پاؤں', doctor: 'ڈاکٹر',
};
const LABEL_EN: Record<Action['category'], string> = {
  movement: 'Movement', food: 'Food', medicine: 'Medicine', monitoring: 'Monitoring', feet: 'Feet', doctor: 'Doctor',
};

/**
 * The weekly plan. Deliberately shows the reason beside each action — a
 * patient is far more likely to walk after dinner when they can see it is
 * because their own morning readings have risen five days running.
 */
export default function Plan({ patientId }: { patientId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const s = tr();
  const en = lang() === 'en';

  useEffect(() => {
    void get<Data>(`/api/patients/${patientId}/plan?lang=${getLang()}`).then(setD);
    try {
      const raw = localStorage.getItem(`sehat.plandone.${new Date().toISOString().slice(0, 10)}`);
      if (raw) setDone(new Set(JSON.parse(raw) as number[]));
    } catch { /* a fresh day, or storage blocked */ }
  }, [patientId]);

  const toggle = (i: number) => {
    const next = new Set(done);
    next.has(i) ? next.delete(i) : next.add(i);
    setDone(next);
    // Ticks are a per-day nudge, not clinical data — local to the device.
    try {
      localStorage.setItem(`sehat.plandone.${new Date().toISOString().slice(0, 10)}`, JSON.stringify([...next]));
    } catch { /* private mode */ }
  };

  if (!d) return <div className="loading">{s.loading}</div>;

  const top = d.actions.slice(0, 6);
  const speak = () => {
    const a = new Audio(`/api/tts?lang=${getLang()}&text=${encodeURIComponent(d.text)}`);
    void a.play().catch(() => undefined);
  };

  return (
    <section className="screen">
      <h2>{en ? 'Your plan this week' : 'اس ہفتے کا منصوبہ'}</h2>
      <p className="muted">
        {en
          ? 'Built from your own readings — not general advice.'
          : 'آپ کی اپنی ریڈنگز سے بنایا گیا ہے — عام مشورہ نہیں۔'}
      </p>

      {top.length === 0 && (
        <div className="card">
          {en
            ? 'Not enough readings yet. Tell me your sugar for a few days and I will build a plan.'
            : 'ابھی کافی ریڈنگز نہیں۔ چند دن اپنی شوگر بتائیں تو منصوبہ بن جائے گا۔'}
        </div>
      )}

      {top.map((a, i) => (
        <div key={i} className={`act ${done.has(i) ? 'act--done' : ''}`}>
          <button
            className="act__tick"
            onClick={() => toggle(i)}
            aria-label={done.has(i) ? 'undo' : 'mark done'}
          >
            {done.has(i) ? '✓' : ''}
          </button>
          <div className="act__body">
            <div className="act__tag">
              <span className="act__i">{ICON[a.category]}</span>
              {(en ? LABEL_EN : LABEL_UR)[a.category]}
            </div>
            <div className="act__do">{en ? a.doEn : a.doUr}</div>
            <div className="act__why">{en ? a.becauseEn : a.becauseUr}</div>
          </div>
        </div>
      ))}

      {top.length > 0 && (
        <button className="btn btn--primary" onClick={speak} style={{ marginTop: '.6rem' }}>
          🔊 {en ? 'Listen to the plan' : 'منصوبہ سنیں'}
        </button>
      )}

      <p className="fine" style={{ marginTop: '1rem' }}>
        {en
          ? 'This plan covers food, movement, routine and monitoring. It never recommends a medicine or a dose — that is your doctor’s decision.'
          : 'یہ منصوبہ کھانے، چہل قدمی، معمول اور شوگر چیک کرنے کے بارے میں ہے۔ یہ کبھی دوا یا اس کی مقدار تجویز نہیں کرتا — یہ فیصلہ آپ کے ڈاکٹر کا ہے۔'}
      </p>
    </section>
  );
}
