import { useEffect, useState } from 'react';
import { api, useMe } from '../auth.ts';
import { navigate } from '../router.tsx';
import { Icon, Skeleton } from '../ui/Icon.tsx';
import { STAGE, TREND, when, type Progress, type Order } from './parts.tsx';
import { LAB, type Lab } from './labs.tsx';

interface Detail {
  patient: { id: string; display_name: string | null; phone: string | null };
  progress: Progress; readings: { mg_dl: number; taken_at: string; context: string | null }[];
  alerts: { id: string; severity: string; reason_en: string; created_at: string }[];
  orders: Order[]; labs: Lab[];
  medicines: { cards: { asNamed: string; generic: string; causesLows: boolean }[]; unknown: string[]; checks: { id: string; urgency: string; clinicianEn: string }[]; questions: { en: string }[] };
  concerns: { id: string; summary_en: string | null; summary_ur: string }[];
}

/**
 * A one-page visit summary, laid out for paper. Patients bring it to a
 * clinic that has never seen the app; doctors save it as a PDF for the file.
 */
export default function Summary() {
  const me = useMe();
  const id = new URLSearchParams(location.search).get('p');
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!me.loaded) return;
    if (!me.user) { navigate('/login'); return; }
    if (id) api.get<Detail>(`/api/portal/patients/${id}?lang=en`).then(setD).catch((e) => setErr((e as Error).message));
  }, [me.loaded, me.user, id]);

  if (err) return <section className="screen"><div className="err">{err}</div></section>;
  if (!d) return <section className="screen"><Skeleton /></section>;

  const p = d.progress;
  const active = d.orders.filter((o) => o.status === 'active');
  const meds = [...d.medicines.cards.reduce((m, c) => m.set(c.asNamed, [...(m.get(c.asNamed) ?? []), c]), new Map<string, typeof d.medicines.cards>())];
  const latestLabs = (Object.keys(LAB) as Lab['kind'][]).map((k) => d.labs.find((l) => l.kind === k)).filter((l): l is Lab => !!l);
  const reds = d.alerts.filter((a) => a.severity === 'red').slice(0, 5);

  return (
    <section className="sum">
      <div className="sum__bar noprint">
        <button className="btn btn--ghost btn--sm" onClick={() => history.back()}><Icon name="arrowLeft" size={16} /> Back</button>
        <button className="btn btn--primary btn--sm" onClick={() => window.print()}><Icon name="print" size={16} /> Print or save as PDF</button>
      </div>
      <article className="sum__page">
        <header className="sum__head">
          <div>
            <div className="sum__brand"><span className="brand__mark" aria-hidden>ص</span> SehatSaathi · Visit summary</div>
            <h1 dir="auto">{d.patient.display_name ?? 'Patient'}</h1>
          </div>
          <div className="sum__meta">Prepared {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}<br />Covers the last 90 days</div>
        </header>

        <section>
          <h2>Glucose control</h2>
          <p>{p.summaryEn}</p>
          <table className="sum__t">
            <thead><tr><th>Period</th><th>Readings</th><th>Mean (mg/dL)</th><th>In range 70–180</th><th>Fasting mean</th><th>Lows &lt;70</th></tr></thead>
            <tbody>{p.months.map((m) => (
              <tr key={m.index}><td>{m.label}</td><td>{m.readings}</td><td>{m.mean ?? '—'}</td><td>{m.timeInRange ?? '—'}{m.timeInRange !== null ? '%' : ''}</td><td>{m.fastingMean ?? '—'}</td><td>{m.lows}</td></tr>
            ))}</tbody>
          </table>
          <p className="sum__kv">
            <span>Stage: <b>{STAGE[p.stage].en}</b></span>
            <span>Trend: <b>{TREND[p.trend].en}</b>{p.meanChange !== null ? ` (${p.meanChange > 0 ? '+' : ''}${p.meanChange} mg/dL vs previous month)` : ''}</span>
            <span>Estimated HbA1c (GMI): <b>{p.estimatedA1c ?? '—'}{p.estimatedA1c !== null ? '%' : ''}</b></span>
          </p>
        </section>

        <div className="sum__cols">
          <section>
            <h2>Lab results</h2>
            {latestLabs.length === 0 ? <p className="muted">None recorded.</p> : (
              <ul>{latestLabs.map((l) => <li key={l.id}>{LAB[l.kind].en}: <b>{l.value}{LAB[l.kind].unit === '%' ? '%' : ` ${LAB[l.kind].unit}`}</b> — {new Date(l.taken_on).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</li>)}</ul>
            )}
            <h2>Medicines on record</h2>
            {meds.length === 0 && d.medicines.unknown.length === 0 ? <p className="muted">None recorded.</p> : (
              <ul>
                {meds.map(([named, g]) => <li key={named}>{named} <span className="muted">({g.map((x) => x.generic).join(' + ')}{g.some((x) => x.causesLows) ? ', can cause hypoglycaemia' : ''})</span></li>)}
                {d.medicines.unknown.map((u) => <li key={u}>{u} <span className="muted">(not recognised)</span></li>)}
              </ul>
            )}
            {d.medicines.checks.length > 0 && (<><h3>Medicine checks</h3><ul>{d.medicines.checks.map((c) => <li key={c.id}>{c.urgency === 'today' ? '⚠ ' : ''}{c.clinicianEn}</li>)}</ul></>)}
          </section>
          <section>
            <h2>Current plan from the doctor</h2>
            {active.length === 0 ? <p className="muted">Nothing assigned.</p> : (
              <ul>{active.map((o) => <li key={o.id}><b>{o.kind === 'precaution' ? 'Instruction' : o.kind[0]!.toUpperCase() + o.kind.slice(1)}:</b> {[o.title, o.dose, o.schedule].filter(Boolean).join(' · ')}{o.due_at ? ` — ${when(o.due_at)}` : ''}</li>)}</ul>
            )}
            <h2>Emergencies (last 90 days)</h2>
            {reds.length === 0 ? <p className="muted">None.</p> : <ul>{reds.map((a) => <li key={a.id}>{when(a.created_at)} — {a.reason_en}</li>)}</ul>}
            {d.concerns.length > 0 && (<><h2>Open follow-ups</h2><ul>{d.concerns.map((c) => <li key={c.id}>{c.summary_en ?? c.summary_ur}</li>)}</ul></>)}
          </section>
        </div>

        <section>
          <h2>Questions for this visit</h2>
          <ol>{d.medicines.questions.map((q, i) => <li key={i}>{q.en}</li>)}</ol>
        </section>

        <section>
          <h2>Recent readings</h2>
          <table className="sum__t sum__t--sm">
            <thead><tr><th>When</th><th>Context</th><th>mg/dL</th></tr></thead>
            <tbody>{d.readings.slice(0, 12).map((r, i) => <tr key={i}><td>{when(r.taken_at)}</td><td>{(r.context ?? 'random').replace('_', ' ')}</td><td><b>{r.mg_dl}</b></td></tr>)}</tbody>
          </table>
        </section>

        <footer className="sum__foot">
          Readings are reported by the patient by voice, text or meter photo. Estimated HbA1c uses the Glucose Management Indicator (Bergenstal et al., Diabetes Care 2018) and is not a laboratory value.
          SehatSaathi supports self-management and does not diagnose or prescribe.
        </footer>
      </article>
    </section>
  );
}
