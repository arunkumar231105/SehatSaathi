import { useEffect, useRef, useState } from 'react';

/** Elements on the landing page that fade up as they scroll into view. */
const REVEAL = [
  '.section .eyebrow', '.section h2', '.section .lead', '.prose > p', '.prose > .btn',
  '.step', '.tier', '.clip', '.dialogue__day', '.rules', '.shot', '.whocard', '.dash',
  '.ticks li', '.faq', '.wa__grid > *', '.stat',
].join(',');

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Scroll-reveal for everything under `root`. Siblings are staggered by their
 * position so a row of cards arrives left to right rather than all at once.
 * Content is never hidden from people who turn motion off, or if the
 * observer is unavailable — the class that hides it is only added here.
 */
export function useReveal(root: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion() || !('IntersectionObserver' in window)) return;
    const items = [...el.querySelectorAll<HTMLElement>(REVEAL)];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const t = e.target as HTMLElement;
          t.classList.add('is-in');
          io.unobserve(t);
          // Once it has arrived, hand the element back its own transitions
          // so hover effects are not slowed by the reveal's stagger.
          const done = () => { t.classList.remove('reveal', 'is-in'); t.style.removeProperty('--d'); };
          t.addEventListener('transitionend', done, { once: true });
          setTimeout(done, 1200);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    for (const it of items) {
      const i = it.parentElement ? [...it.parentElement.children].indexOf(it) : 0;
      it.style.setProperty('--d', `${Math.min(i, 6) * 70}ms`);
      it.classList.add('reveal');
      io.observe(it);
    }
    return () => io.disconnect();
  }, [root]);
}

/**
 * "31.4%" counts up from 0 the first time it is seen; text without a leading
 * number ("Urdu", "1 in 3") is shown as it is.
 */
export function useCountUp(value: string): [React.RefObject<HTMLDivElement | null>, string] {
  const ref = useRef<HTMLDivElement>(null);
  const comma = value.includes(',');
  const m = value.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(\D*)$/);
  const [shown, setShown] = useState(m && !reducedMotion() ? `0${m[2]}` : value);

  useEffect(() => {
    const el = ref.current;
    if (!m || !el || reducedMotion() || !('IntersectionObserver' in window)) { setShown(value); return; }
    const target = Number(m[1]);
    const decimals = m[1]!.includes('.') ? m[1]!.split('.')[1]!.length : 0;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1200);
        const eased = 1 - Math.pow(1 - p, 3);
        const num = target * eased;
        setShown(`${comma ? Math.round(num).toLocaleString('en-US') : num.toFixed(decimals)}${m[2]}`);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);

  return [ref, shown];
}
