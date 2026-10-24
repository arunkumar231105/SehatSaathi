import { useEffect, useState } from 'react';
import { get, post, daysAgo } from '../api.ts';
import { Icon, Skeleton } from '../ui/Icon.tsx';
import { demoLogin, useMe } from '../auth.ts';
import { Link } from '../router.tsx';

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
  medicines?: {
    cards: { asNamed: string; generic: string; causesLows: boolean }[];
    unknown: string[];
    checks: { id: string; urgency: 'today' | 'review'; clinicianEn: string }[];
  };
}

// The dashboard is English-first, so its dates are too — whatever language
// the patient app on this device was last switched to.
const when = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const ago = (d: string | null) => {
  if (!d) return 'no readings';
  const n = daysAgo(d);
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};
/** Names that arrived through a broken encoding render as "????" — show something useful instead. */
const nameOf = (p: { display_name: string | null; phone: string | null }) =>
  p.display_name && !/^\?+$/.test(p.display_name.replace(/\s/g, '')) ? p.display_name : p.phone ?? 'Unnamed patient';
const zone = (v: number | null) => (v == null ? '' : v < 70 ? 'low' : v <= 180 ? 'ok' : v <= 250 ? 'high' : 'vhigh');
const keyLabel = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Caregiver dashboard. English-first: the caregiver is usually a younger
 * family member with a smartphone, and clinicians read English.
 */
