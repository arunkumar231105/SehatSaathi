/**
 * Accounts for the patient, doctor and family portals.
 *
 * Phone + password, because a phone number is the one identifier every user
 * here already has. Passwords are hashed with scrypt (Node's built-in, no
 * extra dependency); sessions are random tokens stored only as a SHA-256
 * hash, carried in an HttpOnly cookie so page scripts can never read them.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { q, one } from '../db/client.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export type Role = 'patient' | 'doctor' | 'family';

export interface User {
  id: string;
  role: Role;
  name: string;
  phone: string;
  patient_id: string | null;
  specialty: string | null;
}

const COOKIE = 'ss_session';
const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

/** "0300-1234567", "+92 300 1234567" and "923001234567" are the same person. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('92')) return d;
  if (d.startsWith('0')) return `92${d.slice(1)}`;
  return d;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function startSession(reply: FastifyReply, req: FastifyRequest, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`,
    [sha(token), userId],
  );
  // Behind the host nginx the request arrives as http; trust its header.
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`,
  );
}

function tokenOf(req: FastifyRequest): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=') || null;
  }
  return null;
}

export async function endSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const t = tokenOf(req);
  if (t) await q(`DELETE FROM auth_sessions WHERE token_hash=$1`, [sha(t)]);
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function currentUser(req: FastifyRequest): Promise<User | null> {
  const t = tokenOf(req);
  if (!t) return null;
  const u = await one<User>(
    `SELECT u.id, u.role, u.name, u.phone, u.patient_id, u.specialty
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [sha(t)],
  );
  return u ?? null;
}

/** For route handlers: the signed-in user, or a 401 already sent. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply, roles?: Role[]): Promise<User | null> {
  const u = await currentUser(req);
  if (!u) { void reply.code(401).send({ error: 'sign in required' }); return null; }
  if (roles && !roles.includes(u.role)) { void reply.code(403).send({ error: 'not allowed for this account' }); return null; }
  return u;
}

/** May this user see this patient's record? The patient themself, or someone on their care team. */
export async function canView(u: User, patientId: string): Promise<boolean> {
  if (u.role === 'patient') return u.patient_id === patientId;
  const row = await one(`SELECT 1 FROM care_team WHERE patient_id=$1 AND user_id=$2`, [patientId, u.id]);
  return !!row;
}

export async function isDoctorOf(u: User, patientId: string): Promise<boolean> {
  if (u.role !== 'doctor') return false;
  return !!(await one(`SELECT 1 FROM care_team WHERE patient_id=$1 AND user_id=$2 AND relation='doctor'`, [patientId, u.id]));
}

/** 6 characters, no 0/O/1/I so it can be read out over the phone. */
export function newShareCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(6);
  return [...b].map((x) => A[x % A.length]).join('');
}

export async function shareCodeFor(patientId: string): Promise<string> {
  const row = await one<{ share_code: string | null }>(`SELECT share_code FROM patients WHERE id=$1`, [patientId]);
  if (row?.share_code) return row.share_code;
  for (let i = 0; i < 5; i++) {
    const code = newShareCode();
    const ok = await one(`UPDATE patients SET share_code=$1 WHERE id=$2 AND share_code IS NULL RETURNING id`, [code, patientId])
      .catch(() => undefined);   // unique clash: try another
    if (ok) return code;
  }
  throw new Error('could not allocate share code');
}

/**
 * Who may read or write a patient's record through the patient-app API.
 *
 *  - the demo patient: anyone (it is the public demo);
 *  - a record with no account yet (an anonymous web-app device, or a
 *    WhatsApp-only patient): whoever holds its id — ids are random UUIDs and
 *    are no longer listed anywhere public;
 *  - a record that belongs to an account: only that patient or their care team.
 */
export async function patientAccess(req: FastifyRequest, patientId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) return false;
  const p = await one<{ phone: string | null; claimed: boolean }>(
    `SELECT p.phone, EXISTS (SELECT 1 FROM users u WHERE u.patient_id = p.id) AS claimed FROM patients p WHERE p.id=$1`,
    [patientId],
  );
  if (!p) return true;                       // let the route answer 404 as before
  if (p.phone === 'demo' || !p.claimed) return true;
  const u = await currentUser(req);
  return !!u && (await canView(u, patientId));
}
