/**
 * Portal logic that needs no database: 3-month progress, the HbA1c estimate,
 * phone numbers, share codes and password hashing.
 *
 *   npm run test:portal
 */

import { progress, gmi, stageOf } from '../src/portal/progress.ts';
import { normalizePhone, newShareCode, hashPassword, verifyPassword } from '../src/portal/auth.ts';
import { slotsFor, dueSlot } from '../src/meds/reminders.ts';
import { interpret, readingAsText } from '../src/vision/glucometer.ts';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 24, 12);
/** One reading a day at `mg(d)`, for days 0..89 ago. */
const series = (mg: (daysAgo: number) => number, every = 1) =>
  Array.from({ length: 90 / every }, (_, i) => ({ mg_dl: mg(i * every), taken_at: new Date(now - i * every * DAY - 3600_000) }));

console.log('\n  Three-month progress\n');

ok('GMI formula: mean 154 mg/dL -> 7.0%', gmi(154) === 7.0, String(gmi(154)));
ok('GMI formula: mean 183 mg/dL -> 7.7%', gmi(183) === 7.7, String(gmi(183)));
ok('stage: 6.8% is in target', stageOf(6.8) === 'in_target');
ok('stage: 9.2% is very high', stageOf(9.2) === 'very_high');

{
  // 220 three months ago, easing to 160 now.
  const p = progress(series((d) => 160 + (d / 90) * 60), now);
  ok('falling sugar over 3 months -> improving', p.trend === 'improving', `${p.trend} (${p.meanChange})`);
  ok('three monthly buckets, newest first, means descending in time', p.months[0]!.mean! < p.months[1]!.mean! && p.months[1]!.mean! < p.months[2]!.mean!);
  ok('13 weekly points for the chart', p.weekly.length === 13 && p.weekly.at(-1)!.mean !== null);
  ok('estimated HbA1c shown with enough readings', p.estimatedA1c !== null);
  ok('summary has English and Urdu', p.summaryEn.includes('improving') && /[؀-ۿ]/.test(p.summaryUr));
}
{
  const p = progress(series((d) => 150 + ((90 - d) / 90) * 70), now);
  ok('rising sugar -> worsening', p.trend === 'worsening', p.trend);
}
{
  const p = progress(series(() => 140 + Math.round(Math.random() * 4)), now);
  ok('flat sugar -> stable', p.trend === 'stable', p.trend);
  ok('mean ~142 -> estimated HbA1c in target', p.stage === 'in_target', `${p.stage} ${p.estimatedA1c}`);
}
{
  const p = progress(series(() => 200).slice(0, 6), now);
  ok('only 6 readings -> no HbA1c estimate', p.estimatedA1c === null && p.stage === 'not_enough_data');
  ok('nothing in the previous month -> trend not claimed', p.trend === 'not_enough_data');
}
{
  const old = [{ mg_dl: 400, taken_at: new Date(now - 120 * DAY) }];
  const p = progress([...series(() => 150), ...old], now);
  ok('readings older than 90 days are ignored', p.months.every((m) => m.veryHigh === 0));
}
{
  const p = progress([{ mg_dl: 60, taken_at: new Date(now - 2 * DAY) }, { mg_dl: 300, taken_at: new Date(now - 3 * DAY) }], now);
  ok('lows and very-highs are counted per month', p.months[0]!.lows === 1 && p.months[0]!.veryHigh === 1);
}

console.log('\n  Dose reminder times\n');
const slots = (s: string) => slotsFor(s).join('+');
ok('"twice daily after meals" -> morning + night', slots('twice daily after meals') === 'morning+night', slots('twice daily after meals'));
ok('"with breakfast" -> morning', slots('with breakfast') === 'morning');
ok('Roman Urdu "subah nashte ke baad aur raat ko" -> morning + night', slots('subah nashte ke baad aur raat ko') === 'morning+night', slots('subah nashte ke baad aur raat ko'));
ok('Urdu "رات کو سونے سے پہلے" -> night', slots('رات کو سونے سے پہلے') === 'night');
ok('"three times a day" -> morning, afternoon, night', slots('three times a day') === 'morning+afternoon+night');
ok('unclear schedule -> one morning reminder, never a guessed extra dose', slots('as directed') === 'morning' && slots('') === 'morning');
ok('08:10 Pakistan time is the morning slot', dueSlot(new Date('2026-10-24T03:10:00Z'))?.slot === 'morning');
ok('21:40 Pakistan time is the night slot', dueSlot(new Date('2026-10-24T16:40:00Z'))?.slot === 'night');
ok('11:00 Pakistan time is no slot', dueSlot(new Date('2026-10-24T06:00:00Z')) === null);

console.log('\n  Glucometer photo reading\n');
ok('"245 mg/dL" -> 245', interpret({ is_glucometer: true, display: '245', value: 245, unit: 'mg/dL', confidence: 0.95 }).mgDl === 245);
ok('"8.4 mmol/L" -> 151 mg/dL', interpret({ is_glucometer: true, display: '8.4', value: 8.4, unit: 'mmol/L', confidence: 0.9 }).mgDl === 151);
ok('a decimal under 35 with no unit is read as mmol/L', interpret({ is_glucometer: true, value: 6.1, unit: null, confidence: 0.9 }).mgDl === 110);
ok('"HI" -> 600 and flagged (an emergency, not a misread)', (() => { const r = interpret({ is_glucometer: true, display: 'HI', value: null, hi_lo: 'HI', confidence: 0.9 }); return r.mgDl === 600 && r.flag === 'hi'; })());
ok('"LO" -> 20 and flagged', interpret({ is_glucometer: true, display: 'LO', value: null, hi_lo: 'LO', confidence: 0.9 }).flag === 'lo');
ok('a number no meter can show (2450) is rejected', interpret({ is_glucometer: true, value: 2450, unit: 'mg/dL', confidence: 0.9 }).mgDl === null);
ok('not a glucometer -> no reading', interpret({ is_glucometer: false, value: 120, confidence: 0.9 }).mgDl === null);
ok('garbage from the model -> no reading', interpret(null).mgDl === null && interpret({ value: 'abc' }).mgDl === null);
ok('HI is sent on as "above 600" so triage escalates', readingAsText(interpret({ hi_lo: 'HI', confidence: 1 }), 'en').includes('above 600'));

console.log('\n  Accounts\n');
ok('0300-1234567 -> 923001234567', normalizePhone('0300-1234567') === '923001234567');
ok('+92 300 1234567 -> 923001234567', normalizePhone('+92 300 1234567') === '923001234567');
{
  const codes = Array.from({ length: 200 }, newShareCode);
  ok('share codes are 6 readable characters', codes.every((c) => /^[A-HJ-NP-Z2-9]{6}$/.test(c)));
  ok('share codes do not repeat', new Set(codes).size === codes.length);
}
{
  const h = await hashPassword('correct horse');
  ok('password hash is salted scrypt, not the password', h.startsWith('scrypt$') && !h.includes('correct'));
  ok('right password verifies', await verifyPassword('correct horse', h));
  ok('wrong password is rejected', !(await verifyPassword('correct hors', h)));
  ok('the same password hashes differently each time', h !== (await hashPassword('correct horse')));
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
