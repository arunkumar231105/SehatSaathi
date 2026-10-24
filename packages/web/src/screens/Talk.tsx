import { useEffect, useRef, useState } from 'react';
import { useVoice, type VoiceState } from '../voice/useVoice.ts';
import { t, dir, lang } from '../i18n.ts';
import { Icon } from '../ui/Icon.tsx';

export default function Talk({ patientId, caregiverPhone }: { patientId: string; caregiverPhone?: string | null }) {
  const v = useVoice(patientId);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const [photo, setPhoto] = useState<{ state: 'reading' } | { state: 'confirm'; display: string; text: string } | { state: 'failed' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  /** Shrink the photo before upload — a phone camera's 4000 px image is mostly wasted bytes on a 3G link. */
  const shrink = (file: File) => new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhoto({ state: 'reading' });
    try {
      const image = await shrink(file);
      const r = await fetch(`/api/patients/${patientId}/photo-reading`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, lang: lang() }),
      });
      const j = (await r.json()) as { readable?: boolean; display?: string | null; mgDl?: number; text?: string };
      if (!r.ok || !j.readable || !j.text) { setPhoto({ state: 'failed' }); return; }
      setPhoto({ state: 'confirm', display: j.display && /[a-z]/i.test(j.display) ? j.display : `${j.mgDl} mg/dL`, text: j.text });
    } catch { setPhoto({ state: 'failed' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

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
        {photo?.state === 'reading' && <div className="photo-card" role="status"><Icon name="drop" size={18} /> {s.photoReading}</div>}
        {photo?.state === 'failed' && <div className="photo-card photo-card--bad" role="alert">{s.photoFail}</div>}
        {photo?.state === 'confirm' && (
          <div className="photo-card" role="dialog" aria-label={s.photoBtn}>
            <p>{s.photoConfirm(photo.display)}</p>
            <div className="row-btns">
              <button className="btn btn--primary btn--sm" onClick={() => { const t2 = photo.text; setPhoto(null); void v.sendText(t2); }}><Icon name="check" size={16} /> {s.photoYes}</button>
              <button className="btn btn--ghost btn--sm" onClick={() => { setPhoto(null); setShowType(true); }}>{s.photoNo}</button>
            </div>
          </div>
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

        <div className="talk__alt">
          <button className="link link--icon" onClick={() => setShowType((x) => !x)} aria-expanded={showType}>
            <Icon name={showType ? 'close' : 'keyboard'} size={16} /> {showType ? s.close : s.typeInstead}
          </button>
          <button className="link link--icon" onClick={() => fileRef.current?.click()} disabled={photo?.state === 'reading'}>
            <Icon name="camera" size={16} /> {s.photoBtn}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>
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
