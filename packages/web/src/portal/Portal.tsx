import { useEffect, useState, type FormEvent } from 'react';
import { api, useMe, homeFor } from '../auth.ts';
import { navigate } from '../router.tsx';
import { Icon, Skeleton } from '../ui/Icon.tsx';
import { ProgressPanel, OrdersList, TeamList, StageBadge, TrendTag, when, type Progress, type Order, type TeamMember, type Stage, type Trend } from './parts.tsx';

interface Card {
  id: string; name: string; relation: string | null; label: string | null;
  lastReading: { mgDl: number; at: string } | null; stage: Stage; trend: Trend; estimatedA1c: number | null;
  timeInRange90: number | null; openEmergencies: number; nextAppointment: { title: string; due_at: string } | null;
}
interface Alert { id: string; severity: 'red' | 'amber'; rule_id: string; reason_en: string; reason_ur: string; acknowledged_at: string | null; created_at: string; trigger_text: string | null }
interface Detail {
  patient: { id: string; display_name: string | null; phone: string | null };
  progress: Progress; readings: { mg_dl: number; taken_at: string; context: string | null }[];
  alerts: Alert[]; orders: Order[]; team: TeamMember[];
  medicines: { cards: { asNamed: string; generic: string; causesLows: boolean }[]; unknown: string[]; checks: { id: string; urgency: 'today' | 'review'; clinicianEn: string }[] };
  concerns: { id: string; summary_en: string | null; summary_ur: string }[];
  canAssign: boolean;
}

const zone = (v: number) => (v < 70 ? 'low' : v <= 180 ? 'ok' : v <= 250 ? 'high' : 'vhigh');
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** Doctor and family portal. English-first: clinicians and the younger relatives who use it read English. */
export default function Portal() {
  const me = useMe();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [sel, setSel] = useState<string | null>(() => new URLSearchParams(location.search).get('p'));
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    if (!me.loaded) return;
    if (!me.user) navigate('/login');
    else if (me.user.role === 'patient') navigate(homeFor('patient'));
  }, [me.loaded, me.user]);

  const loadList = () => api.get<Card[]>('/api/portal/patients').then((c) => {
    setCards(c);
    setSel((s) => s ?? c[0]?.id ?? null);
  }).catch(() => setCards([]));
  const loadDetail = (id = sel) => { if (id) api.get<Detail>(`/api/portal/patients/${id}`).then(setDetail).catch(() => setDetail(null)); };

  useEffect(() => { if (me.user && me.user.role !== 'patient') void loadList(); }, [me.user?.id]);
  useEffect(() => { setDetail(null); loadDetail(); if (sel) history.replaceState(null, '', `/portal?p=${sel}`); }, [sel]);
  useEffect(() => {
    const on = () => { void loadList(); loadDetail(); };
    window.addEventListener('sehat:notify', on); window.addEventListener('sehat:alert', on);
    return () => { window.removeEventListener('sehat:notify', on); window.removeEventListener('sehat:alert', on); };
  }, [sel]);

  if (!me.user || me.user.role === 'patient') return <section className="screen"><Skeleton /></section>;
  const doctor = me.user.role === 'doctor';

  return (
    <section className="portal">
      <header className="portal__head wrap">
        <div>
          <span className="eyebrow">{doctor ? 'Doctor portal' : 'Family portal'}</span>
          <h2>{doctor ? `${me.user.name}` : `Hello, ${me.user.name.split(' ')[0]}`}</h2>
          <p className="muted">{doctor ? 'Your patients, sorted with emergencies and the highest sugar first.' : 'The people you look after. You are alerted the moment there is an emergency.'}</p>
        </div>
      </header>

      <div className="wrap portal__grid">
        <aside className="panel portal__list">
          <h3 className="panel__h">{doctor ? 'Patients' : 'Family'} {cards && <span className="muted">({cards.length})</span>}</h3>
          {!cards && <Skeleton rows={3} />}
          {cards?.length === 0 && <p className="muted">No one connected yet. Add a patient with their code below.</p>}
          <div className="ptlist">
            {cards?.map((c) => (
              <button key={c.id} className={`pt ${c.openEmergencies ? 'pt--red' : ''} ${sel === c.id ? 'pt--sel' : ''}`} onClick={() => setSel(c.id)} aria-pressed={sel === c.id}>
                <span className="pt__av" aria-hidden>{c.name.trim().charAt(0)}</span>
                <span className="pt__main">
                  <span className="pt__name" dir="auto">{c.name}</span>
                  <span className="pt__sub">{c.lastReading ? `Last ${ago(c.lastReading.at)}` : 'No readings yet'}{c.label ? ` · ${c.label}` : ''}</span>
                  <span className="pt__flags">
                    {c.openEmergencies > 0 && <span className="tag tag--red">{c.openEmergencies} emergency</span>}
                    <StageBadge stage={c.stage} />
                    {c.trend !== 'not_enough_data' && <TrendTag trend={c.trend} />}
                  </span>
                </span>
                {c.lastReading && <span className={`pt__mg pt__mg--${zone(c.lastReading.mgDl)}`}>{c.lastReading.mgDl}<small>mg/dL</small></span>}
              </button>
            ))}
          </div>
          <LinkForm doctor={doctor} onLinked={(id) => { void loadList(); setSel(id); }} />
        </aside>

        <div className="portal__main">
          {!sel && cards?.length === 0 && <div className="panel empty-state"><Icon name="users" size={28} /><p>Connect a patient to see their record here.</p></div>}
          {sel && !detail && <div className="panel"><Skeleton rows={4} /></div>}
          {detail && <PatientView d={detail} doctor={doctor} reload={() => { loadDetail(); void loadList(); }} />}
        </div>
      </div>
    </section>
  );
}

