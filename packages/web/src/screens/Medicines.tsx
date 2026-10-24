import { useEffect, useState } from 'react';
import { get, getLang } from '../api.ts';
import { t as tr, lang } from '../i18n.ts';
import { Icon, Skeleton } from '../ui/Icon.tsx';

interface Card {
  asNamed: string; generic: string; brands: string[]; causesLows: boolean;
  purpose: string; take: string; sideEffects: string; missedDose: string; warning: string;
  sources: { title: string; url: string }[];
}
interface Check { id: string; urgency: 'today' | 'review'; patientEn: string; patientUr: string }
/** "Metformin (Glucophage) 500mg twice daily" -> "Metformin (Glucophage)". */
const shortName = (entry: string) => entry.split(/\s+\d/)[0]!.trim() || entry;

interface Data { cards: Card[]; unknown: string[]; checks: Check[]; questions: { en: string; ur: string }[] }

/**
 * The patient's own medicines, explained from a sourced reference, plus the
 * list of things to raise at the next appointment. Explains — never advises
 * starting, stopping or changing anything.
 */
export default function Medicines({ patientId }: { patientId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const s = tr();
  const en = lang() === 'en';

  useEffect(() => {
    setD(null); setFailed(false);
    get<Data>(`/api/patients/${patientId}/medicines?lang=${getLang()}`).then(setD).catch(() => setFailed(true));
  }, [patientId]);

  if (failed) return <section className="screen"><div className="err" role="alert">{s.connErr}</div></section>;
  if (!d) return <section className="screen"><Skeleton /></section>;

  const today = d.checks.filter((c) => c.urgency === 'today');
  // One card per thing the patient takes; a combination tablet carries two medicines.
  const groups = [...d.cards.reduce((m, c) => m.set(c.asNamed, [...(m.get(c.asNamed) ?? []), c]), new Map<string, Card[]>())];
  const listText = [s.medsDoctorTitle, ...d.questions.map((q, i) => `${i + 1}. ${en ? q.en : q.ur}`)].join('\n');
  const speak = () => {
    const a = new Audio(`/api/tts?lang=${getLang()}&text=${encodeURIComponent(listText.slice(0, 1500))}`);
    void a.play().catch(() => undefined);
  };

  return (
    <section className="screen">
      <header className="screen__head">
        <h2>{s.medsTitle}</h2>
        <p className="muted">{s.medsSub}</p>
      </header>

      {today.map((c) => (
        <div key={c.id} className="card card--concern" role="alert">
          <div className="card__h"><Icon name="alert" size={18} /> {s.medsCheckToday}</div>
          <p className="medcheck">{en ? c.patientEn : c.patientUr}</p>
        </div>
      ))}

      {d.cards.length === 0 && d.unknown.length === 0 && (
        <div className="card">{s.medsNone}</div>
      )}

      <div className="meds">
        {groups.map(([asNamed, parts], i) => (
          <details key={asNamed} className="med" open={i === 0}>
            <summary>
              <span className="med__i"><Icon name={parts.some((c) => /insulin/i.test(c.generic)) ? 'drop' : 'pill'} size={20} /></span>
              <span className="med__name">
                <b dir="ltr">{shortName(asNamed)}</b>
                <small dir="ltr">
                  {parts.map((c) => c.generic).join(' + ')}
                  {parts.some((c) => c.causesLows) && <span className="tag tag--symptom">{s.medsCanLow}</span>}
                </small>
                {shortName(asNamed) !== asNamed && <small dir="ltr" className="med__as">{asNamed}</small>}
              </span>
            </summary>
            {parts.map((c) => (
              <div key={c.generic}>
                {/* A combination tablet explains each medicine inside it. */}
                {parts.length > 1 && <h3 className="med__part" dir="ltr">{c.generic}</h3>}
                <dl className="med__dl">
                  <div><dt>{s.medsFor}</dt><dd>{c.purpose}</dd></div>
                  <div><dt>{s.medsHow}</dt><dd>{c.take}</dd></div>
                  <div><dt>{s.medsSide}</dt><dd>{c.sideEffects}</dd></div>
                  <div><dt>{s.medsMissedDose}</dt><dd>{c.missedDose}</dd></div>
                  <div className="med__warn"><dt><Icon name="alert" size={14} /> {s.medsWatch}</dt><dd>{c.warning}</dd></div>
                </dl>
                <p className="med__src" dir="ltr">
                  {s.medsSource}{' '}
                  {c.sources.map((src, j) => <a key={j} href={src.url} target="_blank" rel="noreferrer">{src.title}</a>)}
                </p>
              </div>
            ))}
          </details>
        ))}
        {d.unknown.map((u) => (
          <div key={u} className="med med--unknown">
            <span className="med__i"><Icon name="pill" size={20} /></span>
            <span className="med__name"><b dir="ltr">{u}</b><small>{s.medsUnknown}</small></span>
          </div>
        ))}
      </div>

      <div className="card doctor">
        <div className="card__h"><Icon name="stethoscope" size={18} /> {s.medsDoctorTitle}</div>
        <ol className="doctor__list">
          {d.questions.map((q, i) => <li key={i}>{en ? q.en : q.ur}</li>)}
        </ol>
        <div className="row-btns">
          <button className="btn btn--primary" onClick={speak}><Icon name="speaker" size={18} /> {s.medsListen}</button>
          <a className="btn btn--wa" href={`https://wa.me/?text=${encodeURIComponent(listText)}`} target="_blank" rel="noreferrer">
            <Icon name="message" size={18} /> {s.medsShare}
          </a>
        </div>
      </div>

      <p className="fine disclaimer"><Icon name="shield" size={16} />{' '}{s.medsDisclaimer}</p>
    </section>
  );
}
