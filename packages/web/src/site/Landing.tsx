import { useEffect, useRef, useState } from 'react';
import { Link } from '../router.tsx';

interface WaStatus { configured: boolean; number?: string | null }

const WA_TEXT = encodeURIComponent('السلام علیکم صحت ساتھی');

export default function Landing() {
  const [wa, setWa] = useState<WaStatus>({ configured: false });
  useEffect(() => {
    fetch('/api/whatsapp/status').then((r) => r.json()).then(setWa).catch(() => undefined);
  }, []);
  const waHref = wa.number ? `https://wa.me/${wa.number.replace(/\D/g, '')}?text=${WA_TEXT}` : '#whatsapp';

  return (
    <div className="site">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="wrap hero__grid">
          <div className="hero__copy">
            <span className="eyebrow">Voice-first diabetes companion · Pakistan</span>
            <h1>Diabetes care that speaks Urdu — and remembers you.</h1>
            <p className="lead">
              SehatSaathi is a WhatsApp voice companion for the 33 million people living with diabetes in Pakistan.
              Send a voice note in Urdu. Get clear, spoken guidance in your own language — from a companion that
              knows your history, notices your patterns, and checks on you without being asked.
            </p>
            <div className="cta">
              <a className="btn btn--primary btn--lg" href={waHref} target={wa.number ? '_blank' : undefined} rel="noreferrer">
                <WaIcon /> Message on WhatsApp
              </a>
              <Link className="btn btn--outline btn--lg" to="/app">Try the web demo</Link>
            </div>
            <p className="fine">Free to use · No app to install · Works on any phone with WhatsApp</p>
          </div>

          <PhoneMock />
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <section className="stats">
        <div className="wrap stats__grid">
          <Stat n="31.4%" l="of Pakistani adults live with diabetes" />
          <Stat n="33M" l="people — the highest prevalence in the world" />
          <Stat n="1 in 3" l="adults affected; most get no support between doctor visits" />
          <Stat n="Urdu" l="voice-first, because a health app you cannot read is no help at all" />
        </div>
        <p className="wrap fine center">Source: IDF Diabetes Atlas, 11th edition (2024)</p>
      </section>

      {/* ── Problem ──────────────────────────────────────────────────── */}
      <section className="section" id="why">
        <div className="wrap two">
          <div>
            <span className="eyebrow">Why this exists</span>
            <h2>A text app is useless to someone who cannot read it.</h2>
          </div>
          <div className="prose">
            <p>
              Most people with diabetes in Pakistan are low-literacy, live far from a specialist, and see a doctor
              a few times a year at best. Between those visits they manage a complex, dangerous condition alone —
              deciding what to eat, whether a reading is a problem, and when a dizzy spell is an emergency.
            </p>
            <p>
              Every digital health tool assumes they can read English, or at least read. SehatSaathi assumes nothing
              except that they can talk, and that they own a phone with WhatsApp — which, in Pakistan, almost
              everyone does.
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="section section--tint" id="how">
        <div className="wrap">
          <span className="eyebrow">How it works</span>
          <h2>Speak. Be understood. Be remembered.</h2>
          <div className="steps">
            <Step n="1" t="Send a voice note" d="On WhatsApp, in everyday Urdu — mixed with English words like “sugar” and “check” is fine. “Aaj sugar 250 thi, chakkar aa rahe hain.”" />
            <Step n="2" t="It understands the clinical facts" d="The reading, its context (fasting or after a meal), symptoms, what you ate, whether you took your medicine — extracted into structured data, never guessed." />
            <Step n="3" t="Safety rules decide first" d="A deterministic rules engine checks for emergencies before any AI writes a word. Dangerous values trigger fixed instructions and alert your family." />
            <Step n="4" t="A spoken reply, in your history’s context" d="Uzma — a native Pakistani Urdu voice — replies in two or three short sentences, reading your number back and grounding advice in what it knows about you." />
            <Step n="5" t="It follows up on its own" d="Mentioned numb feet last week? It asks how they are. Missed doses? It checks in. Memory that produces care, not just recall." />
          </div>
        </div>
      </section>

      {/* ── Hear it ──────────────────────────────────────────────────── */}
      <section className="section" id="listen">
        <div className="wrap">
          <span className="eyebrow">Listen</span>
          <h2>This is what a patient actually hears.</h2>
          <p className="lead narrow">
            Real audio from the running system — not a recording of a person. Azure’s <code>ur-PK</code> neural voice,
            the same one that answers on WhatsApp.
          </p>
          <div className="clips">
            <Clip
              src="/audio/memory.mp3"
              label="The day-14 follow-up"
              ur="السلام علیکم راشدہ بی بی! پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے۔ اب کیسا ہے؟ اور آپ کی صبح کی شوگر پانچ دن سے بڑھ رہی ہے۔"
              en="Hello Rashida Bibi! Last week you said your foot was going numb — how is it now? And your morning sugar has been rising for five days."
            />
            <Clip
              src="/audio/high.mp3"
              label="A high reading after biryani"
              ur="آپ نے بتایا شوگر دو سو پچاس۔ یہ زیادہ ہے۔ بریانی کے بعد شوگر بڑھ جاتی ہے، تھوڑی مقدار لیں اور کھانے کے بعد چہل قدمی کریں۔"
              en="You said 250. That is high. Sugar rises after biryani — take a smaller portion and walk after eating."
            />
            <Clip
              src="/audio/hypo.mp3"
              label="Emergency — low sugar"
              ur="آپ کی شوگر بہت کم ہے۔ ابھی فوراً تین چمچ چینی یا آدھا گلاس میٹھا جوس لیں، پھر پندرہ منٹ بعد دوبارہ شوگر چیک کریں۔"
              en="Your sugar is very low. Take three spoons of sugar or half a glass of sweet juice right now, then check again after fifteen minutes."
              danger
            />
          </div>
          <p className="fine">
            The emergency clip is pre-recorded and cached on the server — it plays even if the speech service is down,
            because an emergency instruction must never depend on a network call.
          </p>
        </div>
      </section>

      {/* ── Memory ───────────────────────────────────────────────────── */}
      <section className="section" id="memory">
        <div className="wrap">
          <span className="eyebrow">The difference</span>
          <h2>A chatbot answers. A companion remembers.</h2>
          <p className="lead narrow">
            SehatSaathi keeps four layers of memory about each patient — and every fact it holds is traceable to
            the exact sentence it learned it from.
          </p>

          <div className="tiers">
            <Tier icon="💬" t="Episodic" d="Every conversation, searchable by meaning. “That medicine you mentioned last time” resolves correctly." />
            <Tier icon="🪪" t="Profile" d="Structured facts — diagnosis, medicines, how many rotis, whether you fast in Ramzan — each with a confidence score and its source." />
            <Tier icon="📈" t="Longitudinal" d="Your readings over time: time-in-range, morning-sugar trends, which foods spike you, whether doses are being missed." />
            <Tier icon="🔔" t="Open concerns" d="Symptoms you reported, contradictions it noticed, trends worth watching — each with a date to bring it up again." />
          </div>

          <div className="dialogue">
            <div className="dialogue__day">
              <h3>Day 1</h3>
              <Bubble who="patient" ur="آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں۔ رات کو بریانی کھائی تھی۔" en="Today my sugar was 250, I feel dizzy. Had biryani last night." />
              <Bubble who="agent" ur="آپ نے بتایا شوگر 250۔ بریانی کے بعد شوگر بڑھ جاتی ہے — تھوڑی مقدار لیں اور کھانے کے بعد چہل قدمی کریں۔ چکر ٹھیک نہ ہوں تو بلال کو ضرور بتائیں۔" en="You said 250. Sugar rises after biryani — take a small portion and walk after eating. If the dizziness continues, tell Bilal." />
            </div>
            <div className="dialogue__day">
              <h3>Day 14 — unprompted</h3>
              <Bubble who="agent" ur="السلام علیکم راشدہ بی بی! پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے — اب کیسا ہے؟ اور آپ کی صبح کی شوگر پانچ دن سے بڑھ رہی ہے۔" en="Hello Rashida Bibi! Last week you said your foot was going numb — how is it now? And your morning sugar has been rising for five days." />
            </div>
          </div>
          <p className="fine center">Nobody asked it to. That follow-up is the whole point.</p>
        </div>
      </section>

      {/* ── Safety ───────────────────────────────────────────────────── */}
      <section className="section section--dark" id="safety">
        <div className="wrap two">
          <div>
            <span className="eyebrow eyebrow--light">Safety</span>
            <h2>The AI never makes the medical call.</h2>
            <p className="lead">
              Whether a situation is an emergency is decided by a fixed, auditable rules engine — in code, not in a
              prompt. The language model’s job is warmth and Urdu fluency. Triage is not its job.
            </p>
          </div>
          <div className="rules">
            <div className="rules__h">Escalates immediately</div>
            <ul>
              <li>Blood sugar below 70 mg/dL — hypoglycaemia</li>
              <li>Above 250 with vomiting, abdominal pain or rapid breathing — possible DKA</li>
              <li>Above 300 mg/dL</li>
              <li>Chest pain, one-sided weakness, slurred speech, sudden vision loss</li>
              <li>Foot wounds, ulcers or spreading redness</li>
              <li>Any abnormal reading in pregnancy</li>
            </ul>
            <div className="rules__h">Will never</div>
            <ul>
              <li>Prescribe, change or suggest a dose</li>
              <li>Diagnose a condition</li>
              <li>Tell you to stop a medicine</li>
            </ul>
            <p className="fine">Emergency instructions play from pre-recorded audio so a network outage can never silence them. Every rule that fires is logged for audit.</p>
          </div>
        </div>
      </section>

      {/* ── Screens ──────────────────────────────────────────────────── */}
      <section className="section section--tint" id="screens">
        <div className="wrap">
          <span className="eyebrow">The app</span>
          <h2>For patients who prefer a screen.</h2>
          <p className="lead narrow">
            The same companion, the same memory, as an installable web app — one big button, right-to-left Urdu,
            and nothing to read that isn’t essential.
          </p>
          <div className="screens">
            <Shot src="/shots/talk.png" t="Hold and speak" d="One button. No menus, no typing, no forms." />
            <Shot src="/shots/memory.png" t="What I know about you" d="Every fact, with the sentence it was learned from — and what it still wants to ask." />
            <Shot src="/shots/timeline.png" t="Your record" d="Readings, meals, medicines and symptoms in one colour-coded history." />
          </div>
          <Link className="btn btn--outline" to="/app">Open the web app</Link>
        </div>
      </section>

      {/* ── Who it's for ─────────────────────────────────────────────── */}
      <section className="section" id="who">
        <div className="wrap">
          <span className="eyebrow">Who it is for</span>
          <h2>Three people, one thread of care.</h2>
          <div className="who">
            <Who
              icon="🧕"
              t="The patient"
              d="Speaks Urdu, may not read well, sees a doctor rarely. Gets spoken guidance grounded in their own history, and is told plainly when something needs a doctor today."
            />
            <Who
              icon="👨"
              t="The family member"
              d="Usually the one who notices something is wrong. Gets an alert the moment a dangerous reading is logged, with the patient's own words and a one-tap way to reach them."
            />
            <Who
              icon="🩺"
              t="The clinician"
              d="Sees a structured English summary instead of a vague history: time-in-range, morning trends, adherence, and which foods precede spikes — in the minutes an appointment actually lasts."
            />
          </div>
        </div>
      </section>

      {/* ── Caregivers ───────────────────────────────────────────────── */}
      <section className="section" id="caregivers">
        <div className="wrap two">
          <div className="prose">
            <span className="eyebrow">For families and clinics</span>
            <h2>A dashboard that lights up when it matters.</h2>
            <p>
              Diabetes in Pakistan is managed by families. A son in Karachi, a daughter-in-law in the next room.
              The caregiver dashboard shows every patient at a glance — last reading, open follow-ups, and emergency
              alerts pushed live the moment a rule fires — with one-tap WhatsApp and a direct line to 1122.
            </p>
            <p>
              Clinicians see the clinical picture in English: 7-day mean, time-in-range, dawn-phenomenon flags,
              adherence, and the exact words the patient used.
            </p>
            <Link className="btn btn--outline" to="/care">Open the caregiver dashboard</Link>
          </div>
          <DashMock />
        </div>
      </section>

      {/* ── Technology ───────────────────────────────────────────────── */}
      <section className="section section--tint" id="technology">
        <div className="wrap">
          <span className="eyebrow">Technology</span>
          <h2>Built on Alibaba Cloud Model Studio, with the right tool for each job.</h2>
          <div className="arch">
            <ArchBox t="WhatsApp · Web" d="Voice note in, voice note out" />
            <Arrow />
            <ArchBox t="Groq Whisper" d="Urdu speech → text" />
            <Arrow />
            <ArchBox t="Qwen (Alibaba Cloud)" d="Clinical extraction · memory-grounded replies · embeddings" hi />
            <Arrow />
            <ArchBox t="Rules engine" d="Deterministic triage" />
            <Arrow />
            <ArchBox t="Azure ur-PK voice" d="Native Pakistani Urdu speech" />
          </div>
          <div className="tech">
            <TechItem t="Qwen on Alibaba Cloud" d="qwen-plus-character for reasoning and extraction; qwen3.7-text-embedding for memory recall and grounding." />
            <TechItem t="PostgreSQL + pgvector" d="Every utterance embedded and searchable; profile facts versioned with provenance." />
            <TechItem t="Curated knowledge base" d="ADA self-management essentials, IDF-DAR Ramzan guidance, Pakistani foods and locally available medicines." />
            <TechItem t="Open source · MIT" d="Self-hostable with Docker. Keys never leave the server; nothing is sent to the browser but audio and text." />
          </div>
          <p className="fine">
            An honest note: no Alibaba speech model supports Urdu today. We tested the realtime voice model with native
            listeners and it was not intelligible, so speech runs on providers with genuine Pakistani Urdu support while
            Qwen powers everything that makes this a memory agent.
          </p>
        </div>
      </section>

      {/* ── Privacy ──────────────────────────────────────────────────── */}
      <section className="section" id="privacy">
        <div className="wrap two">
          <div>
            <span className="eyebrow">Privacy</span>
            <h2>Health data deserves more care than most apps give it.</h2>
            <p className="lead">
              People tell this system things they have not told their doctor. That is only reasonable if the data is
              treated properly, so here is exactly what happens to it.
            </p>
          </div>
          <div className="prose">
            <ul className="ticks">
              <li>Stored on a single server the project controls, in Pakistan-accessible infrastructure — not sold, not shared with advertisers, not used to train any model.</li>
              <li>Seen only by the patient and the one family contact they name for emergencies.</li>
              <li>Provider keys never reach the browser or the phone; the app talks only to our server.</li>
              <li>Conversations are kept because the memory is the product — a companion that forgets is just a chatbot. A patient can ask for their record to be deleted at any time.</li>
              <li>The source code is open, so these claims can be checked rather than trusted.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── WhatsApp CTA ─────────────────────────────────────────────── */}
      <section className="section wa" id="whatsapp">
        <div className="wrap wa__grid">
          <div>
            <span className="eyebrow">Get started</span>
            <h2>Save the number. Send a voice note.</h2>
            <p className="lead">
              That is the whole onboarding. Say “Salam” to begin, then tell it your sugar reading or how you feel —
              in Urdu, the way you would tell a family member.
            </p>
            {wa.number ? (
              <>
                <div className="wa__num">{wa.number}</div>
                <a className="btn btn--primary btn--lg" href={waHref} target="_blank" rel="noreferrer"><WaIcon /> Open in WhatsApp</a>
              </>
            ) : (
              <>
                <div className="wa__num wa__num--soon">WhatsApp number launching soon</div>
                <Link className="btn btn--primary btn--lg" to="/app">Use the web version now</Link>
              </>
            )}
          </div>
          <div className="wa__qr">
            {wa.number ? (
              <img alt="Scan to open WhatsApp" src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`https://wa.me/${wa.number.replace(/\D/g, '')}?text=${WA_TEXT}`)}`} />
            ) : <div className="wa__qr-ph">QR</div>}
            <span className="fine">Scan with your phone camera</span>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="section" id="faq">
        <div className="wrap narrow">
          <span className="eyebrow">Questions</span>
          <h2>Frequently asked</h2>
          <Faq q="Is SehatSaathi a doctor?" a="No. It supports self-management between doctor visits. It does not diagnose or prescribe, and it will tell you to see a doctor — or call 1122 — when the rules say so." />
          <Faq q="What does it cost?" a="Nothing for patients. WhatsApp messages and voice notes are free over data; the service runs on free-tier cloud quotas at current scale." />
          <Faq q="Which languages?" a="Urdu, including the everyday mix of Urdu and English that Pakistani speakers actually use. Punjabi, Sindhi and Pashto are on the roadmap." />
          <Faq q="Who can see my information?" a="You, and only the family contact you name for emergencies. Data is stored on a server we control, never sold, and never used to train models." />
          <Faq q="Does it work on a basic phone?" a="Any phone that runs WhatsApp. No app to install, nothing to read. The web version needs a modern browser with a microphone." />
          <Faq q="Can a clinic use it?" a="Yes — the caregiver dashboard gives clinics a live view across patients, with alerts, trends and audit trails. Get in touch." />
        </div>
      </section>
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function Stat({ n, l }: { n: string; l: string }) {
  return <div className="stat"><div className="stat__n">{n}</div><div className="stat__l">{l}</div></div>;
}

/** Play button + the words, so the clip is understandable without sound too. */
function Clip({ src, label, ur, en, danger }: { src: string; label: string; ur: string; en: string; danger?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); el.currentTime = 0; setPlaying(false); return; }
    // Only one clip at a time.
    document.querySelectorAll('audio').forEach((a) => { a.pause(); a.currentTime = 0; });
    void el.play();
    setPlaying(true);
  };
  return (
    <div className={`clip ${danger ? 'clip--danger' : ''}`}>
      <button className="clip__btn" onClick={toggle} aria-label={`play ${label}`}>{playing ? '■' : '▶'}</button>
      <div className="clip__body">
        <div className="clip__label">{label}</div>
        <div className="clip__ur" dir="rtl" lang="ur">{ur}</div>
        <div className="clip__en">{en}</div>
      </div>
      <audio ref={audio} src={src} preload="none" onEnded={() => setPlaying(false)} />
    </div>
  );
}

function Shot({ src, t, d }: { src: string; t: string; d: string }) {
  return (
    <figure className="shot">
      <img src={src} alt={t} loading="lazy" width="400" height="860" />
      <figcaption><b>{t}</b><span>{d}</span></figcaption>
    </figure>
  );
}

function Who({ icon, t, d }: { icon: string; t: string; d: string }) {
  return <div className="whocard"><div className="whocard__i">{icon}</div><h3>{t}</h3><p>{d}</p></div>;
}
function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return <div className="step"><div className="step__n">{n}</div><h3>{t}</h3><p>{d}</p></div>;
}
function Tier({ icon, t, d }: { icon: string; t: string; d: string }) {
  return <div className="tier"><div className="tier__i">{icon}</div><h3>{t}</h3><p>{d}</p></div>;
}
function Bubble({ who, ur, en }: { who: 'patient' | 'agent'; ur: string; en: string }) {
  return (
    <div className={`db db--${who}`}>
      <div className="db__ur" dir="rtl" lang="ur">{ur}</div>
      <div className="db__en">{en}</div>
    </div>
  );
}
function ArchBox({ t, d, hi }: { t: string; d: string; hi?: boolean }) {
  return <div className={`arch__box ${hi ? 'arch__box--hi' : ''}`}><b>{t}</b><span>{d}</span></div>;
}
function Arrow() { return <div className="arch__arrow" aria-hidden>→</div>; }
function TechItem({ t, d }: { t: string; d: string }) {
  return <div className="techitem"><h3>{t}</h3><p>{d}</p></div>;
}
function Faq({ q, a }: { q: string; a: string }) {
  return <details className="faq"><summary>{q}</summary><p>{a}</p></details>;
}
export function WaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.5 1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4l-.5-.5zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
    </svg>
  );
}

/** A WhatsApp conversation, drawn in CSS. */
function PhoneMock() {
  return (
    <div className="phone" aria-hidden>
      <div className="phone__bar"><span className="phone__av">ص</span><div><b>SehatSaathi</b><small>online</small></div></div>
      <div className="phone__chat">
        <div className="wb wb--out"><VoiceNote len="0:07" /><span className="wb__cap" dir="rtl">آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں</span></div>
        <div className="wb wb--in"><span className="wb__t" dir="rtl">آپ نے بتایا شوگر 250۔ یہ زیادہ ہے۔ پانی پیئیں، تھوڑی چہل قدمی کریں اور چکر ٹھیک نہ ہوں تو بلال کو بتائیں۔</span></div>
        <div className="wb wb--in"><VoiceNote len="0:11" mine={false} /></div>
        <div className="wb wb--in wb--later"><span className="wb__t" dir="rtl">پچھلے ہفتے آپ نے بتایا تھا کہ پاؤں سن ہو رہا ہے — اب کیسا ہے؟</span><small>3 days later</small></div>
      </div>
    </div>
  );
}
function VoiceNote({ len, mine = true }: { len: string; mine?: boolean }) {
  return (
    <div className={`vn ${mine ? '' : 'vn--in'}`}>
      <span className="vn__play">▶</span>
      <span className="vn__wave">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 7) % 14)}px` }} />)}</span>
      <span className="vn__len">{len}</span>
    </div>
  );
}

/** Caregiver dashboard, in miniature. */
function DashMock() {
  return (
    <div className="dash" aria-hidden>
      <div className="dash__red">🚨 1 unacknowledged emergency alert</div>
      <div className="dash__pt"><span dir="rtl">راشدہ بی بی</span><span>55 mg/dL · now</span><span className="dash__tag dash__tag--red">1 red</span></div>
      <div className="dash__pt"><span dir="rtl">محمد اسلم</span><span>142 mg/dL · 1d</span><span className="dash__tag">2 follow-ups</span></div>
      <div className="dash__alert">
        <b>RED · Hypoglycaemia</b>
        <span>Blood glucose below 70 mg/dL. Patient instructed on the 15-15 rule.</span>
        <span className="dash__btns"><i>Acknowledge</i><i className="wa">WhatsApp family</i><i className="red">Call 1122</i></span>
      </div>
    </div>
  );
}
