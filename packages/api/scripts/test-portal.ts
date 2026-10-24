/**
 * Portal logic that needs no database: 3-month progress, the HbA1c estimate,
 * phone numbers, share codes and password hashing.
 *
 *   npm run test:portal
 */

import { progress, gmi, stageOf } from '../src/portal/progress.ts';
import { normalizePhone, newShareCode, hashPassword, verifyPassword } from '../src/portal/auth.ts';

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
