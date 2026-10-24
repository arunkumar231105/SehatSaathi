import { useEffect, useState } from 'react';
import { api, demoLogin, useMe } from '../auth.ts';
import { getLang } from '../api.ts';
import { navigate, Link } from '../router.tsx';
import { t as tr, lang } from '../i18n.ts';
import { Icon, Skeleton } from '../ui/Icon.tsx';
import { ProgressPanel, OrdersList, TeamList, type Progress, type Order, type TeamMember } from '../portal/parts.tsx';
import { LabsPanel, recentA1c, type Lab } from '../portal/labs.tsx';

interface Detail { progress: Progress; orders: Order[]; team: TeamMember[]; labs: Lab[]; canAddLabs: boolean; shareCode?: string }

/**
 * The patient's side of the portal: what the doctor has assigned, the
 * three-month picture, who is on their care team, and the code that lets a
 * doctor or relative connect. Connecting is always the patient's choice.
 */
export default function MyCare({ onPatient }: { onPatient: (id: string) => void }) {
  const me = useMe();
  const s = tr();
  const en = lang() === 'en';
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const pid = me.user?.role === 'patient' ? me.user.patientId : null;

  const load = () => { if (pid) api.get<Detail>(`/api/portal/patients/${pid}?lang=${getLang()}`).then(setD).catch(() => setD(null)); };
  useEffect(() => { load(); if (pid) onPatient(pid); }, [pid]);
  useEffect(() => {
    window.addEventListener('sehat:notify', load);
    return () => window.removeEventListener('sehat:notify', load);
  }, [pid]);

  if (!me.loaded) return <section className="screen"><Skeleton /></section>;

  if (!me.user || me.user.role !== 'patient') {
    return (
      <section className="screen">
        <header className="screen__head"><h2>{s.careTitle}</h2><p className="muted">{s.careSignedOut}</p></header>
        <div className="card careinvite">
          <Icon name="users" size={28} />
          <p>{s.careWhy}</p>
          <div className="row-btns">
            <button className="btn btn--primary" disabled={busy} onClick={async () => { setBusy(true); try { await demoLogin('patient'); } finally { setBusy(false); } }}>
              <Icon name="sparkle" size={18} /> {s.careDemo}
            </button>
            <Link className="btn btn--outline" to="/login?create">{s.careCreate}</Link>
            <Link className="btn btn--ghost" to="/login">{s.careSignIn}</Link>
          </div>
        </div>
      </section>
    );
  }

  if (!d) return <section className="screen"><Skeleton /></section>;
  const shareText = `${s.careShareMsg} ${d.shareCode}\n${location.origin}/login?create`;
  const remove = (userId: string) => api.del(`/api/portal/team/${pid}/${userId}`).then(load);
  const rotate = () => api.post('/api/portal/share-code/rotate').then(load);

  return (
    <section className="screen">
      <header className="screen__head">
        <h2>{s.careTitle}</h2>
        <p className="muted">{s.careSub}</p>
      </header>

      <div className="card">
        <div className="card__h"><Icon name="stethoscope" size={18} /> {s.careFromDoctor}</div>
        <OrdersList orders={d.orders} lang={en ? 'en' : 'ur'} patientCanTick onChange={load} />
      </div>

      <div className="card">
        <div className="card__h"><Icon name="chart" size={18} /> {s.careProgress}</div>
        <ProgressPanel p={d.progress} lang={en ? 'en' : 'ur'} labA1c={recentA1c(d.labs)} />
      </div>

      <div className="card">
        <div className="card__h"><Icon name="flask" size={18} /> {s.careLabs}</div>
        <LabsPanel labs={d.labs} canAdd={d.canAddLabs} patientId={pid!} onAdded={load} lang={en ? 'en' : 'ur'} />
      </div>

      <div className="card">
        <div className="card__h"><Icon name="users" size={18} /> {s.careTeam}</div>
        <TeamList team={d.team} lang={en ? 'en' : 'ur'} onRemove={remove} />
        <div className="sharecode">
          <span className="muted small">{s.careCodeLabel}</span>
          <div className="sharecode__code" dir="ltr" aria-label={`code ${d.shareCode?.split('').join(' ')}`}>{d.shareCode}</div>
          <div className="row-btns row-btns--center">
            <a className="btn btn--wa btn--sm" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"><Icon name="message" size={16} /> {s.careShare}</a>
            <button className="btn btn--ghost btn--sm" onClick={rotate}><Icon name="refresh" size={16} /> {s.careNewCode}</button>
          </div>
          <p className="fine">{s.careCodeHint}</p>
        </div>
      </div>

      <div className="row-btns">
        <Link className="btn btn--outline" to={`/portal/summary?p=${pid}`}><Icon name="print" size={18} /> {s.careSummary}</Link>
        <Link className="btn btn--ghost" to="/app/memory"><Icon name="brain" size={18} /> {s.tabMemory}</Link>
        <button className="btn btn--ghost" onClick={async () => { const { logout } = await import('../auth.ts'); await logout(); navigate('/app'); }}>{s.careSignOut}</button>
      </div>
    </section>
  );
}
