const KEY = 'sehat.patientId';

export async function getPatientId(): Promise<string> {
  const cached = localStorage.getItem(KEY);
  if (cached) return cached;
  // Default to the seeded demo patient so the memory features have history
  // to draw on from the very first open.
  const r = await fetch('/api/patients/demo');
  if (r.ok) {
    const { id } = (await r.json()) as { id: string };
    localStorage.setItem(KEY, id);
    return id;
  }
  return createPatient();
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

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('ur-PK', { day: 'numeric', month: 'short' });
export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString('ur-PK', { hour: 'numeric', minute: '2-digit' });
export const daysAgo = (d: string | Date) =>
  Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
