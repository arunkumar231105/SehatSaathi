import { Icon, type IconName } from '../ui/Icon.tsx';
import { api } from '../auth.ts';

export type Stage = 'in_target' | 'above_target' | 'high' | 'very_high' | 'not_enough_data';
export type Trend = 'improving' | 'stable' | 'worsening' | 'not_enough_data';
export interface Month { index: number; label: string; readings: number; mean: number | null; timeInRange: number | null; lows: number; veryHigh: number; fastingMean: number | null }
export interface Progress {
  months: Month[]; weekly: { weekStart: string; mean: number | null; readings: number }[];
  mean90: number | null; timeInRange90: number | null; estimatedA1c: number | null; stage: Stage; trend: Trend;
  meanChange: number | null; timeInRangeChange: number | null; totalReadings: number; summaryEn: string; summaryUr: string;
}
export interface Order {
  id: string; kind: 'medicine' | 'precaution' | 'appointment' | 'test'; title: string; detail: string | null;
  dose: string | null; schedule: string | null; due_at: string | null; status: 'active' | 'done' | 'cancelled';
  created_at: string; doctor_name: string;
}
export interface TeamMember { id: string; name: string; role: string; specialty: string | null; relation: 'doctor' | 'family'; label: string | null }

type L = 'en' | 'ur';

export const STAGE: Record<Stage, { en: string; ur: string; cls: string }> = {
  in_target: { en: 'In target', ur: 'ہدف کے اندر', cls: 'ok' },
  above_target: { en: 'Above target', ur: 'ہدف سے اوپر', cls: 'warn' },
  high: { en: 'High', ur: 'زیادہ', cls: 'high' },
  very_high: { en: 'Very high', ur: 'بہت زیادہ', cls: 'danger' },
  not_enough_data: { en: 'Not enough data', ur: 'ریڈنگز کم ہیں', cls: 'muted' },
};
export const TREND: Record<Trend, { en: string; ur: string; icon: string; cls: string }> = {
  improving: { en: 'Improving', ur: 'بہتر ہو رہی ہے', icon: '↓', cls: 'ok' },
  stable: { en: 'Stable', ur: 'ایک جیسی', icon: '→', cls: 'muted' },
  worsening: { en: 'Worsening', ur: 'خراب ہو رہی ہے', icon: '↑', cls: 'danger' },
  not_enough_data: { en: 'No trend yet', ur: 'ابھی رجحان نہیں', icon: '·', cls: 'muted' },
};

export function StageBadge({ stage, lang = 'en' }: { stage: Stage; lang?: L }) {
  return <span className={`badge badge--${STAGE[stage].cls}`}>{STAGE[stage][lang]}</span>;
}
export function TrendTag({ trend, lang = 'en' }: { trend: Trend; lang?: L }) {
  return <span className={`trend trend--${TREND[trend].cls}`}><b aria-hidden>{TREND[trend].icon}</b> {TREND[trend][lang]}</span>;
}

