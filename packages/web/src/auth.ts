import { useEffect, useState } from 'react';

export type Role = 'patient' | 'doctor' | 'family';
export interface User { id: string; role: Role; name: string; phone: string; patientId: string | null; specialty: string | null }
interface Me { user: User | null; unread: number; demo?: boolean; loaded: boolean }

/** Signed-in state shared by every component; the session itself is an HttpOnly cookie. */
let me: Me = { user: null, unread: 0, loaded: false };
const listeners = new Set<(m: Me) => void>();
const emit = () => listeners.forEach((l) => l(me));

export async function refreshMe(): Promise<Me> {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const j = (await r.json()) as Omit<Me, 'loaded'>;
    me = { ...j, loaded: true };
  } catch {
    me = { ...me, loaded: true };
  }
  emit();
  return me;
}

export function setUnread(n: number) { me = { ...me, unread: n }; emit(); }

export function useMe(): Me {
  const [m, setM] = useState(me);
  useEffect(() => {
    listeners.add(setM);
    if (!me.loaded) void refreshMe();
    return () => { listeners.delete(setM); };
  }, []);
  return m;
}

async function send<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
  return j;
}

export const api = {
  get: async <T,>(path: string): Promise<T> => {
    const r = await fetch(path, { credentials: 'same-origin' });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
    return j;
  },
  post: send,
  patch: <T,>(path: string, body: unknown) => send<T>(path, body, 'PATCH'),
  del: <T,>(path: string) => send<T>(path, undefined, 'DELETE'),
};

export async function login(phone: string, password: string) { await send('/api/auth/login', { phone, password }); return refreshMe(); }
export async function register(b: { role: Role; name: string; phone: string; password: string; specialty?: string; deviceRecordId?: string }) {
  await send('/api/auth/register', b); return refreshMe();
}
export async function demoLogin(role: Role) { await send('/api/auth/demo', { role }); return refreshMe(); }
export async function logout() { await send('/api/auth/logout'); me = { user: null, unread: 0, loaded: true }; emit(); }

/** Where each kind of account lands after signing in. */
export const homeFor = (r: Role) => (r === 'patient' ? '/app/care' : '/portal');
