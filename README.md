<div align="center">

# SehatSaathi · صحت ساتھی

**A voice-first Urdu diabetes companion for Pakistan — that remembers you.**

[**Live site**](https://sehatsaathi.arunkumar.works) · [Web app](https://sehatsaathi.arunkumar.works/app) · [Caregiver dashboard](https://sehatsaathi.arunkumar.works/care) · [System status](https://sehatsaathi.arunkumar.works/preflight)

</div>

> ⚕️ **SehatSaathi is not a doctor and not a medical service.** It supports self-management between appointments. It does not diagnose, does not prescribe, and never changes a medication dose. Emergencies are escalated to a human by a deterministic rules engine — not answered by a language model. In an emergency call **1122**.

---

## The problem

Pakistan has the **highest diabetes prevalence in the world**: 31.4% of adults, roughly **33 million people** ([IDF Diabetes Atlas, 11th ed., 2024](https://diabetesatlas.org/)).

Most of them are low-literacy, live far from a specialist, and see a doctor a handful of times a year. Between those visits they manage a complex, dangerous condition alone — deciding what to eat, whether a reading is a problem, and when dizziness is an emergency.

Every digital health tool assumes they can read English, or at least read. SehatSaathi assumes only that they can **talk**, and that they have a phone with **WhatsApp**.

```
Patient sends a voice note:  «آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں»
                             "Today my sugar was 250, I'm feeling dizzy."

SehatSaathi replies, spoken: «آپ نے بتایا شوگر 250۔ بریانی کے بعد شوگر بڑھ جاتی ہے —
                              تھوڑی مقدار لیں اور کھانے کے بعد چہل قدمی کریں۔»
                             "You said 250. Sugar rises after biryani — take a
                              smaller portion and walk after eating."
```

It knows about the biryani because the patient mentioned it three days ago.

---

## What makes it different: memory

A chatbot answers questions. A companion **remembers** — and acts on what it remembers without being asked.

Open the app on day 14 and it speaks first:

> «پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے — اب کیسا ہے؟ اور آپ کی صبح کی شوگر پانچ دن سے بڑھ رہی ہے۔»
>
> *"Last week you told me your foot was going numb — how is it now? And your morning sugar has been rising for five days."*

Nobody prompted that. Four memory tiers make it possible:

| Tier | What it stores | What it enables |
|---|---|---|
| **1 · Working** | The current session's turns | Conversational coherence |
| **2 · Episodic** | Every utterance + a 1024-d embedding in pgvector | *"that medicine you mentioned last time"* resolves correctly |
| **3 · Profile** | Structured facts with **confidence + provenance**, versioned | The Memory screen shows every fact **and the exact sentence it was learned from** |
| **4 · Longitudinal** | Glucose / meal / medication time-series | Time-in-range, dawn phenomenon, rising-fasting streaks, which foods precede spikes, adherence |

**Contradictions are never silently overwritten.** *"Metformin once daily"* followed later by *"twice daily"* keeps both rows, links them via `supersedes`, and raises an open concern so the agent asks which is right rather than trusting whichever was said last.

**Open concerns are the agency mechanism.** A reported symptom gets a `follow_up_at` date. When it comes due, the greeting raises it — or, on WhatsApp, the scheduler messages the patient first.

---

## Safety: the model never makes the medical call

[`safety/rules.ts`](packages/api/src/safety/rules.ts) is a table of **11 deterministic rules** evaluated over extracted values and clinical history. Whether a situation is an emergency is decided in code, not in a prompt. The language model's job is warmth and Urdu fluency; triage is not its job.

**RED — bypasses the model entirely:**
- Blood glucose < 70 mg/dL (hypoglycaemia)
- \> 250 mg/dL with vomiting, abdominal pain or rapid breathing (possible DKA)
- \> 300 mg/dL
- Chest pain, one-sided weakness, slurred speech, sudden vision loss, confusion
- Foot ulcer, non-healing wound, spreading redness
- Any abnormal reading in pregnancy

A red finding produces a **fixed phrase** played from a **pre-rendered audio clip** — so an emergency instruction never depends on a live TTS call — writes an `alerts` row with the `rule_id` that fired, pushes it to the caregiver dashboard over SSE, and WhatsApps the family contact.

**The agent will never** prescribe, name a medicine to start, change or suggest a dose, or tell a patient to stop a medicine. Asked anyway, it explains *why* the decision needs bloodwork and offers to help prepare the question for the doctor — it never leaves the patient with nothing.

```console
$ npm run test:safety
  19 passed, 0 failed
```

Including the cases that matter: *one high reading is not a sustained trend*, and *red always dominates a concurrent amber*.

---

## Architecture

```
   WhatsApp voice note                    React PWA (press-and-hold)
            │                                      │  16 kHz PCM up
            │  Meta Cloud API                      │  24 kHz PCM down
            ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Fastify + ws  ·  keys never leave this process                      │
│                                                                      │
│  speech in ─▶ Groq Whisper large-v3 ─▶ text                          │
│                                                                      │
│  ┌───────────┐   ┌──────────────┐   ┌──────────────────────────────┐ │
│  │ EXTRACT   │──▶│ TRIAGE       │──▶│ red?  fixed phrase + cached  │ │
│  │ strict    │   │ rules.ts     │   │       clip + alert + family  │ │
│  │ JSON      │   │ deterministic│   │ else: CONTEXT PACK ─▶ model  │ │
│  └───────────┘   └──────────────┘   └──────────────┬───────────────┘ │
│                                                    │                 │
│  MEMORY ENGINE ◀───────── after-turn (async) ──────┘                 │
│  episodic · profile+provenance · longitudinal · open concerns        │
│                                                                      │
│  text ─▶ Azure ur-PK-UzmaNeural ─▶ speech  (PCM to web, OGG to WA)   │
│                                                                      │
│  SCHEDULER ── due concerns ─▶ proactive WhatsApp check-in            │
│  SSE ── alerts ─▶ caregiver dashboard, live                          │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
              PostgreSQL 16 + pgvector
   patients · sessions · turns · readings · meals · med_events
   symptoms · medications · profile_facts · open_concerns · alerts · kb_chunks
```

### A turn, step by step

1. **Persist the patient's words first** — nothing downstream may lose them.
2. **Extract** one strict JSON object (temperature 0): glucose value + context, symptom codes from a fixed enum, meals, medication taken/missed, pregnancy, intent. Physiologically impossible values (25 or 2500 mg/dL — usually ASR slips) are dropped rather than triaged.
3. **Persist** readings, symptoms, meals and medication events, each linked to the turn that produced them.
4. **Triage** against the rule table, using both this turn and the patient's history.
5. **Red** → fixed phrase, cached audio, alert, caregiver notified. **Otherwise** → assemble the *context pack* (profile, derived clinical features, due concerns, semantically recalled utterances, retrieved reference chunks) and generate a reply of 2–3 spoken sentences.
6. **Background**: embed both turns, extract profile deltas, raise or resolve concerns.

### Models

| Job | Model | Why |
|---|---|---|
| Reasoning, extraction, profile memory | **`qwen/qwen3.8-27b`** (open weights, via Groq) | Chosen by a head-to-head on real patient turns — see below |
| Embeddings — episodic recall + RAG | **`qwen3.7-text-embedding`** (Alibaba Cloud Model Studio), 1024-d | Multilingual, matches the schema exactly |
| Fallback brain | `qwen-plus-character` (Model Studio) | A Groq rate limit degrades quality instead of ending the conversation |
| Urdu speech → text | **Groq `whisper-large-v3`**, `language=ur` | Real Urdu support; handles the Urdu/English code-switching Pakistanis actually speak |
| Text → Urdu speech | **Azure `ur-PK-UzmaNeural`** / `ur-PK-AsadNeural` | Purpose-built Pakistani Urdu, not a multilingual model guessing |
| Text → English speech | Azure `en-IN-NeerjaNeural` | Azure has **no** `en-PK` voices; en-IN is the closest South Asian English |

---

## Engineering notes

Findings that shaped the build, kept here because each one cost real time.

**Alibaba has no usable Urdu speech.** No standalone Alibaba TTS or ASR model lists Urdu. The realtime `qwen-audio-3.0-realtime-flash` *writes* correct Urdu but a native listener judged its speech unintelligible — disqualifying for a health app whose entire premise is being understood. Speech therefore runs on providers with genuine ur-PK support, while Qwen keeps reasoning, extraction, profile memory and embeddings. The `voice/` layer sits behind one interface with three implementations ([`omni.ts`](packages/api/src/voice/omni.ts) is retained for a future Qwen Urdu voice). Evidence: [`scripts/spike-urdu-voice.ts`](packages/api/scripts/spike-urdu-voice.ts).

**Denied models fail silently.** On this account's quota the realtime socket *opens* and only refuses at generation time, so a permission error looks exactly like "no audio came back". Worth knowing before debugging the wrong layer.

**Free quota binds to dated snapshot IDs.** `qwen3-asr-flash` is denied while `qwen3-asr-flash-2026-02-10` works.

**The brain was chosen by measurement, not benchmarks.** Five candidates on real patient turns. `qwen-plus-character` (roleplay-tuned) invented family facts — it called the patient's *son* "your daughter" — drifted into Roman Urdu, and asserted medicines the patient did not take. `gpt-oss-20b` advised **doubling up on missed Metformin doses**, which is unsafe. `qwen3.8-27b` answered *"there is no mention of insulin in your record"*, in 100% Urdu script, roughly twice as fast.

**Roman Urdu is unusable output.** An `ur-PK` voice pronounces Latin letters as English, producing noise. Replies are script-checked with a forced retry before anything reaches TTS.

**A flat key/value profile confuses identity with relationship.** Given `caregiver: Bilal (son)` in a list, the model addressed a 58-year-old woman as her son. Identity, medicines and other facts are now stated as separate closed lists, and reference chunks are explicitly labelled as general information rather than statements about the patient.

**WhatsApp has a 24-hour messaging window.** Free-form sends are refused outside 24 h of the patient's last message (error 131047). The scheduler pre-checks the window and *defers* rather than burning retries — the concern stays open and is delivered by the greeting on the patient's next contact.

---

## Running it

### Requirements

- Docker + Docker Compose
- A domain with an A record at your host. **HTTPS is mandatory** — browsers block microphone access on plain HTTP.
- API keys: [Alibaba Cloud Model Studio](https://home.qwencloud.com/api-keys) (Singapore/International — the free quota and Urdu support do not exist in the Beijing region), [Groq](https://console.groq.com), [Azure Speech](https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices) (**F0 tier is free**, 500 K chars/month).

### Deploy

```bash
git clone <repo> /opt/sehatsaathi && cd /opt/sehatsaathi
cp .env.example .env          # fill in the keys and DOMAIN
docker compose up -d --build
docker compose exec api npm run seed     # 14-day demo patient + knowledge base
```

Four containers: `web` (React, `127.0.0.1:8100`), `api` (Fastify, `127.0.0.1:8101`), `db` (Postgres + pgvector, `127.0.0.1:5433`). Nothing binds to a public interface — TLS is terminated by a host nginx, so the stack coexists with whatever else is on the box. See [`deploy/nginx-sehatsaathi.conf`](deploy/nginx-sehatsaathi.conf); the `Upgrade`/`Connection` headers and the raised `proxy_read_timeout` there are both load-bearing for the voice socket.

### WhatsApp

At **developers.facebook.com → your app → WhatsApp → API Setup**:

1. Copy the **access token** and **Phone number ID** into `.env`
2. **Configuration → Webhook**: URL `https://<domain>/api/whatsapp/webhook`, verify token = your `WHATSAPP_VERIFY_TOKEN`
3. Click **Manage** and subscribe to **`messages`** — easy to miss, and nothing arrives without it
4. Add recipient numbers under **To → Manage phone number list** (the free test number is capped at 5; registering a real number lifts this to 250 unique recipients per 24 h)

If webhooks verify but nothing arrives, check the app is actually subscribed to the WABA:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://graph.facebook.com/v21.0/$WABA_ID/subscribed_apps"
```

### Verify

```bash
curl -s https://<domain>/api/health        # db · Model Studio · asr · tts · whatsapp
docker compose exec api npm run test:safety            # 19 rule tests
docker compose exec api npm run test:voice -- --loop   # Urdu TTS → Whisper round trip
```

The round trip is the honest voice test: synthesise real clinical Urdu, feed it back through Whisper, compare. Current scores **89–100 % word match**, including **100 % on the emergency hypoglycaemia instruction**.

`/preflight` runs the same checks in the browser, including microphone permission on the actual device.

---

## Project layout

```
packages/api/src/
  orchestrator/   turn.ts        one conversational turn, end to end
                  extract.ts     strict JSON clinical extraction
  memory/         engine.ts      the four tiers: storage, recall, derived features
                  extractor.ts   async profile-delta extraction
  safety/         rules.ts       11 deterministic triage rules
                  phrases.ts     fixed Urdu/English wording
                  clips.ts       pre-rendered emergency audio
  voice/          cascade.ts     Whisper → brain → Azure  (active)
                  groq-asr.ts    Urdu speech recognition
                  azure-tts.ts   ur-PK / en-IN synthesis
                  omni.ts        realtime adapter, kept for a Qwen Urdu voice
  rag/kb.ts       46 curated chunks: PK medicines, foods, complications, Ramzan
  whatsapp/       Meta Cloud API webhook and sender
  routes/         REST + the /ws/voice socket
  db/schema.sql   12 tables, pgvector on turns and kb_chunks

packages/web/src/
  site/           marketing landing page
  screens/        Talk · Timeline · Memory · Care · Preflight
  audio/          AudioWorklet capture (16 kHz) and gapless playback (24 kHz)
  voice/          the socket, mic and speaker hook
  i18n.ts         Urdu ⇄ English
```

~5,400 lines of TypeScript.

---

## Known limitations

Stated plainly, because a health project that hides them is worse than one that doesn't.

- **WhatsApp is on a test number**, capped at 5 verified recipients. A real number lifts this to 250/day.
- **The caregiver dashboard has no authentication.** Fine for a demo, wrong for real patients.
- **New WhatsApp users get a generic greeting.** There is no onboarding flow yet to collect name, diabetes type and medicines.
- **Whisper can mishear numbers.** Mitigated by reading every logged value back for confirmation, and by rejecting physiologically impossible ones — but not eliminated.
- **The knowledge base is curated, not exhaustive**, and covers type 2 diabetes in adults.
- **Not clinically validated.** No trial, no regulatory clearance, no clinician sign-off.

---

## Licence

MIT — see [LICENSE](LICENSE).
