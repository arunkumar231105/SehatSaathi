import { useEffect, useRef, useState } from 'react';
import { useVoice, type VoiceState } from '../voice/useVoice.ts';
import { t, dir, lang } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';

export default function Talk({ patientId, caregiverPhone }: { patientId: string; caregiverPhone?: string | null }) {
  const v = useVoice(patientId);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const holding = useRef(false);
  const s = t();

  const LABEL: Record<VoiceState, string> = {
    connecting: s.connecting,
    idle: s.holdToTalk,
    listening: s.listening,
    thinking: s.thinking,
    speaking: s.speaking,
    error: s.tryAgain,
  };

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
    `${s.urgent} ${v.findings[0]?.reasonUr ?? ''}`.trim(),
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    void v.sendText(text);
  };

  return (
    <section className="talk">
      {red && (
        <div className="emergency" role="alert" dir={dir()}>
          <div className="emergency__title">{s.urgent}</div>
          <p className="emergency__text">
            {lang() === 'en' ? v.findings[0]?.reasonEn : v.findings[0]?.reasonUr}
          </p>
          <a className="btn btn--danger" href="tel:1122">{s.call1122}</a>
          {caregiverPhone && (
            <a className="btn btn--wa" href={`https://wa.me/${caregiverPhone.replace(/\D/g, '')}?text=${waMsg}`} target="_blank" rel="noreferrer">
              {s.waFamily}
            </a>
          )}
          <button className="btn btn--ghost" onClick={v.dismissAlert}>{s.ok}</button>
        </div>
      )}

      <div className="transcript" ref={listRef} dir={dir()}>
        {v.turns.length === 0 && (
          <div className="hint">
            <div className="hint__av" aria-hidden>ص</div>
            <p className="hint__lead">{s.hintLead}</p>
            <p className="hint__ex">{s.hintExample}</p>
            <button className="btn btn--outline" onClick={v.greet}><Icon name="speaker" size={18} /> {s.listen.replace('🔊 ', '')}</button>
            <p className="hint__try">{s.tryOne}</p>
            <div className="chips">
              {s.examples.map((ex) => (
                <button key={ex} className="chip" onClick={() => void v.sendText(ex)} disabled={v.state === 'connecting'}>{ex}</button>
              ))}
            </div>
          </div>
        )}
        {v.turns.map((turn, i) => (
          <div key={i} className={`bubble bubble--${turn.role}`}>{turn.text}</div>
        ))}
        {v.state === 'thinking' && <div className="bubble bubble--agent bubble--typing" aria-label={s.thinking}><i /><i /><i /></div>}
        {v.severity === 'amber' && v.findings[0] && (
          <div className="amber" role="status"><Icon name="alert" size={18} /> {lang() === 'en' ? v.findings[0].reasonEn : v.findings[0].reasonUr}</div>
        )}
        {v.error && <div className="err" role="alert">{v.error === 'connection' ? s.connErr : `${s.error}: ${v.error}`}</div>}
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
          aria-label={LABEL[v.state]}
        >
          <span className="mic__icon">
            {v.state === 'speaking' ? <Icon name="speaker" size={38} /> : v.state === 'thinking' ? <span className="mic__dots"><i /><i /><i /></span> : <Icon name="mic" size={38} />}
          </span>
        </button>
        <div className={`mic__label mic__label--${v.state}`} aria-live="polite">{LABEL[v.state]}</div>

        <button className="link link--icon" onClick={() => setShowType((x) => !x)} aria-expanded={showType}>
          <Icon name={showType ? 'close' : 'keyboard'} size={16} /> {showType ? s.close : s.typeInstead}
        </button>
        {showType && (
          <form className="typebar" onSubmit={submit}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={s.typeHere}
              dir={dir()}
              autoFocus
            />
            <button className="btn btn--primary" type="submit" disabled={!typed.trim()} aria-label={s.send}><Icon name="send" size={18} /></button>
          </form>
        )}
        {!v.caps.tts && v.state !== 'connecting' && <div className="note">{s.noTts}</div>}
      </div>
    </section>
  );
}
