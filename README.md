# SehatSaathi — صحت ساتھی

**A voice-first Urdu diabetes companion for Pakistan that remembers you.**
Live: **https://sehatsaathi.arunkumar.works** · Caregiver view: `/#/care` · Diagnostics: `/#/preflight`

> ⚕️ **SehatSaathi is not a doctor.** It supports self-management. It never diagnoses, never prescribes and never changes a dose. Emergencies are escalated to a human by a rules engine, not answered by a model.

---

## The problem

Pakistan has the **highest diabetes prevalence in the world** — 31.4% of adults, ~33 million people (IDF Diabetes Atlas 2024). Most patients are low-literacy, far from a specialist, and get no support between appointments. A text app is useless to someone who cannot read fluently; an English app is useless to someone who thinks in Urdu.

So SehatSaathi has one button. Hold it and speak:

> «آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں» — *"Today my sugar was 250, I feel dizzy."*

It answers in spoken Pakistani Urdu, grounded in **that patient's own history**.

## What makes it a memory agent

A chatbot answers. A companion remembers. Open the app on day 14 and it speaks first:

> «پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے — اب کیسا ہے؟»
> *"Last week you told me your foot was going numb — how is it now?"*

Nobody asked it to. Four memory tiers make that possible:

| Tier | What | How it shows up |
|---|---|---|
| **Episodic** | every utterance, embedded (`qwen3.7-text-embedding`, pgvector) | *"that medicine you mentioned last time"* resolves correctly |
| **Profile** | structured facts with **provenance + confidence**, versioned | the Memory screen shows *what* it knows and *the exact sentence it learned it from* |
| **Longitudinal** | glucose / meals / medication time-series → time-in-range, dawn pattern, rising-fasting streak, spike foods, adherence | *"your morning sugar has risen 5 days running — try an earlier dinner"* |
| **Open concerns** | unresolved symptoms, contradictions, trends, each with a follow-up time | unprompted check-ins in the greeting; proactive WhatsApp messages via a scheduler |

**Contradictions are never silently overwritten.** *"Metformin once daily"* then *"twice daily"* keeps both rows, links them, and raises a concern so the agent asks which is right.

## Safety: the model never makes the call

`packages/api/src/safety/rules.ts` is a deterministic rule table over extracted values and history. RED (hypo <70, DKA signs, >300, cardiac/stroke signs, diabetic foot, pregnancy thresholds) bypasses the model entirely: a fixed Urdu phrase, a **pre-rendered audio clip** (no live TTS dependency), an alert row, a live push to the caregiver dashboard, and a WhatsApp message to the family contact. Verified by `npm run test:safety` — 19 cases including "one bad reading is not a trend" and "red always beats amber".

## Two channels, one brain

- **PWA** (installable, RTL Urdu, press-and-hold mic, browser-speech fallback, emergency overlay with `tel:1122` and a pre-filled WhatsApp message)
- **WhatsApp bot** (Meta Cloud API): send a voice note, get a voice note back. Same orchestrator, same memory. Follow-ups arrive as messages.

## Stack

| Concern | Provider | Model |
|---|---|---|
| Reasoning, extraction, profile memory | **Alibaba Cloud Model Studio (Qwen)** | `qwen-plus-character`, `qwen-flash-character` |
| Embeddings (episodic recall + RAG) | **Alibaba Cloud Model Studio** | `qwen3.7-text-embedding` (1024-d) |
| Urdu speech → text | Groq | `whisper-large-v3` (language=ur, domain prompt) |
| Text → Pakistani Urdu speech | Azure Speech | `ur-PK-UzmaNeural` / `ur-PK-AsadNeural` |
| Data | PostgreSQL 16 + pgvector | — |
| Runtime | Node 22 · Fastify · WebSocket · React PWA · Docker | — |

### An honest finding about Urdu

**Alibaba lists no Urdu for any standalone TTS or ASR model.** The realtime `qwen-audio-3.0-realtime-flash` does write correct Urdu, but a native listener judged its *speech* unintelligible — disqualifying for a health app. The evidence is in `packages/api/scripts/spike-urdu-voice.ts`. Speech therefore runs on providers with real ur-PK support while Qwen keeps everything that makes this a memory agent. The `voice/` layer is one interface with three implementations, so a future Qwen Urdu voice is a config change.

## Alibaba Cloud integration — where to look

| File | Calls |
|---|---|
| `packages/api/src/llm/qwen.ts` | chat completions + embeddings on `dashscope-intl.aliyuncs.com` |
| `packages/api/src/orchestrator/extract.ts` | JSON clinical extraction |
| `packages/api/src/orchestrator/turn.ts` | memory-grounded reply generation, greeting |
| `packages/api/src/memory/extractor.ts` | profile-fact extraction |
| `packages/api/src/memory/engine.ts`, `rag/kb.ts` | embeddings for recall and retrieval |
| `packages/api/src/voice/omni.ts` | realtime WebSocket adapter (kept for a Qwen Urdu voice) |

Runtime proof: `GET /api/health` reports Model Studio reachability; `GET /api/health/ws` proves the realtime socket handshake.

## Run it

```bash
git clone <repo> /opt/sehatsaathi && cd /opt/sehatsaathi
cp .env.example .env   # DASHSCOPE_API_KEY (Singapore), GROQ_API_KEY, AZURE_SPEECH_KEY/REGION, DOMAIN
docker compose up -d --build
docker compose exec api npm run seed        # 14-day demo patient + knowledge base
```

TLS is terminated by a host nginx (see `deploy/nginx-sehatsaathi.conf`). **HTTPS is mandatory** — browsers block the microphone on plain HTTP.

```bash
docker compose exec api npm run test:safety           # 19 rule tests
docker compose exec api npm run test:voice -- --loop  # Urdu TTS → Whisper round trip
curl -s https://<domain>/api/health
```

## Demo script (3 minutes)

1. **Day 1** — hold the button: *"aaj sugar 250 thi, chakkar aa rahe hain"* → spoken Urdu reply, reading appears in the timeline.
2. **Day 14** — tap *"صحت ساتھی کو سنیں"*: the greeting asks about last week's numb foot and notes the rising morning readings. Open **یادداشت** to see each fact with the sentence it was learned from, and the Metformin contradiction it is waiting to resolve.
3. **Safety** — *"sugar 55 hai, pasina aa raha hai"* → red overlay, cached hypo instructions, caregiver dashboard lights up on a second device, one-tap WhatsApp to family.
4. **WhatsApp** — send the same voice note to the bot number; get a voice note back.

## Licence

MIT — see [LICENSE](LICENSE).
