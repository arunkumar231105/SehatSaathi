-- SehatSaathi schema.
-- Applied automatically by the db container on first boot
-- (docker-entrypoint-initdb.d). To reapply after changing it you must drop
-- the sehat_pgdata volume — initdb scripts run once, on an empty data dir.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- text-embedding-v4 emits configurable dimensions; we pin 1024 everywhere.
-- Changing this requires reindexing every embedding column.

-- ─────────────────────────────────────────────────────────────
-- Patient
-- ─────────────────────────────────────────────────────────────
CREATE TABLE patients (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name  text,
  phone         text UNIQUE,
  caregiver_name  text,
  caregiver_phone text,           -- drives the wa.me escalation deep link
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  voice_plan  text            -- 'A' | 'B' | 'C' — which pipeline served it
);
CREATE INDEX ON sessions (patient_id, started_at DESC);

-- ─────────────────────────────────────────────────────────────
-- MEMORY TIER 2 — episodic
-- Every utterance, embedded, semantically recallable.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE turns (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('patient','agent')),
  text_ur      text,           -- Urdu, as spoken/spoken-back
  text_en      text,           -- English pivot; the cascade plans produce this
  embedding    vector(1024),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON turns (patient_id, created_at DESC);
-- Recall is always scoped to one patient and asks for ~5 neighbours, so a
-- small list count keeps recall high without a large build cost.
CREATE INDEX turns_embedding_idx ON turns
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────
-- MEMORY TIER 3 — semantic profile, versioned with provenance
-- A fact is never destructively overwritten: superseding rows point back at
-- what they replaced, so "how did you know that?" is always answerable.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE profile_facts (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  key            text NOT NULL,     -- 'diabetes_type' | 'roti_per_meal' | ...
  value          jsonb NOT NULL,
  confidence     real NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  source_turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,  -- provenance
  supersedes     uuid REFERENCES profile_facts(id) ON DELETE SET NULL,
  active         boolean NOT NULL DEFAULT true,
  learned_at     timestamptz NOT NULL DEFAULT now()
);
-- One live value per key per patient; superseded rows stay for the audit trail.
CREATE UNIQUE INDEX profile_facts_live_idx
  ON profile_facts (patient_id, key) WHERE active;

-- ─────────────────────────────────────────────────────────────
-- MEMORY TIER 4 — longitudinal clinical time-series
-- ─────────────────────────────────────────────────────────────
CREATE TABLE readings (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  turn_id     uuid REFERENCES turns(id) ON DELETE SET NULL,
  mg_dl       integer NOT NULL,
  -- fasting vs post-meal is what makes dawn-phenomenon detection possible
  context     text CHECK (context IN ('fasting','pre_meal','post_meal','random','bedtime')),
  taken_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON readings (patient_id, taken_at DESC);

CREATE TABLE meals (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  turn_id     uuid REFERENCES turns(id) ON DELETE SET NULL,
  description_ur text,
  items       jsonb,          -- resolved against the Pakistani food GI table
  est_gi_load real,
  eaten_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON meals (patient_id, eaten_at DESC);

CREATE TABLE medications (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name        text NOT NULL,      -- 'Metformin' / 'Glucophage' / insulin brand
  dose        text,
  schedule    text,               -- 'twice daily after meals'
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE med_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES medications(id) ON DELETE SET NULL,
  turn_id       uuid REFERENCES turns(id) ON DELETE SET NULL,
  taken         boolean NOT NULL,   -- false = explicitly reported missed
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON med_events (patient_id, occurred_at DESC);

CREATE TABLE symptoms (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  turn_id     uuid REFERENCES turns(id) ON DELETE SET NULL,
  code        text NOT NULL,      -- 'dizziness' | 'foot_numbness' | ...
  severity    text CHECK (severity IN ('mild','moderate','severe')),
  reported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON symptoms (patient_id, reported_at DESC);

-- ─────────────────────────────────────────────────────────────
-- Open concerns — the engine behind unprompted follow-up.
-- Written when a symptom goes unresolved OR when the profile extractor
-- hits a contradiction it refuses to silently overwrite.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE open_concerns (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('symptom','contradiction','adherence','trend')),
  summary_ur   text NOT NULL,     -- spoken verbatim on follow-up
  summary_en   text,
  detail       jsonb,
  raised_at    timestamptz NOT NULL DEFAULT now(),
  follow_up_at timestamptz,       -- when the scheduler should raise it
  resolved_at  timestamptz
);
CREATE INDEX ON open_concerns (patient_id, follow_up_at) WHERE resolved_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Safety escalations. Rows here are written by the deterministic rules
-- engine, never by the model.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  turn_id      uuid REFERENCES turns(id) ON DELETE SET NULL,
  severity     text NOT NULL CHECK (severity IN ('red','amber')),
  rule_id      text NOT NULL,     -- which rule fired, for auditability
  reason_ur    text NOT NULL,
  reason_en    text NOT NULL,
  acknowledged_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON alerts (patient_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- RAG grounding corpus. Every clinical claim cites a chunk from here.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE kb_chunks (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source     text NOT NULL,       -- 'ADA-SoC' | 'IDF-DAR' | 'PK-food-GI' | ...
  title      text,
  content    text NOT NULL,
  embedding  vector(1024),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kb_chunks_embedding_idx ON kb_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
