# SehatSaathi — Architecture

```
                      ┌──────────────────────────────┐   ┌─────────────────────────┐
   Patient (Urdu)     │  React PWA  (press-and-hold) │   │  WhatsApp (voice notes) │
   low literacy       │  Talk · Timeline · Memory    │   │  Meta Cloud API webhook │
                      └──────────────┬───────────────┘   └────────────┬────────────┘
                                     │ WSS: 16 kHz PCM up / 24 kHz down │ HTTPS
                                     ▼                                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│  API  · Node 22 · Fastify · TypeScript              (keys never leave this box)   │
│                                                                                   │
│   speech in ──▶ Groq Whisper large-v3 (ur) ──▶ text                               │
│                                                                                   │
│   text ──▶ ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────────┐  │
│            │ EXTRACT     │──▶│ TRIAGE       │──▶│ red?  fixed Urdu phrase +     │  │
│            │ Qwen, JSON  │   │ rules.ts     │   │       cached clip + alert     │  │
│            │ glucose,    │   │ deterministic│   │ else: CONTEXT PACK ──▶ Qwen   │  │
│            │ symptoms…   │   │ no model     │   │       (memory-grounded reply) │  │
│            └─────────────┘   └──────────────┘   └──────────────┬───────────────┘  │
│                                                                │                  │
│   MEMORY ENGINE  ◀────────── after-turn (async) ───────────────┘                  │
│   ① working  ② episodic (pgvector)  ③ profile facts + provenance  ④ longitudinal  │
│                                                                                   │
│   text ──▶ Azure Speech ur-PK-UzmaNeural ──▶ speech out (PCM to web / OGG to WA)  │
│                                                                                   │
│   SCHEDULER (node-cron) ── due open_concerns ──▶ proactive WhatsApp check-in      │
│   CAREGIVER SSE  ── alerts fan out live to /care                                  │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        ▼
                       PostgreSQL 16 + pgvector  (patients · turns · readings · meals ·
                       med_events · symptoms · profile_facts · open_concerns · alerts · kb_chunks)
```

## The turn, step by step

1. **Persist the patient's words** before anything else (`turns`).
2. **Extract** one strict JSON object with `qwen-plus-character` (temperature 0): glucose value + context, symptom codes from a fixed enum, meals, medication taken/missed, pregnancy, intent. Impossible values (e.g. 25 or 2500 mg/dL — usually ASR slips) are dropped rather than triaged.
3. **Persist** readings / symptoms / meals / medication events with the turn as provenance.
4. **Triage** in `safety/rules.ts` — a data table of rules over the extracted values *and* the tier-4 history (e.g. sustained highs need ≥60% of a week's readings >180). The model is not consulted.
5. **Red** → reply is a fixed Urdu phrase (+ number read-back), played from a pre-rendered clip; an `alerts` row is written and fanned out to the caregiver dashboard over SSE; on WhatsApp the caregiver gets a message.
   **Otherwise** → build the *context pack*: profile facts, derived clinical features, due open concerns, semantically recalled earlier utterances, and 3 retrieved reference chunks. `qwen-plus-character` writes ≤3 spoken sentences, reading any number back first.
6. **Persist** the reply, then in the background: embed both turns, run profile extraction, raise/resolve open concerns.

## Memory tiers

| Tier | Storage | Write | Read |
|---|---|---|---|
| 1 Working | recent `turns` | every turn | last 6 turns as chat history |
| 2 Episodic | `turns.embedding` (1024-d, `qwen3.7-text-embedding`) | async after each turn | cosine × recency decay, top-4 |
| 3 Profile | `profile_facts` (key, value, confidence, `source_turn_id`, `supersedes`, `active`) | async extractor → `upsertFact()` | active facts → prompt; full history → Memory screen |
| 4 Longitudinal | `readings`, `meals`, `med_events`, `symptoms` | on extraction | `longitudinal()` → TIR, dawn pattern, rising-fasting streak, spike foods, adherence streak |

**Contradictions are not overwritten.** If a well-established fact (confidence ≥ 0.7) is contradicted, the old row is kept (inactive, linked by `supersedes`), the new one is recorded, and an `open_concerns` row of kind `contradiction` is raised so the agent asks the patient which is right.

**Open concerns are the agency mechanism.** A reported symptom raises a concern with a `follow_up_at`; the greeting asks about due concerns unprompted, and the scheduler messages WhatsApp patients when one comes due. Saying it is better resolves it.

## Why speech is not on Qwen

Alibaba lists no Urdu for any standalone TTS or ASR model. `qwen-audio-3.0-realtime-flash` *writes* correct Urdu but its speech was judged unintelligible by a native listener. Speech therefore runs on providers with genuine ur-PK support (Groq Whisper in, Azure `ur-PK-UzmaNeural` out), while Qwen keeps reasoning, extraction, profile memory and embeddings — the parts that make this a memory agent. The `voice/` layer is behind one interface; `omni.ts` remains as the realtime implementation for a future Qwen Urdu voice.

## Safety boundaries

- Rules decide escalation; the model phrases. `alerts.rule_id` records which rule fired.
- Emergency speech comes from cached clips (`data/clips`), never a live TTS call.
- Persona forbids dose changes, diagnosis and stopping medication; refusals are warm redirects.
- Every reply is grounded in retrieved reference chunks (`kb_chunks`), visible to caregivers.
- The API key, Groq key and Azure key live only in the `api` container, which is published on `127.0.0.1` only.
