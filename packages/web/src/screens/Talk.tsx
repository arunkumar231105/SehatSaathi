import { useEffect, useRef, useState } from 'react';
import { useVoice, type VoiceState } from '../voice/useVoice.ts';

const LABEL: Record<VoiceState, string> = {
  connecting: 'جڑ رہا ہے…',
  idle: 'دبا کر رکھیں اور بولیں',
  listening: 'سن رہی ہوں…',
  thinking: 'سوچ رہی ہوں…',
  speaking: 'بول رہی ہوں…',
  error: 'دوبارہ کوشش کریں',
};

export default function Talk({ patientId, caregiverPhone }: { patientId: string; caregiverPhone?: string | null }) {
  const v = useVoice(patientId);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const holding = useRef(false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [v.turns.length]);

  const down = async (e: React.PointerEvent) => {
    e.preventDefault();
    if (v.state === 'connecting' || holding.current) return;
    holding.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    await v.pressStart();
  };
  const up = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!holding.current) return;
    holding.current = false;
    v.pressEnd();
  };

  const red = v.severity === 'red';
  const waMsg = encodeURIComponent(
    `⚠️ صحت ساتھی: ${v.findings[0]?.reasonUr ?? 'ہنگامی صورتحال'} — فوراً رابطہ کریں۔`,
  );

  return (
    <section className="talk">
      {red && (
        <div className="emergency" role="alert">
          <div className="emergency__title">⚠️ فوری توجہ</div>
          <p className="emergency__text">{v.findings[0]?.reasonUr}</p>
          <a className="btn btn--danger" href="tel:1122">📞 1122 پر کال کریں</a>
          {caregiverPhone && (
            <a className="btn btn--wa" href={`https://wa.me/${caregiverPhone.replace(/\D/g, '')}?text=${waMsg}`} target="_blank" rel="noreferrer">
              💬 گھر والوں کو واٹس ایپ کریں
            </a>
          )}
          <button className="btn btn--ghost" onClick={v.dismissAlert}>ٹھیک ہے</button>
        </div>
      )}

      <div className="transcript" ref={listRef}>
        {v.turns.length === 0 && (
          <div className="hint">
            <p>بٹن دبا کر رکھیں اور بتائیں:</p>
            <p className="hint__ex">«آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں»</p>
            <button className="btn btn--ghost" onClick={v.greet}>🔊 صحت ساتھی کو سنیں</button>
          </div>
        )}
        {v.turns.map((t, i) => (
          <div key={i} className={`bubble bubble--${t.role}`}>{t.text}</div>
        ))}
        {v.severity === 'amber' && v.findings[0] && (
          <div className="amber">⚠ {v.findings[0].reasonUr}</div>
        )}
        {v.error && <div className="err">خرابی: {v.error}</div>}
      </div>

      <div className="talk__controls">
        <button
          className={`mic mic--${v.state}`}
          onPointerDown={down}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={(e) => holding.current && up(e)}
          onContextMenu={(e) => e.preventDefault()}
          disabled={v.state === 'connecting'}
          aria-label="hold to talk"
        >
          <span className="mic__icon">{v.state === 'listening' ? '●' : v.state === 'speaking' ? '🔊' : v.state === 'thinking' ? '…' : '🎤'}</span>
        </button>
        <div className="mic__label">{LABEL[v.state]}</div>

        <button className="link" onClick={() => setShowType((s) => !s)}>
          {showType ? 'بند کریں' : 'لکھ کر بتائیں'}
        </button>
        {showType && (
          <form
            className="typebar"
            onSubmit={(e) => { e.preventDefault(); void v.sendText(typed); setTyped(''); }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="یہاں لکھیں…" dir="rtl" />
            <button className="btn" type="submit">بھیجیں</button>
          </form>
        )}
        {!v.caps.tts && v.state !== 'connecting' && (
          <div className="note">آواز فون کی اپنی ہے (سرور پر اردو آواز سیٹ نہیں)</div>
        )}
      </div>
    </section>
  );
}
