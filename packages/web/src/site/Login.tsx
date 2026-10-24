import { useEffect, useState, type FormEvent } from 'react';
import { navigate } from '../router.tsx';
import { login, register, demoLogin, homeFor, useMe, type Role } from '../auth.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';

const ROLES: { r: Role; t: string; ur: string; d: string; icon: IconName }[] = [
  { r: 'patient', t: 'Patient', ur: 'مریض', d: 'See your record, your doctor’s instructions and appointments.', icon: 'user' },
  { r: 'doctor', t: 'Doctor', ur: 'ڈاکٹر', d: 'Follow your patients’ 3-month progress and assign care.', icon: 'stethoscope' },
  { r: 'family', t: 'Family', ur: 'گھر والے', d: 'Follow a parent’s readings and get emergency alerts.', icon: 'users' },
];

export default function Login() {
  const me = useMe();
  const [mode, setMode] = useState<'signin' | 'create'>(() => (location.search.includes('create') ? 'create' : 'signin'));
  const [role, setRole] = useState<Role>('patient');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // /login?demo=doctor&next=/portal opens a demo portal in one click — for a
  // live presentation, or a link sent to a judge. `next` must be a local path.
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  useEffect(() => {
    const r = params.get('demo') as Role | null;
    if (r && ['patient', 'doctor', 'family'].includes(r) && !me.user) void demo(r);
  }, []);
  useEffect(() => { if (me.user) navigate(safeNext ?? homeFor(me.user.role)); }, [me.user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy('form');
    try {
      const m = mode === 'signin'
        ? await login(phone, password)
        // A patient who has been using the app on this phone keeps that history.
        : await register({ role, name, phone, password, specialty, deviceRecordId: role === 'patient' ? localStorage.getItem('sehat.patientId') ?? undefined : undefined });
      if (m.user) navigate(homeFor(m.user.role));
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  const demo = async (r: Role) => {
    setError(null); setBusy(r);
    try { const m = await demoLogin(r); if (m.user) navigate(safeNext ?? homeFor(m.user.role)); }
    catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  };

  return (
    <section className="auth">
      <div className="wrap auth__grid">
        <div className="auth__intro">
          <span className="eyebrow">One record, three portals</span>
          <h1 className="auth__h">The patient, their doctor and their family — looking at the same care.</h1>
          <p className="lead">Readings the patient speaks on WhatsApp appear for their doctor and family. The doctor’s instructions reach the patient and family at once. An emergency alerts everyone.</p>
          <div className="demo">
            <div className="demo__h"><Icon name="sparkle" size={16} /> Try it with the demo patient, Rashida Bibi — no account needed</div>
            <div className="demo__grid">
              {ROLES.map((x) => (
                <button key={x.r} className="demo__btn" onClick={() => demo(x.r)} disabled={!!busy}>
                  <span className="demo__i"><Icon name={x.icon} size={22} /></span>
                  <span><b>{busy === x.r ? 'Opening…' : `Demo ${x.t.toLowerCase()}`}</b><small>{x.d}</small></span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="auth__card">
          <div className="seg seg--full" role="tablist">
            <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>Sign in</button>
            <button role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Create account</button>
          </div>
          <form onSubmit={submit} className="form">
            {mode === 'create' && (
              <fieldset className="roles">
                <legend>I am a…</legend>
                {ROLES.map((x) => (
                  <label key={x.r} className={`role ${role === x.r ? 'role--on' : ''}`}>
                    <input type="radio" name="role" value={x.r} checked={role === x.r} onChange={() => setRole(x.r)} />
                    <Icon name={x.icon} size={20} /><span>{x.t}<small lang="ur">{x.ur}</small></span>
                  </label>
                ))}
              </fieldset>
            )}
            {mode === 'create' && (
              <label className="field"><span>Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder={role === 'doctor' ? 'Dr. Ayesha Khan' : 'Rashida Bibi'} />
              </label>
            )}
            {mode === 'create' && role === 'doctor' && (
              <label className="field"><span>Specialty and city <small>(optional)</small></span>
                <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Diabetologist, Lahore" />
              </label>
            )}
            <label className="field"><span>Mobile number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required placeholder="0300 1234567" />
            </label>
            <label className="field"><span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'create' ? 8 : undefined}
                     autoComplete={mode === 'create' ? 'new-password' : 'current-password'} placeholder={mode === 'create' ? 'At least 8 characters' : ''} />
            </label>
            {error && <div className="err" role="alert">{error}</div>}
            <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={!!busy}>
              {busy === 'form' ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
            {mode === 'create' && role !== 'patient' && (
              <p className="fine">After signing up, ask your patient (or parent) for the 6-letter code on their “My care” screen to connect.</p>
            )}
            {mode === 'create' && role === 'patient' && (
              <p className="fine">Use the same number you message SehatSaathi from on WhatsApp — your history comes with you.</p>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}
