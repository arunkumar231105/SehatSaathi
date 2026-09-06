const KEY = 'sehat.patientId';
const LANG_KEY = 'sehat.lang';

export type Lang = 'ur' | 'en';

export function getLang(): Lang {
  return (localStorage.getItem(LANG_KEY) as Lang) ?? 'ur';
}
export function setLang(l: Lang): void {
  localStorage.setItem(LANG_KEY, l);
}

/**
 * A cached id can outlive the row it points at — re-seeding the demo patient
 * gives it a new UUID while the browser still holds the old one, and every
 * later write then fails on the foreign key. So the cache is verified, not
 * trusted, and a stale entry is silently replaced.
 */
export async function getPatientId(): Promise<string> {
  const cached = localStorage.getItem(KEY);
  if (cached && (await patientExists(cached))) return cached;
  if (cached) localStorage.removeItem(KEY);

  // Default to the seeded demo patient so the memory features have history
  // to draw on from the very first open.
  try {
    const r = await fetch('/api/patients/demo');
    if (r.ok) {
      const { id } = (await r.json()) as { id: string };
      localStorage.setItem(KEY, id);
      return id;
    }
  } catch {
    /* fall through to creating a fresh patient */
  }
  return createPatient();
}

async function patientExists(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/patients/${id}/exists`);
    if (!r.ok) return false;
    return ((await r.json()) as { exists: boolean }).exists;
  } catch {
    return false;
  }
}

export async function createPatient(displayName?: string): Promise<string> {
  const r = await fetch('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  const { id } = (await r.json()) as { id: string };
  localStorage.setItem(KEY, id);
  return id;
}

export async function useDemoPatient(): Promise<string> {
  localStorage.removeItem(KEY);
  return getPatientId();
}

/** Drop a stale id and get a working one — used when a call 404s mid-session. */
export async function resetPatient(): Promise<string> {
  localStorage.removeItem(KEY);
  return getPatientId();
}

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return (await r.json()) as T;
}

const locale = () => (getLang() === 'en' ? 'en-GB' : 'ur-PK');
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
export const daysAgo = (d: string | Date) =>
  Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
