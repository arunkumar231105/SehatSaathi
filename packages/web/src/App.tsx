import { useEffect, useState } from 'react';
import Talk from './screens/Talk.tsx';
import Timeline from './screens/Timeline.tsx';
import Memory from './screens/Memory.tsx';
import Care from './screens/Care.tsx';
import Preflight from './screens/Preflight.tsx';
import { getPatientId, get } from './api.ts';

type Route = 'talk' | 'timeline' | 'memory' | 'care' | 'preflight';

function useRoute(): Route {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'talk') as Route;
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

const NAV: { r: Route; ur: string; icon: string }[] = [
  { r: 'talk', ur: 'بات کریں', icon: '🎤' },
  { r: 'timeline', ur: 'ریکارڈ', icon: '📈' },
  { r: 'memory', ur: 'یادداشت', icon: '🧠' },
  { r: 'care', ur: 'گھر والے', icon: '👨‍👩‍👧' },
];

export default function App() {
  const route = useRoute();
  const [pid, setPid] = useState<string | null>(null);
  const [caregiverPhone, setCaregiverPhone] = useState<string | null>(null);

  useEffect(() => { void getPatientId().then(setPid); }, []);
  useEffect(() => {
    if (!pid) return;
    void get<{ patient: { caregiver_phone: string | null } }>(`/api/patients/${pid}/summary`)
      .then((s) => setCaregiverPhone(s.patient.caregiver_phone))
      .catch(() => undefined);
  }, [pid]);

  return (
    <div className="app">
      <header className="top">
        <h1>صحت ساتھی</h1>
        <a className="top__pf" href="#/preflight" title="preflight">⚙</a>
      </header>

      <main className="main">
        {!pid && route !== 'preflight' && route !== 'care' && <div className="loading">…</div>}
        {route === 'talk' && pid && <Talk patientId={pid} caregiverPhone={caregiverPhone} />}
        {route === 'timeline' && pid && <Timeline patientId={pid} />}
        {route === 'memory' && pid && <Memory patientId={pid} onPatientChange={setPid} />}
        {route === 'care' && <Care />}
        {route === 'preflight' && <Preflight />}
      </main>

      <nav className="nav">
        {NAV.map((n) => (
          <a key={n.r} href={`#/${n.r}`} className={route === n.r ? 'nav__a nav__a--on' : 'nav__a'}>
            <span className="nav__i">{n.icon}</span>
            <span className="nav__t">{n.ur}</span>
          </a>
        ))}
      </nav>

      <footer className="disclaimer">صحت ساتھی ڈاکٹر نہیں ہے۔ ہنگامی صورت میں 1122 پر کال کریں۔</footer>
    </div>
  );
}
