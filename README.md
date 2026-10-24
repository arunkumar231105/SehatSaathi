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

## It asks before it advises

*"My sugar is 250"* on its own only supports generic advice. A nurse would ask first — so does SehatSaathi, one short question per message, never more than three:

```
Patient:  آج شوگر 250 تھی                       "My sugar was 250 today."
Saathi:   خالی پیٹ چیک کی تھی یا کھانے کے بعد؟     "Fasting, or after eating?"
Patient:  کھانے کے بعد                           "After eating."
Saathi:   الٹی، پیٹ درد، تیز سانس یا بہت پیاس؟      "Any vomiting, stomach pain, fast breathing, strong thirst?"
Patient:  نہیں                                    "No."
Saathi:   دوپہر کو کیا کھایا تھا؟                   "What did you eat at lunch?"
Patient:  بریانی اور دو روٹیاں                     "Biryani and two rotis."
Saathi:   one recommendation, tied to the biryani, the timing and the number.
```

[`orchestrator/intake.ts`](packages/api/src/orchestrator/intake.ts) decides **which** question comes next — timing, then the danger check on any reading of 250+, then food, then medicine — from what is still unknown. Nothing already said is asked again, a reading in range gets no interrogation, and a high *fasting* reading asks about last night's dinner rather than breakfast. The model only phrases the question.

This also makes triage see across messages: *"280"*, then two answers later *"I've been vomiting"*, is suspected ketoacidosis even though no single message said both — the rules run over everything learned in the exchange. An emergency never waits for questions.

```console
$ npm run test:intake
  19 passed, 0 failed
```

---

## Safety: the model never makes the medical call

[`safety/rules.ts`](packages/api/src/safety/rules.ts) is a table of **12 deterministic rules** evaluated over extracted values and clinical history. Whether a situation is an emergency is decided in code, not in a prompt. The language model's job is warmth and Urdu fluency; triage is not its job.

**RED — bypasses the model entirely:**
- Blood glucose < 70 mg/dL (hypoglycaemia)
- \> 250 mg/dL with vomiting, abdominal pain or rapid breathing (possible DKA)
- \> 300 mg/dL — and at 400 or above, *go to hospital now*
- Chest pain, one-sided weakness, slurred speech, sudden vision loss, confusion
- Foot ulcer, non-healing wound, spreading redness
- Any abnormal reading in pregnancy

A red finding produces a **fixed phrase** played from a **pre-rendered audio clip** — so an emergency instruction never depends on a live TTS call — writes an `alerts` row with the `rule_id` that fired, and alerts **everyone on the patient's care team** — their doctor and family — in the portals within a second, with the patient's own words, plus WhatsApp where Meta allows it. The patient is told help has been called.

**The agent will never** prescribe, name a medicine to start, change or suggest a dose, or tell a patient to stop a medicine. Asked anyway, it explains *why* the decision needs bloodwork and offers to help prepare the question for the doctor — it never leaves the patient with nothing.

```console
$ npm run test:safety
  22 passed, 0 failed
```

Including the cases that matter: *one high reading is not a sustained trend*, and *red always dominates a concurrent amber*.

### Medicines: explained and checked, never prescribed

[`meds/reference.ts`](packages/api/src/meds/reference.ts) is a small, hand-written reference for the diabetes medicines used in Pakistan — metformin, gliclazide, glimepiride, glibenclamide, sitagliptin, vildagliptin, empagliflozin, dapagliflozin, pioglitazone, premixed insulin and glargine — in English and Urdu, every entry citing its source (NHS medicine guides, NICE BNF, EMA, the US FDA label). Brands are only those found on Pakistani pharmacy listings (Glucophage, Neodipar, Getryl, Diamicron MR, Treviamet, Galvus Met, Xiga, Mixtard 30…); combination tablets are recognised as both of their medicines; an unrecognised brand is asked about, never guessed.

Public "medicine" datasets were tried first and rejected — one assigned indications at random (*Metformin: "used for pain relief"*), the others contained no medicine information at all.

It does three things, all for medicines the patient **already takes**:

- **Explains** what each one is for, how to take it, common side effects, what to do about a missed dose, and the one warning sign worth knowing — on a *Medicines* screen and in conversation, where the model may explain only from these sourced facts.
- **Checks** the record with fixed rules ([`meds/checks.ts`](packages/api/src/meds/checks.ts)): the same medicine twice (Glucophage + Treviamet), two from the same family, lows on a medicine that causes them, vomiting on an SGLT2 inhibitor or metformin, pioglitazone with heart failure, kidney disease, pregnancy, fasting in Ramzan. Flags reach the patient, the conversation and the caregiver dashboard.
- **Prepares the doctor visit**: a short list built from the patient's own record — *"My fasting sugar has risen 5 days in a row on Metformin (Glucophage). Does my treatment need a review?"* — that they can listen to, share on WhatsApp, or get by sending `doctor`.

Every output points toward the doctor; a test fails the build if any patient-facing text tells someone to start, stop, switch or re-dose a medicine.

```console
$ npm run test:meds
  32 passed, 0 failed
```

---

## Three portals, one record

The patient, their doctor and their family each sign in to see the same care, from their side.

| Portal | What it does |
|---|---|
| **Doctor** (`/portal`) | Patients sorted with emergencies and the highest sugar first. Each patient's last **3 months**: monthly mean and time in range, a 13-week chart, an **estimated HbA1c** (GMI, Bergenstal 2018) and a stage, and whether they are **improving, stable or worsening**. Assigns **medicines, instructions, appointments and tests** — each reaches the patient and family at once, and the companion reminds the patient of them in conversation. |
| **Family** (`/portal`) | The same record, read-only, for the person they look after. Alerted the moment there is an emergency, and can mark it handled so the rest of the team knows. |
| **Patient** (*My care* in the app) | The doctor's instructions and appointments (ticked off when done), their own 3-month progress in Urdu, and who is on their care team. |

**Access is the patient's choice.** A doctor or relative connects only with the 6-letter code on the patient's *My care* screen; the patient can remove anyone, or make a new code. A patient who already talks to the bot on WhatsApp keeps their whole history when they create an account with the same number.

**Emergencies reach everyone.** *"Sugar 500 hai aur bohat sar dard hai"* → the rules engine fires, the patient is told to go to hospital now and that their doctor and family have been alerted, and a red banner (with sound) appears on every care-team member's screen with the patient's words and a one-tap call. Appointment and test reminders go out the day before.

Notifications are always delivered in the portals; WhatsApp is attempted too and the outcome is recorded on each one, because Meta only delivers free-form messages to someone who has messaged the bot in the last 24 hours.

**Try it:** the sign-in page has one-tap demo buttons for a doctor, a family member and the demo patient. The demo accounts have random passwords and can only be entered that way (`DEMO_LOGINS=off` disables them). Passwords are scrypt-hashed; sessions are HttpOnly cookies.

```console
$ npm run test:portal
  24 passed, 0 failed
```

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
docker compose exec api npm run seed:portals   # demo doctor/family/patient accounts, 3 months of history
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
docker compose exec api npm run test:safety            # 22 rule tests
docker compose exec api npm run test:portal            # 24 progress and account tests
docker compose exec api npm run test:intake            # 19 follow-up question tests
docker compose exec api npm run test:meds              # 32 medicine reference and check tests
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
  safety/         rules.ts       12 deterministic triage rules
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
