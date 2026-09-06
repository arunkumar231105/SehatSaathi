import { useEffect, useState } from 'react';
import { usePath, Link } from './router.tsx';
import { Nav, Footer } from './site/Chrome.tsx';
import Landing from './site/Landing.tsx';
import Talk from './screens/Talk.tsx';
import Timeline from './screens/Timeline.tsx';
import Memory from './screens/Memory.tsx';
import Care from './screens/Care.tsx';
import Preflight from './screens/Preflight.tsx';
import { getPatientId, get } from './api.ts';

const APP_NAV = [
  { p: '/app', ur: 'بات کریں', icon: '🎤' },
  { p: '/app/timeline', ur: 'ریکارڈ', icon: '📈' },
  { p: '/app/memory', ur: 'یادداشت', icon: '🧠' },
];

export default function App() {
  const path = usePath();
  const [pid, setPid] = useState<string | null>(null);
  const [caregiverPhone, setCaregiverPhone] = useState<string | null>(null);

  const inApp = path.startsWith('/app');
  useEffect(() => { if (inApp && !pid) void getPatientId().then(setPid); }, [inApp, pid]);
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
  else if (path === '/care') body = <Care />;
  else if (path === '/preflight') body = <Preflight />;
  else if (inApp) {
    if (!pid) body = <div className="loading">…</div>;
    else if (path === '/app/timeline') body = <Timeline patientId={pid} />;
    else if (path === '/app/memory') body = <Memory patientId={pid} onPatientChange={setPid} />;
    else body = <Talk patientId={pid} caregiverPhone={caregiverPhone} />;
  } else body = <NotFound />;

  return (
    <div className={`app ${inApp ? 'app--patient' : ''}`}>
      <Nav path={path} />
      <main className="main">{body}</main>
      {inApp && (
        <nav className="tabs" dir="rtl">
          {APP_NAV.map((n) => (
            <Link key={n.p} to={n.p} className={path === n.p ? 'tabs__a tabs__a--on' : 'tabs__a'}>
              <span className="tabs__i">{n.icon}</span><span className="tabs__t">{n.ur}</span>
            </Link>
          ))}
        </nav>
      )}
      {!inApp && <Footer />}
    </div>
  );
}

function NotFound() {
  return <section className="screen center" style={{ padding: '6rem 1rem' }}><h2>Page not found</h2><Link className="btn btn--primary" to="/">Back to SehatSaathi</Link></section>;
}
