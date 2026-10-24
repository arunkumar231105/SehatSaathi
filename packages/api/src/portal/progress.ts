/**
 * Three-month progress, from the readings the patient has reported.
 *
 * Deterministic and pure (no database) so it can be tested and so a doctor
 * sees the same verdict for the same data every time.
 *
 * The HbA1c figure is the Glucose Management Indicator, GMI(%) =
 * 3.31 + 0.02392 × mean glucose (mg/dL) — Bergenstal et al., Diabetes Care
 * 2018;41:2275. It was derived from continuous monitoring; fingerstick
 * readings are sparser and biased toward the times people check, so it is
 * shown as an estimate, only with enough readings, and never as a lab value.
 */

export interface ProgressReading { mg_dl: number; taken_at: string | Date; context?: string | null }

export interface MonthStats {
  /** 0 = the most recent 30 days, 1 = 31–60 days ago, 2 = 61–90 days ago. */
  index: number;
  label: string;
  readings: number;
  mean: number | null;
  timeInRange: number | null;
  lows: number;
  veryHigh: number;
  fastingMean: number | null;
}

export type Stage = 'in_target' | 'above_target' | 'high' | 'very_high' | 'not_enough_data';
export type Trend = 'improving' | 'stable' | 'worsening' | 'not_enough_data';

export interface Progress {
  months: MonthStats[];
  /** 13 weekly means, oldest first, for the chart. null where no readings. */
  weekly: { weekStart: string; mean: number | null; readings: number }[];
  mean90: number | null;
  timeInRange90: number | null;
  estimatedA1c: number | null;
  stage: Stage;
  trend: Trend;
  /** Change in mean, last 30 days vs the 30 before (negative is better). */
  meanChange: number | null;
  timeInRangeChange: number | null;
  totalReadings: number;
  summaryEn: string;
  summaryUr: string;
}

const DAY = 86_400_000;
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const tir = (xs: number[]) => (xs.length ? round((100 * xs.filter((x) => x >= 70 && x <= 180).length) / xs.length) : null);

/** GMI needs a spread of readings to mean anything. */
const MIN_FOR_A1C = 14;
/** And a trend needs enough in both months being compared. */
const MIN_FOR_TREND = 5;

export function gmi(meanMgDl: number): number {
  return round(3.31 + 0.02392 * meanMgDl, 1);
}

export function stageOf(a1c: number | null): Stage {
  if (a1c === null) return 'not_enough_data';
  if (a1c < 7) return 'in_target';        // ADA general target: A1c < 7%
  if (a1c < 8) return 'above_target';
  if (a1c < 9) return 'high';
  return 'very_high';
}

export function progress(all: ProgressReading[], now = Date.now()): Progress {
  const rs = all
    .map((r) => ({ ...r, t: new Date(r.taken_at).getTime() }))
    .filter((r) => now - r.t <= 90 * DAY && r.t <= now + 60_000);

  const months: MonthStats[] = [0, 1, 2].map((i) => {
    const xs = rs.filter((r) => now - r.t > i * 30 * DAY && now - r.t <= (i + 1) * 30 * DAY);
    const v = xs.map((r) => r.mg_dl);
    const f = xs.filter((r) => r.context === 'fasting').map((r) => r.mg_dl);
    const m = avg(v);
    return {
      index: i,
      label: i === 0 ? 'Last 30 days' : i === 1 ? '31–60 days ago' : '61–90 days ago',
      readings: v.length,
      mean: m === null ? null : round(m),
      timeInRange: tir(v),
      lows: v.filter((x) => x < 70).length,
      veryHigh: v.filter((x) => x > 250).length,
      fastingMean: f.length ? round(avg(f)!) : null,
    };
  });

  const weekly = Array.from({ length: 13 }, (_, k) => {
    const end = now - (12 - k) * 7 * DAY;
    const start = end - 7 * DAY;
    const v = rs.filter((r) => r.t > start && r.t <= end).map((r) => r.mg_dl);
    const m = avg(v);
    return { weekStart: new Date(start).toISOString().slice(0, 10), mean: m === null ? null : round(m), readings: v.length };
  });

  const values = rs.map((r) => r.mg_dl);
  const mean90 = avg(values);
  const estimatedA1c = mean90 !== null && values.length >= MIN_FOR_A1C ? gmi(mean90) : null;
  const stage = stageOf(estimatedA1c);

  const [cur, prev] = months;
  let trend: Trend = 'not_enough_data';
  let meanChange: number | null = null;
  let timeInRangeChange: number | null = null;
  if (cur!.readings >= MIN_FOR_TREND && prev!.readings >= MIN_FOR_TREND) {
    meanChange = round(cur!.mean! - prev!.mean!);
    timeInRangeChange = round(cur!.timeInRange! - prev!.timeInRange!);
    // A 10 mg/dL shift in the mean, or 10 points of time-in-range, is the
    // smallest change worth telling a patient about.
    const better = meanChange <= -10 || timeInRangeChange >= 10;
    const worse = meanChange >= 10 || timeInRangeChange <= -10;
    trend = better && !worse ? 'improving' : worse && !better ? 'worsening' : 'stable';
  }

  const STAGE_EN: Record<Stage, string> = {
    in_target: 'in the target range', above_target: 'a little above target', high: 'high',
    very_high: 'very high', not_enough_data: 'not yet clear — more readings are needed',
  };
  const STAGE_UR: Record<Stage, string> = {
    in_target: 'ہدف کے اندر', above_target: 'ہدف سے تھوڑا اوپر', high: 'زیادہ',
    very_high: 'بہت زیادہ', not_enough_data: 'ابھی واضح نہیں — مزید ریڈنگز چاہییں',
  };
  const TREND_EN: Record<Trend, string> = {
    improving: 'improving compared with the month before', stable: 'about the same as the month before',
    worsening: 'getting worse compared with the month before', not_enough_data: 'not enough readings to compare months',
  };
  const TREND_UR: Record<Trend, string> = {
    improving: 'پچھلے مہینے سے بہتر ہو رہی ہے', stable: 'پچھلے مہینے جیسی ہے',
    worsening: 'پچھلے مہینے سے خراب ہو رہی ہے', not_enough_data: 'مہینوں کا موازنہ کرنے کے لیے ریڈنگز کم ہیں',
  };

  const a1cEn = estimatedA1c !== null ? ` (estimated HbA1c about ${estimatedA1c}%)` : '';
  const a1cUr = estimatedA1c !== null ? ` (اندازاً HbA1c تقریباً ${estimatedA1c}٪)` : '';
  return {
    months, weekly,
    mean90: mean90 === null ? null : round(mean90),
    timeInRange90: tir(values),
    estimatedA1c, stage, trend, meanChange, timeInRangeChange,
    totalReadings: values.length,
    summaryEn: `Over 3 months sugar control is ${STAGE_EN[stage]}${a1cEn}, and ${TREND_EN[trend]}.`,
    summaryUr: `پچھلے 3 مہینوں میں شوگر ${STAGE_UR[stage]} ہے${a1cUr}، اور ${TREND_UR[trend]}۔`,
  };
}
