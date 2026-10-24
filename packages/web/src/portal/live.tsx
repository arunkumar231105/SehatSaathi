import { useEffect, useRef, useState } from 'react';
import { api, setUnread, useMe } from '../auth.ts';
import { navigate } from '../router.tsx';
import { Icon } from '../ui/Icon.tsx';

export interface Notice {
  id: string; patient_id?: string; patientId?: string; kind: string; severity: 'info' | 'warning' | 'emergency';
  title: string; body: string | null; whatsapp?: string | null; read_at?: string | null; created_at?: string; at?: string; patient_name?: string | null;
}

/**
 * One live connection per signed-in user. Pages listen for the window events
 * it re-broadcasts ('sehat:notify', 'sehat:alert') to refresh what they show.
 */
export function LiveLayer() {
  const me = useMe();
  const [emergency, setEmergency] = useState<Notice | null>(null);
  const unread = useRef(me.unread);
  unread.current = me.unread;

  useEffect(() => {
    if (!me.user) return;
    const es = new EventSource('/api/portal/stream');
    es.addEventListener('notify', (e) => {
      const n = JSON.parse((e as MessageEvent).data) as Notice;
      setUnread(unread.current + 1);
      window.dispatchEvent(new CustomEvent('sehat:notify', { detail: n }));
      if (n.severity === 'emergency') {
        setEmergency(n);
        try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* not supported */ }
        beep();
      }
    });
    es.addEventListener('alert', (e) => window.dispatchEvent(new CustomEvent('sehat:alert', { detail: JSON.parse((e as MessageEvent).data) })));
    return () => es.close();
  }, [me.user?.id]);

  if (!emergency) return null;
  const pid = emergency.patientId ?? emergency.patient_id;
  return (
    <div className="sos" role="alertdialog" aria-live="assertive" aria-label="Emergency alert">
      <div className="sos__in">
        <Icon name="alert" size={28} />
        <div className="sos__b"><b>{emergency.title}</b>{emergency.body && <span>{emergency.body}</span>}</div>
        <div className="sos__a">
          {me.user?.role !== 'patient' && pid && (
            <button className="btn btn--light" onClick={() => { setEmergency(null); navigate(`/portal?p=${pid}`); }}>Open patient</button>
          )}
          <a className="btn btn--light" href="tel:1122"><Icon name="phone" size={16} /> 1122</a>
          <button className="btn btn--ghost sos__x" onClick={() => setEmergency(null)} aria-label="Dismiss"><Icon name="close" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

/** A short two-tone alarm, made in the browser — no audio file to fail to load. */
function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((t, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = i % 2 ? 660 : 880; g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
    });
  } catch { /* autoplay blocked until the user interacts — the banner still shows */ }
}

export function NotificationBell() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = () => api.get<Notice[]>('/api/portal/notifications').then(setItems).catch(() => setItems([]));
  useEffect(() => {
    const on = () => { if (open) void load(); };
    window.addEventListener('sehat:notify', on);
    return () => window.removeEventListener('sehat:notify', on);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  if (!me.user) return null;
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next) { await load(); if (me.unread) { await api.post('/api/portal/notifications/read'); setUnread(0); } }
  };
  return (
    <div className="bell" ref={box}>
      <button className="btn btn--ghost btn--sm bell__btn" onClick={toggle} aria-expanded={open} aria-label={`Notifications${me.unread ? `, ${me.unread} unread` : ''}`}>
        <Icon name="bell" size={18} />{me.unread > 0 && <span className="bell__n">{me.unread > 9 ? '9+' : me.unread}</span>}
      </button>
      {open && (
        <div className="bell__pop" role="dialog" aria-label="Notifications">
          <div className="bell__h">Notifications</div>
          {!items && <div className="bell__empty">Loading…</div>}
          {items?.length === 0 && <div className="bell__empty">Nothing yet.</div>}
          <ul>
            {items?.map((n) => (
              <li key={n.id} className={`note note--${n.severity} ${n.read_at ? '' : 'note--new'}`}>
                <b dir="auto">{n.title}</b>
                {n.body && <span dir="auto">{n.body}</span>}
                <small>
                  {n.patient_name && <span dir="auto">{n.patient_name} · </span>}
                  {n.created_at && new Date(n.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {n.whatsapp && <span className={`note__wa ${n.whatsapp === 'sent' ? 'ok' : ''}`}> · WhatsApp {n.whatsapp === 'sent' ? 'sent' : n.whatsapp === 'not configured' ? 'off' : 'not delivered'}</span>}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
