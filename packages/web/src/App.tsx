import { useEffect, useState } from 'react';
import { usePath, Link } from './router.tsx';
import { Nav, Footer } from './site/Chrome.tsx';
import Landing from './site/Landing.tsx';
import Talk from './screens/Talk.tsx';
import Timeline from './screens/Timeline.tsx';
import Memory from './screens/Memory.tsx';
import Plan from './screens/Plan.tsx';
import Medicines from './screens/Medicines.tsx';
import MyCare from './screens/MyCare.tsx';
import Login from './site/Login.tsx';
import Portal from './portal/Portal.tsx';
import { LiveLayer } from './portal/live.tsx';
import { useMe } from './auth.ts';
import Care from './screens/Care.tsx';
import Preflight from './screens/Preflight.tsx';
import { getPatientId, get, getLang, setLang } from './api.ts';
import { t, dir } from './i18n.ts';
import { Icon, Skeleton, type IconName } from './ui/Icon.tsx';

const APP_NAV = (s: ReturnType<typeof t>): { p: string; label: string; icon: IconName }[] => [
  { p: '/app', label: s.tabTalk, icon: 'mic' },
  { p: '/app/plan', label: s.tabPlan, icon: 'plan' },
  { p: '/app/meds', label: s.tabMeds, icon: 'pill' },
  { p: '/app/timeline', label: s.tabRecord, icon: 'chart' },
  { p: '/app/care', label: s.tabCare, icon: 'users' },
];

export default function App() {
  const path = usePath();
  const [pid, setPid] = useState<string | null>(null);
  const [caregiverPhone, setCaregiverPhone] = useState<string | null>(null);
  const [, setTick] = useState(0);   // re-render the whole app on a language change
  const me = useMe();
  // A signed-in patient always sees their own record, on any device.
  const accountPid = me.user?.role === 'patient' ? me.user.patientId : null;
  useEffect(() => {
    if (accountPid && accountPid !== pid) { localStorage.setItem('sehat.patientId', accountPid); setPid(accountPid); }
  }, [accountPid]);

  const inApp = path.startsWith('/app');
  const [pidFailed, setPidFailed] = useState(false);
  const loadPid = () => { setPidFailed(false); getPatientId().then(setPid).catch(() => setPidFailed(true)); };
  useEffect(() => { if (inApp && !pid) loadPid(); }, [inApp, pid]);
  useEffect(() => {
    if (!pid) return;
    void get<{ patient: { caregiver_phone: string | null } }>(`/api/patients/${pid}/summary`)
      .then((s) => setCaregiverPhone(s.patient.caregiver_phone)).catch(() => undefined);
  }, [pid]);

  // Legacy hash links (#/care etc.) from before path routing.
  useEffect(() => {
    const m = location.hash.match(/^#\/(talk|timeline|memory|care|preflight)$/);
    if (m) history.replaceState(null, '', m[1] === 'talk' ? '/app' : m[1] === 'care' || m[1] === 'preflight' ? `/${m[1]}` : `/app/${m[1]}`);
  }, []);

  let body: React.ReactNode;
  if (path === '/') body = <Landing />;
  else if (path === '/login') body = <Login />;
  else if (path === '/portal') body = <Portal />;
  else if (path === '/care') body = <Care />;
  else if (path === '/preflight') body = <Preflight />;
  else if (inApp) {
    if (!pid && pidFailed) {
      body = (
        <section className="screen">
          <div className="err" role="alert">{t().connErr}</div>
          <div className="row-btns"><button className="btn btn--primary" onClick={loadPid}><Icon name="refresh" size={18} /> {t().tryAgain}</button></div>
        </section>
      );
    } else if (!pid) body = <section className="screen"><Skeleton /></section>;
    else if (path === '/app/plan') body = <Plan patientId={pid} />;
    else if (path === '/app/meds') body = <Medicines patientId={pid} />;
    else if (path === '/app/care') body = <MyCare onPatient={(id) => id !== pid && setPid(id)} />;
    else if (path === '/app/timeline') body = <Timeline patientId={pid} />;
    else if (path === '/app/memory') body = <Memory patientId={pid} onPatientChange={setPid} />;
    else body = <Talk patientId={pid} caregiverPhone={caregiverPhone} />;
  } else body = <NotFound />;

  return (
    <div className={`app ${inApp ? 'app--patient' : ''} ${inApp ? `app--${getLang()}` : ''}`}>
      <Nav path={path} onLang={() => { setLang(getLang() === 'en' ? 'ur' : 'en'); setTick((n) => n + 1); }} />
      <main className="main" id="main">{body}</main>
      <LiveLayer />
      {inApp && (
        <nav className="tabs" dir={dir()} aria-label="App">
          <div className="tabs__in">
            {APP_NAV(t()).map((n) => (
              <Link key={n.p} to={n.p} current={path === n.p} className={path === n.p ? 'tabs__a tabs__a--on' : 'tabs__a'}>
                <span className="tabs__i"><Icon name={n.icon} size={22} /></span><span className="tabs__t">{n.label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
      {!inApp && <Footer />}
    </div>
  );
}

function NotFound() {
  return (
    <section className="screen center notfound">
      <div className="notfound__code">404</div>
      <h2>Page not found</h2>
      <p className="muted">That page does not exist. The companion is still here.</p>
      <div className="row-btns row-btns--center"><Link className="btn btn--primary" to="/">Back to SehatSaathi</Link><Link className="btn btn--outline" to="/app">Open the app</Link></div>
    </section>
  );
}
