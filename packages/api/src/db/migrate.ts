/**
 * Additive migrations, run on every boot.
 *
 * schema.sql only runs when the database volume is first created, so later
 * tables are added here with IF NOT EXISTS — safe to re-run, never drops or
 * rewrites existing data. New installs get them on first boot too.
 */

import { pool } from './client.ts';

const STEPS: string[] = [
  // ── Accounts: one login per person, whatever their role ────────────────
  `CREATE TABLE IF NOT EXISTS users (
     id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     role          text NOT NULL CHECK (role IN ('patient','doctor','family')),
     name          text NOT NULL,
     phone         text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     -- a patient account is the login for exactly one patients row
     patient_id    uuid UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
     specialty     text,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
     token_hash  text PRIMARY KEY,
     user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at  timestamptz NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,

  // ── Who may see a patient. A link is created only with the patient's
  //    share code, so access is something the patient hands out. ───────────
  `ALTER TABLE patients ADD COLUMN IF NOT EXISTS share_code text UNIQUE`,
  `CREATE TABLE IF NOT EXISTS care_team (
     patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     relation    text NOT NULL CHECK (relation IN ('doctor','family')),
     label       text,                 -- 'son', 'daughter-in-law', 'endocrinologist'
     created_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (patient_id, user_id)
   )`,

  // ── What a doctor assigns: medicines, precautions, appointments, tests ──
  `CREATE TABLE IF NOT EXISTS care_orders (
     id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     doctor_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind         text NOT NULL CHECK (kind IN ('medicine','precaution','appointment','test')),
     title        text NOT NULL,
     detail       text,
     dose         text,
     schedule     text,
     due_at       timestamptz,          -- appointment / test date
     status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
     medication_id uuid REFERENCES medications(id) ON DELETE SET NULL,
     reminded_at  timestamptz,
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS care_orders_patient ON care_orders (patient_id, status, created_at DESC)`,

  // ── In-portal notifications: the delivery route that always works ──────
  `CREATE TABLE IF NOT EXISTS notifications (
     id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     patient_id  uuid REFERENCES patients(id) ON DELETE CASCADE,
     kind        text NOT NULL,         -- 'emergency' | 'alert' | 'order' | 'appointment' | 'link'
     severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','emergency')),
     title       text NOT NULL,
     body        text,
     whatsapp    text,                  -- 'sent' | 'failed: …' | null when not attempted
     read_at     timestamptz,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, created_at DESC)`,
];

export async function migrate(): Promise<void> {
  for (const sql of STEPS) await pool.query(sql);
}
