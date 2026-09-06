import { useEffect, useState } from 'react';
import { get, fmtDate, fmtTime } from '../api.ts';

interface Reading { id: string; mg_dl: number; context: string | null; taken_at: string }
interface Meal { id: string; description_ur: string | null; items: string[] | null; eaten_at: string }
interface Symptom { id: string; code: string; reported_at: string }
interface Med { id: string; taken: boolean; occurred_at: string; name: string | null }
interface Data { readings: Reading[]; meals: Meal[]; symptoms: Symptom[]; meds: Med[] }

const CTX: Record<string, string> = {
  fasting: 'خالی پیٹ', pre_meal: 'کھانے سے پہلے', post_meal: 'کھانے کے بعد', random: 'عام', bedtime: 'سونے سے پہلے',
};
const SYM: Record<string, string> = {
  dizziness: 'چکر', foot_numbness: 'پاؤں سن', tingling: 'سوئیاں', nausea: 'متلی', vomiting: 'الٹی',
  fatigue: 'کمزوری', blurred_vision: 'نظر دھندلی', excessive_thirst: 'پیاس', frequent_urination: 'بار بار پیشاب',
  chest_pain: 'سینے میں درد', sweating: 'پسینہ', shakiness: 'کپکپی', confusion: 'الجھن', weight_loss: 'وزن کم',
};

const zone = (v: number) => (v < 70 ? 'low' : v <= 180 ? 'ok' : v <= 250 ? 'high' : 'vhigh');

function Chart({ readings }: { readings: Reading[] }) {
  const pts = [...readings].reverse().filter((r) => Date.now() - new Date(r.taken_at).getTime() < 15 * 86_400_000);
  if (pts.length < 2) return <div className="chart chart--empty">ابھی کافی ریڈنگز نہیں</div>;
  const W = 340, H = 150, P = 14;
  const t0 = new Date(pts[0]!.taken_at).getTime(), t1 = new Date(pts.at(-1)!.taken_at).getTime();
  const x = (t: string) => P + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v: number) => H - P - ((Math.min(320, Math.max(40, v)) - 40) / 280) * (H - 2 * P);
  const path = pts.map((r, i) => `${i ? 'L' : 'M'}${x(r.taken_at).toFixed(1)},${y(r.mg_dl).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="glucose chart">
      <rect x={P} y={y(180)} width={W - 2 * P} height={y(70) - y(180)} className="chart__band" />
      <line x1={P} x2={W - P} y1={y(70)} y2={y(70)} className="chart__line chart__line--lo" />
      <line x1={P} x2={W - P} y1={y(180)} y2={y(180)} className="chart__line chart__line--hi" />
      <path d={path} className="chart__path" />
      {pts.map((r) => (
        <circle key={r.id} cx={x(r.taken_at)} cy={y(r.mg_dl)} r="4" className={`dot dot--${zone(r.mg_dl)}`} />
      ))}
    </svg>
  );
}

export default function Timeline({ patientId }: { patientId: string }) {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { void get<Data>(`/api/patients/${patientId}/timeline`).then(setD); }, [patientId]);
  if (!d) return <div className="loading">لوڈ ہو رہا ہے…</div>;

  // Merge everything into one day-grouped feed.
  type Item = { at: string; kind: 'r' | 'm' | 's' | 'd'; node: React.ReactNode };
  const items: Item[] = [
    ...d.readings.map((r) => ({ at: r.taken_at, kind: 'r' as const, node: (
      <><span className={`pill pill--${zone(r.mg_dl)}`}>{r.mg_dl}</span> {CTX[r.context ?? ''] ?? ''}</>
    ) })),
    ...d.meals.map((m) => ({ at: m.eaten_at, kind: 'm' as const, node: <>🍽 {m.description_ur ?? (m.items ?? []).join('، ')}</> })),
    ...d.symptoms.map((s) => ({ at: s.reported_at, kind: 's' as const, node: <>🩺 {SYM[s.code] ?? s.code}</> })),
    ...d.meds.map((m) => ({ at: m.occurred_at, kind: 'd' as const, node: <>{m.taken ? '💊 دوا لی' : '❌ دوا رہ گئی'}{m.name ? ` — ${m.name}` : ''}</> })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const days = new Map<string, Item[]>();
  for (const it of items) {
    const k = fmtDate(it.at);
    days.set(k, [...(days.get(k) ?? []), it]);
  }

  return (
    <section className="screen">
      <h2>شوگر کا ریکارڈ</h2>
      <Chart readings={d.readings} />
      <div className="legend">
        <span><i className="dot dot--low" /> 70 سے کم</span>
        <span><i className="dot dot--ok" /> 70–180</span>
        <span><i className="dot dot--high" /> 180–250</span>
        <span><i className="dot dot--vhigh" /> 250 سے زیادہ</span>
      </div>
      {[...days.entries()].map(([day, list]) => (
        <div key={day} className="day">
          <div className="day__h">{day}</div>
          {list.map((it, i) => (
            <div key={i} className="row"><span className="row__t">{fmtTime(it.at)}</span><span>{it.node}</span></div>
          ))}
        </div>
      ))}
    </section>
  );
}
