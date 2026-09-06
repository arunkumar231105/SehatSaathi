import { useEffect, useState } from 'react';

type CheckState = 'pending' | 'pass' | 'fail';
interface Check { id: string; labelUr: string; labelEn: string; state: CheckState; detail?: string }

const INITIAL: Check[] = [
  { id: 'https', labelUr: 'محفوظ کنکشن', labelEn: 'Secure context (HTTPS)', state: 'pending' },
  { id: 'mic', labelUr: 'مائیکروفون', labelEn: 'Microphone permission', state: 'pending' },
  { id: 'api', labelUr: 'سرور', labelEn: 'API reachable', state: 'pending' },
  { id: 'model', labelUr: 'ماڈل سٹوڈیو', labelEn: 'Qwen / Model Studio', state: 'pending' },
  { id: 'asr', labelUr: 'سننا', labelEn: 'Urdu speech recognition (Groq)', state: 'pending' },
  { id: 'tts', labelUr: 'بولنا', labelEn: 'Urdu voice (Azure ur-PK)', state: 'pending' },
  { id: 'wa', labelUr: 'واٹس ایپ', labelEn: 'WhatsApp bot', state: 'pending' },
];

/** Deploy diagnostics — kept at #/preflight for whatever phone a judge opens. */
export default function Preflight() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const set = (id: string, state: CheckState, detail?: string) =>
    setChecks((cs) => cs.map((c) => (c.id === id ? { ...c, state, detail } : c)));

  useEffect(() => {
    set('https', window.isSecureContext ? 'pass' : 'fail', window.isSecureContext ? window.location.origin : 'getUserMedia will be blocked');
    fetch('/api/health')
      .then(async (r) => {
        const b = (await r.json()) as { db?: boolean; modelStudio?: boolean; asr?: boolean; tts?: boolean; whatsapp?: boolean };
        set('api', r.ok ? 'pass' : 'fail');
        set('model', b.modelStudio ? 'pass' : 'fail');
        set('asr', b.asr ? 'pass' : 'fail', b.asr ? undefined : 'GROQ_API_KEY not set');
        set('tts', b.tts ? 'pass' : 'fail', b.tts ? undefined : 'AZURE_SPEECH_KEY not set — browser voice fallback');
        set('wa', b.whatsapp ? 'pass' : 'fail', b.whatsapp ? undefined : 'not configured');
      })
      .catch((e: Error) => { set('api', 'fail', e.message); });
  }, []);

  async function testMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rate = new AudioContext().sampleRate;
      s.getTracks().forEach((t) => t.stop());
      set('mic', 'pass', `${rate} Hz capture`);
    } catch (e) { set('mic', 'fail', (e as Error).message); }
  }

  const icon = (s: CheckState) => (s === 'pass' ? '✓' : s === 'fail' ? '✕' : '…');
  return (
    <section className="screen preflight">
      <h2>Preflight</h2>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.id} data-state={c.state}>
            <span className="icon">{icon(c.state)}</span>
            <span className="label"><strong>{c.labelUr}</strong><em>{c.labelEn}</em>{c.detail && <code>{c.detail}</code>}</span>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={testMic}>مائیکروفون ٹیسٹ · Test microphone</button>
    </section>
  );
}
