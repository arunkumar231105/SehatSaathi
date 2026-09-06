import { useState } from 'react';
import { Link } from '../router.tsx';

const LINKS = [
  { h: '/#how', t: 'How it works' },
  { h: '/#memory', t: 'Memory' },
  { h: '/#safety', t: 'Safety' },
  { h: '/#caregivers', t: 'Caregivers' },
  { h: '/#technology', t: 'Technology' },
  { h: '/#faq', t: 'FAQ' },
];

export function Nav({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const inApp = path !== '/';
  return (
    <header className={`nav ${inApp ? 'nav--app' : ''}`}>
      <div className="wrap nav__row">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand__mark">ص</span>
          <span className="brand__name">SehatSaathi</span>
          <span className="brand__ur" lang="ur">صحت ساتھی</span>
        </Link>
        {!inApp && (
          <nav className={`nav__links ${open ? 'nav__links--open' : ''}`}>
            {LINKS.map((l) => <a key={l.h} href={l.h} onClick={() => setOpen(false)}>{l.t}</a>)}
            <Link to="/care" onClick={() => setOpen(false)}>Dashboard</Link>
          </nav>
        )}
        <div className="nav__cta">
          {inApp
            ? <Link className="btn btn--outline btn--sm" to="/">← Site</Link>
            : <Link className="btn btn--primary btn--sm" to="/app">Web demo</Link>}
          {!inApp && <button className="burger" aria-label="menu" onClick={() => setOpen((o) => !o)}>☰</button>}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot__grid">
        <div>
          <div className="brand"><span className="brand__mark">ص</span><span className="brand__name">SehatSaathi</span></div>
          <p className="fine">Voice-first diabetes companion for Pakistan. Built on Alibaba Cloud Model Studio (Qwen). Open source, MIT licence.</p>
        </div>
        <div>
          <b>Product</b>
          <a href="/#how">How it works</a><a href="/#memory">Memory</a><a href="/#safety">Safety</a>
          <Link to="/app">Web demo</Link><Link to="/care">Caregiver dashboard</Link>
        </div>
        <div>
          <b>Project</b>
          <a href="/#technology">Technology</a><Link to="/preflight">System status</Link>
          <a href="https://github.com" target="_blank" rel="noreferrer">Source code</a>
        </div>
      </div>
      <div className="wrap foot__legal">
        <p><b>SehatSaathi is not a medical service and not a substitute for a doctor.</b> It does not diagnose, prescribe or change treatment. In an emergency call <a href="tel:1122">1122</a> (Rescue) or go to the nearest hospital.</p>
        <p className="fine">© {new Date().getFullYear()} SehatSaathi · Built for Pakistan’s diabetes community</p>
      </div>
    </footer>
  );
}
