import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

/** Tiny History-API router. nginx falls back to index.html for any path. */
export function usePath(): string {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return p;
}

export function navigate(to: string): void {
  if (to === location.pathname) return;
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function Link({ to, className, children, onClick, current }: { to: string; className?: string; children: ReactNode; onClick?: () => void; current?: boolean }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || to.startsWith('http') || to.startsWith('#')) return;
    e.preventDefault();
    onClick?.();
    navigate(to);
  };
  return <a href={to} className={className} onClick={go} aria-current={current ? 'page' : undefined}>{children}</a>;
}