function LinkForm({ doctor, onLinked }: { doctor: boolean; onLinked: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await api.post<{ patient: { id: string } }>('/api/portal/link', { code, label: label || undefined });
      setCode(''); setLabel(''); onLinked(r.patient.id);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="linkform" onSubmit={submit}>
      <div className="card__h"><Icon name="users" size={16} /> {doctor ? 'Add a patient' : 'Connect to a family member'}</div>
      <p className="fine">Ask them for the 6-letter code on their “My care” screen. Only someone with the code can connect.</p>
      <div className="linkform__row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={6} required aria-label="Patient code" className="code-input" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={doctor ? 'Note (optional)' : 'e.g. Mother'} aria-label="Relation" />
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn btn--primary btn--sm btn--block" disabled={busy || code.length < 6}>{busy ? 'Connecting…' : 'Connect'}</button>
    </form>
  );
}

function PatientView({ d, doctor, reload }: { d: Detail; doctor: boolean; reload: () => void }) {
  const name = d.patient.display_name ?? 'Unnamed patient';
  const open = d.alerts.filter((a) => !a.acknowledged_at && a.severity === 'red');
  const ack = (id: string) => api.post(`/api/portal/alerts/${id}/ack`).then(reload);
  const phone = d.patient.phone && d.patient.phone !== 'demo' ? d.patient.phone.replace(/\D/g, '') : null;

  return (
    <div className="pview">
      <div className="panel pview__head">
        <div>
          <h3 dir="auto">{name}</h3>
          <div className="pview__chips"><StageBadge stage={d.progress.stage} /><TrendTag trend={d.progress.trend} /><span className="muted small">{d.progress.totalReadings} readings in 90 days</span></div>
        </div>
        <div className="row-btns">
          {phone && <a className="btn btn--sm btn--outline" href={`tel:+${phone}`}><Icon name="phone" size={16} /> Call</a>}
          {phone && <a className="btn btn--sm btn--wa" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer"><Icon name="message" size={16} /> WhatsApp</a>}
        </div>
      </div>

      {open.map((a) => (
        <article key={a.id} className="alert alert--red alert--big" role="alert">
          <div className="alert__top"><span className="tag tag--red">Emergency</span><b>{a.reason_en}</b><span className="muted small">{when(a.created_at)}</span></div>
          {a.trigger_text && <div className="alert__trig" dir="auto">«{a.trigger_text}»</div>}
          <div className="row-btns">
            <button className="btn btn--sm btn--outline" onClick={() => ack(a.id)}><Icon name="check" size={16} /> I’m handling this</button>
            {phone && <a className="btn btn--sm btn--danger" href={`tel:+${phone}`}><Icon name="phone" size={16} /> Call patient</a>}
            <a className="btn btn--sm btn--danger" href="tel:1122"><Icon name="phone" size={16} /> Call 1122</a>
          </div>
        </article>
      ))}

      <div className="panel">
        <h3 className="panel__h"><Icon name="chart" size={18} /> Last 3 months</h3>
        <ProgressPanel p={d.progress} />
      </div>

      <div className="pview__cols">
        <div className="panel">
          <h3 className="panel__h"><Icon name="plan" size={18} /> {doctor ? 'Care you have assigned' : 'From the doctor'}</h3>
          <OrdersList orders={d.orders} canCancel={d.canAssign} onChange={reload} />
          {d.canAssign && <AssignForm patientId={d.patient.id} onDone={reload} />}
        </div>
        <div className="panel">
          <h3 className="panel__h"><Icon name="pill" size={18} /> Medicines</h3>
          {d.medicines.cards.length === 0 && d.medicines.unknown.length === 0 && <p className="muted">None recorded.</p>}
          <div className="care-meds">
            {groupMeds(d.medicines.cards).map(([named, gens]) => (
              <div key={named} className="care-med"><Icon name="pill" size={16} /><b dir="auto">{named}</b><span>{gens.map((g) => g.generic).join(' + ')}</span>
                {gens.some((g) => g.causesLows) && <span className="tag tag--symptom">hypo risk</span>}</div>
            ))}
            {d.medicines.unknown.map((u) => <div key={u} className="care-med"><Icon name="pill" size={16} /><b>{u}</b><span>not recognised</span></div>)}
          </div>
          {d.medicines.checks.length > 0 && (
            <ul className="signals">{d.medicines.checks.map((c) => (
              <li key={c.id} className={`sig ${c.urgency === 'today' ? 'sig--today' : 'sig--warn'}`}><Icon name="alert" size={16} /> {c.clinicianEn}</li>
            ))}</ul>
          )}
          {d.concerns.length > 0 && (<><div className="card__h">Open follow-ups</div><ul className="plain">{d.concerns.map((c) => <li key={c.id}>{c.summary_en ?? c.summary_ur}</li>)}</ul></>)}
          <div className="card__h">Care team</div>
          <TeamList team={d.team} />
        </div>
      </div>

      <div className="panel">
        <h3 className="panel__h"><Icon name="activity" size={18} /> Recent readings</h3>
        {d.readings.length === 0 ? <p className="muted">No readings in the last 90 days.</p> : (
          <div className="rtable" role="table">
            {d.readings.slice(0, 14).map((r, i) => (
              <div key={i} className="rtable__row" role="row">
                <span role="cell">{when(r.taken_at)}</span>
                <span role="cell" className="muted">{(r.context ?? 'random').replace('_', ' ')}</span>
                <span role="cell"><span className={`pill pill--${zone(r.mg_dl)}`}>{r.mg_dl}</span></span>
              </div>
            ))}
          </div>
        )}
        {d.alerts.length > 0 && (<><div className="card__h" style={{ marginTop: '1rem' }}>Alert history</div>
          <ul className="plain small">{d.alerts.slice(0, 8).map((a) => <li key={a.id}><span className={`tag tag--${a.severity}`}>{a.severity === 'red' ? 'Emergency' : 'Warning'}</span> {a.reason_en} <span className="muted">· {when(a.created_at)}{a.acknowledged_at ? ' · handled' : ''}</span></li>)}</ul></>)}
      </div>
    </div>
  );
}

const groupMeds = (cards: Detail['medicines']['cards']) =>
  [...cards.reduce((m, c) => m.set(c.asNamed, [...(m.get(c.asNamed) ?? []), c]), new Map<string, typeof cards>())];

function AssignForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const [kind, setKind] = useState<Order['kind']>('precaution');
  const [title, setTitle] = useState('');
  const [dose, setDose] = useState('');
  const [schedule, setSchedule] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const dated = kind === 'appointment' || kind === 'test';

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await api.post(`/api/portal/patients/${patientId}/orders`, {
        kind, title, detail: detail || undefined,
        dose: kind === 'medicine' ? dose || undefined : undefined,
        schedule: kind === 'medicine' ? schedule || undefined : undefined,
        dueAt: dated && dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      setTitle(''); setDose(''); setSchedule(''); setDueAt(''); setDetail('');
      setMsg({ ok: true, t: 'Sent. The patient and their family have been notified.' });
      onDone();
    } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } finally { setBusy(false); }
  };

  const PH: Record<Order['kind'], string> = {
    medicine: 'Medicine name, e.g. Glucophage', precaution: 'e.g. No sweets or sugary chai this week',
    appointment: 'e.g. Follow-up visit', test: 'e.g. HbA1c blood test',
  };
  return (
    <form className="assign" onSubmit={submit}>
      <div className="card__h">Assign</div>
      <div className="seg seg--wrap" role="radiogroup" aria-label="What to assign">
        {(['precaution', 'medicine', 'appointment', 'test'] as const).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {k === 'precaution' ? 'Instruction' : k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <label className="field"><span>{kind === 'medicine' ? 'Medicine' : 'What'}</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={PH[kind]} required /></label>
      {kind === 'medicine' && (
        <div className="field-row">
          <label className="field"><span>Dose</span><input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="500 mg" /></label>
          <label className="field"><span>When</span><input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="twice daily after meals" /></label>
        </div>
      )}
      {dated && <label className="field"><span>Date and time</span><input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} required /></label>}
      <label className="field"><span>Note for the patient <small>(optional)</small></span><textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder="Explained simply — it is read to the patient in their language." /></label>
      {msg && <div className={msg.ok ? 'okmsg' : 'err'} role="status">{msg.t}</div>}
      <button className="btn btn--primary btn--block" disabled={busy || !title.trim()}>{busy ? 'Sending…' : 'Send to patient'}</button>
    </form>
  );
}