export default function Care() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [flash, setFlash] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [locked, setLocked] = useState(false);
  const me = useMe();

  const load = async () => {
    let a: Alert[], p: Pt[];
    try { [a, p] = await Promise.all([get<Alert[]>('/api/care/alerts'), get<Pt[]>('/api/care/patients')]); }
    catch { setLocked(true); return; }   // signed out: patient data is for the care team only
    setLocked(false);
    setAlerts(a); setPts(p);
    setSel((cur) => cur ?? p.find((x) => x.open_red)?.id ?? p[0]?.id ?? null);
  };

  useEffect(() => {
    void load();
    if (!me.user) return;
    const es = new EventSource('/api/care/stream');
    es.addEventListener('alert', () => { setFlash(true); void load(); setTimeout(() => setFlash(false), 2500); });
    const t = setInterval(load, 30_000);
    return () => { es.close(); clearInterval(t); };
  }, [me.user?.id]);

  useEffect(() => {
    setSum(null);
    if (sel) void get<Summary>(`/api/patients/${sel}/summary`).then(setSum).catch(() => undefined);
  }, [sel]);

  if (locked) {
    return (
      <section className="screen care">
        <div className="panel empty-state">
          <Icon name="lock" size={28} />
          <h3>Patient data is for their care team only</h3>
          <p>Sign in as a doctor or family member to see the live alert dashboard for your patients.</p>
          <div className="row-btns row-btns--center">
            <button className="btn btn--primary" onClick={async () => { await demoLogin('doctor'); void load(); }}><Icon name="sparkle" size={18} /> Open as demo doctor</button>
            <Link className="btn btn--outline" to="/login">Sign in</Link>
          </div>
        </div>
      </section>
    );
  }
  if (!alerts) return <section className="screen care"><Skeleton rows={3} /></section>;

  const openAlerts = alerts.filter((a) => !a.acknowledged_at);
  const openRed = openAlerts.filter((a) => a.severity === 'red');
  const followUps = pts.reduce((n, p) => n + p.open_concerns, 0);
  const shown = showAll ? alerts : openAlerts;
  const selPt = pts.find((p) => p.id === sel);

  return (
    <section className={`screen care ${flash ? 'care--flash' : ''}`} dir="ltr">
      <header className="care__head">
        <div>
          <h2>Caregiver dashboard</h2>
          <p className="muted"><span className="live-dot" aria-hidden /> Live — updates the moment a patient’s message triggers a safety rule</p>
        </div>
      </header>

      {openRed.length > 0 && (
        <div className="redbar" role="alert">
          <Icon name="alert" size={20} />
          <span>{openRed.length} emergency alert{openRed.length > 1 ? 's' : ''} waiting for acknowledgement</span>
          <a className="btn btn--sm btn--light" href="#alerts">Review</a>
        </div>
      )}

      <div className="kpis kpis--care">
        <div className="kpi"><span className="kpi__l"><Icon name="users" size={16} /> Patients</span><span className="kpi__n">{pts.length}</span></div>
        <div className="kpi"><span className="kpi__l"><Icon name="alert" size={16} /> Emergencies</span><span className={`kpi__n ${openRed.length ? 'kpi__n--low' : ''}`}>{openRed.length}</span></div>
        <div className="kpi"><span className="kpi__l"><Icon name="bell" size={16} /> Open alerts</span><span className="kpi__n">{openAlerts.length}</span></div>
        <div className="kpi"><span className="kpi__l"><Icon name="clock" size={16} /> Follow-ups due</span><span className="kpi__n">{followUps}</span></div>
      </div>

      <div className="care__grid">
        <div className="panel">
          <h3 className="panel__h">Patients</h3>
          {pts.length === 0 && <p className="muted">No patients yet. They appear here after their first message.</p>}
          <div className="ptlist">
            {pts.map((p) => (
              <button key={p.id} className={`pt ${p.open_red ? 'pt--red' : ''} ${sel === p.id ? 'pt--sel' : ''}`} onClick={() => setSel(p.id)} aria-pressed={sel === p.id}>
                <span className="pt__av" aria-hidden>{nameOf(p).trim().charAt(0)}</span>
                <span className="pt__main">
                  <span className="pt__name" dir="auto">{nameOf(p)}</span>
                  <span className="pt__sub">Last reading {ago(p.last_at)}</span>
                  {(p.open_red > 0 || p.open_concerns > 0) && (
                    <span className="pt__flags">
                      {p.open_red > 0 && <span className="tag tag--red">{p.open_red} emergency</span>}
                      {p.open_concerns > 0 && <span className="tag tag--symptom">{p.open_concerns} follow-up{p.open_concerns > 1 ? 's' : ''}</span>}
                    </span>
                  )}
                </span>
                <span className={`pt__mg pt__mg--${zone(p.last_mg_dl)}`}>{p.last_mg_dl ?? '—'}<small>mg/dL</small></span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          {!selPt && <p className="muted">Select a patient to see their clinical picture.</p>}
          {selPt && (
            <>
              <h3 className="panel__h"><span dir="auto">{nameOf(selPt)}</span> — clinical picture</h3>
              {!sum ? <Skeleton rows={2} /> : (
                <>
                  <div className="kpis kpis--mini">
                    <div className="kpi"><span className="kpi__l">7-day mean</span><span className={`kpi__n kpi__n--${zone(sum.features.mean7)}`}>{sum.features.mean7 ?? '—'}</span><span className="kpi__s">mg/dL</span></div>
                    <div className="kpi"><span className="kpi__l">Time in range</span><span className="kpi__n">{sum.features.timeInRange14 ?? '—'}%</span><span className="kpi__s">14 days</span></div>
                    <div className="kpi"><span className="kpi__l">Missed doses</span><span className={`kpi__n ${sum.features.missedDoses7 ? 'kpi__n--high' : 'kpi__n--ok'}`}>{sum.features.missedDoses7}</span><span className="kpi__s">this week</span></div>
                  </div>
                  <ul className="signals">
                    {sum.features.risingFastingDays >= 3 && <li className="sig sig--warn"><Icon name="activity" size={16} /> Fasting readings rising {sum.features.risingFastingDays} days running</li>}
                    {sum.features.dawnPhenomenon && <li className="sig sig--warn"><Icon name="clock" size={16} /> Dawn-phenomenon pattern</li>}
                    {sum.features.postMealSpikes7 > 0 && <li className="sig sig--warn"><Icon name="food" size={16} /> {sum.features.postMealSpikes7} post-meal spike{sum.features.postMealSpikes7 > 1 ? 's' : ''}{sum.features.spikeFoods.length ? ` — after ${sum.features.spikeFoods.join(', ')}` : ''}</li>}
                    {sum.features.missedDoses7 === 0 && <li className="sig sig--ok"><Icon name="check" size={16} /> Medication streak: {sum.features.adherenceStreakDays} days</li>}
                  </ul>
                  {sum.medicines && (sum.medicines.cards.length > 0 || sum.medicines.unknown.length > 0) && (
                    <>
                      <div className="card__h">Medicines</div>
                      <div className="care-meds">
                        {sum.medicines.cards.map((m, i) => (
                          <div key={i} className="care-med">
                            <Icon name="pill" size={16} /><b>{m.generic}</b><span>as “{m.asNamed}”</span>
                            {m.causesLows && <span className="tag tag--symptom">hypo risk</span>}
                          </div>
                        ))}
                        {sum.medicines.unknown.map((u) => (
                          <div key={u} className="care-med"><Icon name="pill" size={16} /><b>{u}</b><span>not recognised — confirm with patient</span></div>
                        ))}
                      </div>
                      {sum.medicines.checks.length > 0 && (
                        <ul className="signals">
                          {sum.medicines.checks.map((c) => (
                            <li key={c.id} className={`sig ${c.urgency === 'today' ? 'sig--today' : 'sig--warn'}`}>
                              <Icon name="alert" size={16} /> {c.urgency === 'today' ? 'Today: ' : 'Review: '}{c.clinicianEn}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {sum.concerns.length > 0 && (
                    <>
                      <div className="card__h">Open follow-ups</div>
                      <ul className="plain">{sum.concerns.map((c) => <li key={c.id}>{c.summary_en ?? c.summary_ur}</li>)}</ul>
                    </>
                  )}
                  {sum.facts.length > 0 && (
                    <>
                      <div className="card__h">Profile</div>
                      <dl className="facts-dl">
                        {sum.facts.map((f) => <div key={f.key}><dt>{keyLabel(f.key)}</dt><dd dir="auto">{Array.isArray(f.value) ? f.value.join(', ') : typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : String(f.value)}</dd></div>)}
                      </dl>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="alerts__head" id="alerts">
        <h3>Alerts</h3>
        <div className="seg" role="tablist" aria-label="Filter alerts">
          <button role="tab" aria-selected={!showAll} className={!showAll ? 'on' : ''} onClick={() => setShowAll(false)}>Open ({openAlerts.length})</button>
          <button role="tab" aria-selected={showAll} className={showAll ? 'on' : ''} onClick={() => setShowAll(true)}>All ({alerts.length})</button>
        </div>
      </div>
      {shown.length === 0 && (
        <div className="empty"><Icon name="check" size={22} /><span>{showAll ? 'No alerts yet.' : 'Nothing waiting — every alert has been acknowledged.'}</span></div>
      )}
      {shown.map((a) => (
        <article key={a.id} className={`alert alert--${a.severity} ${a.acknowledged_at ? 'alert--ack' : ''}`}>
          <div className="alert__top">
            <span className={`tag tag--${a.severity}`}>{a.severity === 'red' ? 'Emergency' : 'Warning'}</span>
            <b dir="auto">{nameOf(a)}</b>
            <span className="muted small">{when(a.created_at)}</span>
            {a.acknowledged_at && <span className="tag"><Icon name="check" size={12} /> Acknowledged</span>}
          </div>
          <div className="alert__en">{a.reason_en}</div>
          <div className="alert__ur" dir="rtl" lang="ur">{a.reason_ur}</div>
          {a.trigger_text && <div className="alert__trig" dir="rtl">«{a.trigger_text}»</div>}
          <div className="alert__meta muted small">Rule <code>{a.rule_id}</code></div>
          <div className="row-btns">
            {!a.acknowledged_at && <button className="btn btn--sm btn--outline" onClick={() => post(`/api/care/alerts/${a.id}/ack`).then(load)}><Icon name="check" size={16} /> Acknowledge</button>}
            {a.caregiver_phone && (
              <a className="btn btn--sm btn--wa" target="_blank" rel="noreferrer"
                 href={`https://wa.me/${a.caregiver_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`⚠️ SehatSaathi: ${a.display_name ?? ''} — ${a.reason_en}\n${a.reason_ur}\nEmergency: 1122`)}`}>
                <Icon name="message" size={16} /> WhatsApp family
              </a>
            )}
            <a className="btn btn--sm btn--danger" href="tel:1122"><Icon name="phone" size={16} /> Call 1122</a>
          </div>
        </article>
      ))}
    </section>
  );
}
