import { useState, type FormEvent } from 'react';
import { api } from '../auth.ts';
import { Icon } from '../ui/Icon.tsx';

export interface Lab { id: string; kind: 'hba1c' | 'egfr' | 'creatinine' | 'ldl'; value: number; taken_on: string; note: string | null; entered_by_name: string | null }
type L = 'en' | 'ur';

export const LAB: Record<Lab['kind'], { en: string; ur: string; unit: string; target: string; ok: (v: number) => boolean }> = {
  hba1c: { en: 'HbA1c', ur: 'HbA1c (تین مہینے کی شوگر)', unit: '%', target: '< 7%', ok: (v) => v < 7 },
  egfr: { en: 'eGFR (kidneys)', ur: 'eGFR (گردے)', unit: 'mL/min', target: '≥ 60', ok: (v) => v >= 60 },
  creatinine: { en: 'Creatinine', ur: 'کریٹینین', unit: 'mg/dL', target: '0.6–1.2', ok: (v) => v >= 0.5 && v <= 1.3 },
  ldl: { en: 'LDL cholesterol', ur: 'ایل ڈی ایل کولیسٹرول', unit: 'mg/dL', target: '< 100', ok: (v) => v < 100 },
};

const day = (iso: string, lang: L) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ur-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The most recent lab HbA1c, if it is recent enough (4 months) to stand in for the estimate. */
export function recentA1c(labs: Lab[] | undefined): Lab | null {
  const a = labs?.find((l) => l.kind === 'hba1c');
  return a && Date.now() - new Date(a.taken_on).getTime() < 120 * 86_400_000 ? a : null;
}

export function LabsPanel({ labs, canAdd, patientId, onAdded, lang = 'en' }: {
  labs: Lab[]; canAdd: boolean; patientId: string; onAdded: () => void; lang?: L;
}) {
  const en = lang === 'en';
  const latest = (Object.keys(LAB) as Lab['kind'][]).map((k) => labs.find((l) => l.kind === k)).filter((l): l is Lab => !!l);
  const a1cHistory = labs.filter((l) => l.kind === 'hba1c').slice(0, 6);
  return (
    <div className="labs">
      {latest.length === 0 && <p className="muted">{en ? 'No lab results yet.' : 'ابھی کوئی لیب رپورٹ نہیں۔'}</p>}
      <div className="labs__grid">
        {latest.map((l) => {
          const spec = LAB[l.kind];
          return (
            <div key={l.id} className={`lab ${spec.ok(l.value) ? 'lab--ok' : 'lab--off'}`}>
              <span className="lab__k">{en ? spec.en : spec.ur}</span>
              <span className="lab__v" dir="ltr">{l.value}<small>{spec.unit === '%' ? '%' : ` ${spec.unit}`}</small></span>
              <span className="lab__s" dir="ltr">{day(l.taken_on, lang)} · {en ? 'target' : 'ہدف'} {spec.target}</span>
            </div>
          );
        })}
      </div>
      {a1cHistory.length > 1 && (
        <div className="lab-hist" dir="ltr">
          <span className="muted small">HbA1c:</span>
          {[...a1cHistory].reverse().map((l, i, arr) => (
            <span key={l.id} className="lab-hist__p">{l.value}%<small>{day(l.taken_on, 'en')}</small>{i < arr.length - 1 && <b aria-hidden>→</b>}</span>
          ))}
        </div>
      )}
      {canAdd && <AddLab patientId={patientId} onAdded={onAdded} lang={lang} />}
    </div>
  );
}

function AddLab({ patientId, onAdded, lang }: { patientId: string; onAdded: () => void; lang: L }) {
  const en = lang === 'en';
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Lab['kind']>('hba1c');
  const [value, setValue] = useState('');
  const [takenOn, setTakenOn] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn btn--sm btn--soft" onClick={() => setOpen(true)}><Icon name="flask" size={16} /> {en ? 'Add a lab result' : 'لیب رپورٹ شامل کریں'}</button>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api.post(`/api/portal/patients/${patientId}/labs`, { kind, value: Number(value), takenOn }); setValue(''); setOpen(false); onAdded(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="assign" onSubmit={submit}>
      <div className="seg seg--wrap" role="radiogroup" aria-label={en ? 'Test' : 'ٹیسٹ'}>
        {(Object.keys(LAB) as Lab['kind'][]).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{LAB[k].en}</button>
        ))}
      </div>
      <div className="field-row">
        <label className="field"><span>{en ? 'Result' : 'نتیجہ'} ({LAB[kind].unit})</span><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required placeholder={kind === 'hba1c' ? '7.4' : ''} dir="ltr" /></label>
        <label className="field"><span>{en ? 'Test date' : 'ٹیسٹ کی تاریخ'}</span><input type="date" value={takenOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setTakenOn(e.target.value)} required dir="ltr" /></label>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row-btns">
        <button className="btn btn--primary btn--sm" disabled={busy || !value}>{busy ? '…' : en ? 'Save result' : 'محفوظ کریں'}</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>{en ? 'Cancel' : 'منسوخ'}</button>
      </div>
    </form>
  );
}
