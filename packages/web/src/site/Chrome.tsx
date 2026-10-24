import { useEffect, useState } from 'react';
import { Link } from '../router.tsx';
import { t } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';
import { useMe, logout, homeFor } from '../auth.ts';
import { NotificationBell } from '../portal/live.tsx';
import { navigate } from '../router.tsx';

const REPO = 'https://github.com/arunkumar231105/SehatSaathi';

const LINKS = [
  { id: 'how', t: 'How it works' },
  { id: 'listen', t: 'Listen' },
  { id: 'memory', t: 'Memory' },
  { id: 'safety', t: 'Safety' },
  { id: 'caregivers', t: 'Caregivers' },
  { id: 'faq', t: 'FAQ' },
];

/** Which landing section is under the nav, so the matching link can be marked. */
function useActiveSection(enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // The last linked section whose top has passed the upper third of the screen.
    const on = () => {
      let hit: string | null = null;
      for (const l of LINKS) {
        const el = document.getElementById(l.id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.33) hit = l.id;
      }
      setActive(hit);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [enabled]);
  return active;
}

export function Nav({ path, onLang }: { path: string; onLang?: () => void }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const onSite = path === '/';
  const inPatientApp = path.startsWith('/app');
  const active = useActiveSection(onSite);
  const me = useMe();
  const signedIn = !!me.user;
  const inPortal = path === '/portal';

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className={`nav ${scrolled ? 'nav--scrolled' : ''} ${onSite ? '' : 'nav--app'}`}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="wrap nav__row">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand__mark" aria-hidden>ص</span>
          <span className="brand__name">SehatSaathi</span>
          <span className="brand__ur" lang="ur">صحت ساتھی</span>
        </Link>

        {onSite && (
          <nav id="site-menu" className={`nav__links ${open ? 'nav__links--open' : ''}`} aria-label="Sections">
            {LINKS.map((l) => (
              <a key={l.id} href={`/#${l.id}`} className={active === l.id ? 'is-on' : undefined}
                 aria-current={active === l.id ? 'true' : undefined} onClick={() => setOpen(false)}>{l.t}</a>
            ))}
            <Link to="/login" onClick={() => setOpen(false)} className="nav__links-dash">Portals</Link>
          </nav>
        )}

        <div className="nav__cta">
          {inPatientApp && onLang && (
            <button className="btn btn--ghost btn--sm" onClick={onLang} aria-label="Switch language">
              <Icon name="globe" size={16} /> {t().langLabel}
            </button>
          )}
          {signedIn && <NotificationBell />}
          {signedIn && !inPortal && me.user!.role !== 'patient' && <Link className="btn btn--ghost btn--sm" to="/portal">My portal</Link>}
          {signedIn && inPortal && (
            <button className="btn btn--ghost btn--sm" onClick={async () => { await logout(); navigate('/login'); }}>
              <span className="nav__hide-sm">{me.user!.name.split(' ').slice(0, 2).join(' ')} · </span>Sign out
            </button>
          )}
          {!signedIn && (onSite || path === '/care') && <Link className="btn btn--ghost btn--sm nav__hide-sm" to="/login">Sign in</Link>}
          {path === '/care' && <Link className="btn btn--ghost btn--sm nav__hide-sm" to="/app">Patient app</Link>}
          {onSite
            ? (signedIn
                ? <Link className="btn btn--primary btn--sm" to={homeFor(me.user!.role)}>Open my portal <Icon name="arrowRight" size={16} /></Link>
                : <Link className="btn btn--primary btn--sm" to="/app">Try the demo <Icon name="arrowRight" size={16} /></Link>)
            : <Link className="btn btn--outline btn--sm" to="/"><Icon name="arrowLeft" size={16} /> <span className="nav__hide-sm">Website</span></Link>}
          {onSite && (
            <button className="burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
                    aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
              <Icon name={open ? 'close' : 'menu'} size={24} />
            </button>
          )}
        </div>
      </div>
      {open && <button className="nav__scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot__grid">
        <div>
          <div className="brand"><span className="brand__mark" aria-hidden>ص</span><span className="brand__name">SehatSaathi</span></div>
          <p className="fine">A voice-first diabetes companion for Pakistan. Speaks Urdu, remembers you, and escalates emergencies to a human. Open source under the MIT licence.</p>
        </div>
        <div>
          <b>Product</b>
          <a href="/#how">How it works</a><a href="/#memory">Memory</a><a href="/#safety">Safety</a><a href="/#privacy">Privacy</a>
        </div>
        <div>
          <b>Try it</b>
          <Link to="/app">Patient web app</Link><Link to="/login">Doctor & family portals</Link><Link to="/care">Caregiver dashboard</Link><Link to="/preflight">System status</Link>
        </div>
        <div>
          <b>Project</b>
          <a href={REPO} target="_blank" rel="noreferrer"><Icon name="github" size={16} /> Source code</a>
          <a href={`${REPO}/blob/main/ARCHITECTURE.md`} target="_blank" rel="noreferrer">Architecture</a>
        </div>
      </div>
      <div className="wrap foot__legal">
        <p><Icon name="alert" size={16} /> <b>SehatSaathi is not a medical service and not a substitute for a doctor.</b> It does not diagnose, prescribe or change treatment. In an emergency call <a href="tel:1122">1122</a> (Rescue) or go to the nearest hospital.</p>
        <p className="fine">© {new Date().getFullYear()} SehatSaathi · Built for Pakistan’s diabetes community</p>
      </div>
    </footer>
  );
}