/** Weekly mean over 13 weeks, with the 70–180 band shaded. */
export function WeeklyChart({ weekly, lang = 'en' }: { weekly: Progress['weekly']; lang?: L }) {
  const W = 560, H = 190, PL = 34, PR = 10, PT = 12, PB = 26;
  const lo = 60, hi = 320;
  const x = (i: number) => PL + (i / (weekly.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - PT - PB);
  const pts = weekly.map((w, i) => (w.mean === null ? null : { i, v: w.mean }));
  const segs: string[] = [];
  let cur = '';
  for (const p of pts) {
    if (!p) { if (cur) segs.push(cur); cur = ''; continue; }
    cur += `${cur ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`;
  }
  if (cur) segs.push(cur);
  const label = (iso: string) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ur-PK', { day: 'numeric', month: 'short' });
  return (
    <svg className="wchart" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={lang === 'en' ? 'Weekly average sugar over 13 weeks' : '13 ہفتوں کی اوسط شوگر'}>
      <rect x={PL} y={y(180)} width={W - PL - PR} height={y(70) - y(180)} className="wchart__band" />
      {[70, 180, 250].map((v) => (
        <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="wchart__grid" /><text x={PL - 6} y={y(v) + 4} className="wchart__ax" textAnchor="end">{v}</text></g>
      ))}
      {segs.map((d, k) => <path key={k} d={d} className="wchart__line" />)}
      {pts.map((p) => p && <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="4" className={`wchart__dot ${p.v > 180 ? 'is-high' : p.v < 70 ? 'is-low' : ''}`}><title>{`${label(weekly[p.i]!.weekStart)}: ${p.v} mg/dL`}</title></circle>)}
      {[0, 4, 8, 12].map((i) => <text key={i} x={x(i)} y={H - 6} className="wchart__ax" textAnchor="middle">{label(weekly[i]!.weekStart)}</text>)}
    </svg>
  );
}

export function ProgressPanel({ p, lang = 'en', labA1c }: { p: Progress; lang?: L; labA1c?: { value: number; taken_on: string } | null }) {
  const en = lang === 'en';
  const MONTH_UR = ['پچھلے 30 دن', '31–60 دن پہلے', '61–90 دن پہلے'];
  return (
    <div className="prog">
      <p className="prog__sum">{en ? p.summaryEn : p.summaryUr}</p>
      <div className="kpis kpis--4">
        <div className="kpi"><span className="kpi__l">{en ? 'Stage' : 'حالت'}</span><span className="kpi__n kpi__n--sm"><StageBadge stage={p.stage} lang={lang} /></span></div>
        {labA1c
          ? <div className="kpi kpi--lab"><span className="kpi__l">{en ? 'HbA1c (lab)' : 'HbA1c (لیب)'}</span><span className="kpi__n">{labA1c.value}<small>%</small></span>
              <span className="kpi__s">{new Date(labA1c.taken_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}{p.estimatedA1c !== null ? ` · est. ${p.estimatedA1c}%` : ''}</span></div>
          : <div className="kpi"><span className="kpi__l">{en ? 'Est. HbA1c' : 'اندازاً HbA1c'}</span><span className="kpi__n">{p.estimatedA1c ?? '—'}{p.estimatedA1c !== null && <small>%</small>}</span><span className="kpi__s">GMI</span></div>}
        <div className="kpi"><span className="kpi__l">{en ? 'Time in range' : 'ٹھیک حد میں'}</span><span className="kpi__n">{p.timeInRange90 ?? '—'}{p.timeInRange90 !== null && <small>%</small>}</span><span className="kpi__s">90 {en ? 'days' : 'دن'}</span></div>
        <div className="kpi"><span className="kpi__l">{en ? 'Trend' : 'رجحان'}</span><span className="kpi__n kpi__n--sm"><TrendTag trend={p.trend} lang={lang} /></span>
          {p.meanChange !== null && <span className="kpi__s">{p.meanChange > 0 ? '+' : ''}{p.meanChange} mg/dL {en ? 'vs last month' : 'پچھلے مہینے سے'}</span>}</div>
      </div>
      <div className="chart-card"><WeeklyChart weekly={p.weekly} lang={lang} /></div>
      <div className="months">
        {p.months.map((m) => (
          <div key={m.index} className="month">
            <div className="month__h">{en ? m.label : MONTH_UR[m.index]}</div>
            <div className="month__n" dir="ltr">{m.mean ?? '—'}<small> mg/dL</small></div>
            <div className="month__s" dir="ltr">
              {m.readings} {en ? 'readings' : 'ریڈنگز'} · {m.timeInRange ?? '—'}% {en ? 'in range' : 'حد میں'}
              {m.lows > 0 && <span className="tag tag--red">{m.lows} {en ? 'low' : 'کم'}</span>}
            </div>
          </div>
        ))}
      </div>
      {p.estimatedA1c !== null && (
        <p className="fine">{en
          ? 'Estimated HbA1c uses the Glucose Management Indicator (Bergenstal 2018) on fingerstick readings — a guide, not a lab result.'
          : 'اندازاً HbA1c انگلی کی ریڈنگز سے نکالا گیا ہے — یہ لیب ٹیسٹ نہیں، صرف اندازہ ہے۔'}</p>
      )}
    </div>
  );
}

const KIND_ICON: Record<Order['kind'], IconName> = { medicine: 'pill', precaution: 'shield', appointment: 'clock', test: 'drop' };
const KIND_LABEL: Record<Order['kind'], { en: string; ur: string }> = {
  medicine: { en: 'Medicine', ur: 'دوا' }, precaution: { en: 'Instruction', ur: 'ہدایت' },
  appointment: { en: 'Appointment', ur: 'ملاقات' }, test: { en: 'Test', ur: 'ٹیسٹ' },
};

export const when = (iso: string, lang: L = 'en') =>
  new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ur-PK', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function OrdersList({ orders, lang = 'en', canCancel, patientCanTick, onChange }: {
  orders: Order[]; lang?: L; canCancel?: boolean; patientCanTick?: boolean; onChange?: () => void;
}) {
  const en = lang === 'en';
  const active = orders.filter((o) => o.status === 'active');
  if (!active.length) return <p className="muted">{en ? 'Nothing assigned yet.' : 'ابھی ڈاکٹر نے کچھ نہیں دیا۔'}</p>;
  const set = (id: string, status: 'done' | 'cancelled') => api.patch(`/api/portal/orders/${id}`, { status }).then(() => onChange?.());
  return (
    <ul className="orders">
      {active.map((o) => {
        const past = o.due_at && new Date(o.due_at).getTime() < Date.now();
        return (
          <li key={o.id} className={`order order--${o.kind}`}>
            <span className="order__i"><Icon name={KIND_ICON[o.kind]} size={18} /></span>
            <div className="order__b">
              <div className="order__k">{KIND_LABEL[o.kind][lang]} · <span dir="ltr">{o.doctor_name}</span></div>
              <div className="order__t" dir="auto">{[o.title, o.dose, o.schedule].filter(Boolean).join(' · ')}</div>
              {o.due_at && <div className={`order__when ${past ? 'is-past' : ''}`}><Icon name="clock" size={14} /> {when(o.due_at, lang)}</div>}
              {o.detail && <div className="order__d" dir="auto">{o.detail}</div>}
            </div>
            <div className="order__a">
              {patientCanTick && o.kind !== 'medicine' && <button className="btn btn--sm btn--soft" onClick={() => set(o.id, 'done')}><Icon name="check" size={14} /> {en ? 'Done' : 'ہو گیا'}</button>}
              {canCancel && <button className="btn btn--sm btn--ghost" onClick={() => set(o.id, o.kind === 'medicine' ? 'cancelled' : 'done')}>{o.kind === 'medicine' ? 'Stop' : 'Close'}</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TeamList({ team, lang = 'en', onRemove }: { team: TeamMember[]; lang?: L; onRemove?: (id: string) => void }) {
  const en = lang === 'en';
  if (!team.length) return <p className="muted">{en ? 'No one is connected yet.' : 'ابھی کوئی جڑا نہیں۔'}</p>;
  return (
    <ul className="team">
      {team.map((m) => (
        <li key={m.id}>
          <span className={`team__av team__av--${m.relation}`}><Icon name={m.relation === 'doctor' ? 'stethoscope' : 'user'} size={16} /></span>
          <span className="team__b"><b dir="auto">{m.name}</b><small dir="auto">{m.relation === 'doctor' ? (m.specialty ?? (en ? 'Doctor' : 'ڈاکٹر')) : (m.label ?? (en ? 'Family' : 'گھر والے'))}</small></span>
          {onRemove && <button className="link" onClick={() => onRemove(m.id)}>{en ? 'Remove' : 'ہٹائیں'}</button>}
        </li>
      ))}
    </ul>
  );
}
