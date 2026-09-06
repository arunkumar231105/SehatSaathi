import { useEffect, useState } from 'react';
import { get, post, fmtDate, fmtTime, daysAgo } from '../api.ts';

interface Alert {
  id: string; severity: 'red' | 'amber'; rule_id: string; reason_ur: string; reason_en: string;
  acknowledged_at: string | null; created_at: string; patient_id: string; display_name: string | null;
  phone: string | null; caregiver_phone: string | null; trigger_text: string | null;
}
interface Pt {
  id: string; display_name: string | null; phone: string | null; caregiver_phone: string | null;
  last_mg_dl: number | null; last_at: string | null; open_red: number; open_concerns: number;
}
interface Summary {
  features: { mean7: number | null; timeInRange14: number | null; risingFastingDays: number; dawnPhenomenon: boolean; missedDoses7: number; adherenceStreakDays: number; spikeFoods: string[]; postMealSpikes7: number };
  facts: { key: string; value: unknown }[];
  concerns: { id: string; summary_en: string | null; summary_ur: string }[];
}

/**
 * Caregiver dashboard. English-first: the caregiver is usually a younger
 * family member with a smartphone, and clinicians read English.
 */
export default function Care() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pts, setPts] = useState<Pt[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [flash, setFlash] = useState(false);

  const load = async () => {
    const [a, p] = await Promise.all([get<Alert[]>('/api/care/alerts'), get<Pt[]>('/api/care/patients')]);
    setAlerts(a); setPts(p);
  };

  useEffect(() => {
    void load();
    const es = new EventSource('/api/care/stream');
    es.addEventListener('alert', () => { setFlash(true); void load(); setTimeout(() => setFlash(false), 2500); });
    const t = setInterval(load, 30_000);
    return () => { es.close(); clearInterval(t); };
  }, []);

  useEffect(() => {
    if (sel) void get<Summary>(`/api/patients/${sel}/summary`).then(setSum);
  }, [sel]);

  const openRed = alerts.filter((a) => a.severity === 'red' && !a.acknowledged_at);

  return (
    <section className={`screen care ${flash ? 'care--flash' : ''}`} dir="ltr">
      <h2>Caregiver dashboard</h2>
      <p className="muted">Live · updates instantly when a patient's turn triggers a rule</p>

      {openRed.length > 0 && (
        <div className="redbar">🚨 {openRed.length} unacknowledged emergency alert{openRed.length > 1 ? 's' : ''}</div>
      )}

      <h3>Patients</h3>
      <div className="ptgrid">
        {pts.map((p) => (
          <button key={p.id} className={`pt ${p.open_red ? 'pt--red' : ''} ${sel === p.id ? 'pt--sel' : ''}`} onClick={() => setSel(p.id)}>
            <div className="pt__name" dir="rtl">{p.display_name ?? p.phone ?? 'Unnamed'}</div>
            <div className="pt__stats">
              <span>{p.last_mg_dl ?? '—'} mg/dL</span>
              <span className="muted">{p.last_at ? `${daysAgo(p.last_at)}d ago` : 'no readings'}</span>
            </div>
            <div className="pt__flags">
              {p.open_red > 0 && <span className="tag tag--red">{p.open_red} red</span>}
              {p.open_concerns > 0 && <span className="tag tag--symptom">{p.open_concerns} to follow up</span>}
            </div>
          </button>
        ))}
      </div>

      {sel && sum && (
        <div className="card">
          <div className="card__h">Clinical picture</div>
          <ul className="plain">
            <li>7-day mean: <b>{sum.features.mean7 ?? '—'}</b> · Time-in-range (14d): <b>{sum.features.timeInRange14 ?? '—'}%</b></li>
            {sum.features.risingFastingDays >= 3 && <li>⚠ Fasting readings rising {sum.features.risingFastingDays} days running</li>}
            {sum.features.dawnPhenomenon && <li>⚠ Dawn phenomenon pattern</li>}
            {sum.features.postMealSpikes7 > 0 && <li>{sum.features.postMealSpikes7} post-meal spike(s){sum.features.spikeFoods.length ? ` — after ${sum.features.spikeFoods.join(', ')}` : ''}</li>}
            {sum.features.missedDoses7 > 0 ? <li>❌ {sum.features.missedDoses7} missed dose(s) this week</li> : <li>✅ Medication streak: {sum.features.adherenceStreakDays} days</li>}
          </ul>
          {sum.concerns.length > 0 && (
            <>
              <div className="card__h">Open follow-ups</div>
              <ul className="plain">{sum.concerns.map((c) => <li key={c.id}>{c.summary_en ?? c.summary_ur}</li>)}</ul>
            </>
          )}
          <div className="card__h">Profile</div>
          <ul className="plain small">{sum.facts.map((f) => <li key={f.key}><b>{f.key}</b>: {Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}</li>)}</ul>
        </div>
      )}

      <h3>Alerts</h3>
      {alerts.length === 0 && <p className="muted">No alerts yet.</p>}
      {alerts.map((a) => (
        <div key={a.id} className={`alert alert--${a.severity} ${a.acknowledged_at ? 'alert--ack' : ''}`}>
          <div className="alert__top">
            <span className={`tag tag--${a.severity}`}>{a.severity.toUpperCase()}</span>
            <b dir="rtl">{a.display_name ?? a.phone}</b>
            <span className="muted">{fmtDate(a.created_at)} {fmtTime(a.created_at)}</span>
          </div>
          <div className="alert__en">{a.reason_en}</div>
          <div className="alert__ur" dir="rtl">{a.reason_ur}</div>
          {a.trigger_text && <div className="alert__trig" dir="rtl">«{a.trigger_text}»</div>}
          <div className="alert__meta muted small">rule: {a.rule_id}</div>
          <div className="row-btns">
            {!a.acknowledged_at && <button className="btn" onClick={() => post(`/api/care/alerts/${a.id}/ack`).then(load)}>Acknowledge</button>}
            {a.caregiver_phone && (
              <a className="btn btn--wa" target="_blank" rel="noreferrer"
                 href={`https://wa.me/${a.caregiver_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`⚠️ SehatSaathi: ${a.display_name ?? ''} — ${a.reason_en}\n${a.reason_ur}\nEmergency: 1122`)}`}>
                WhatsApp family
              </a>
            )}
            <a className="btn btn--danger" href="tel:1122">Call 1122</a>
          </div>
        </div>
      ))}
    </section>
  );
}
