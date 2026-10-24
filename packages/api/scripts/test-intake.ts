/**
 * Follow-up question tests. Like the safety tests, these need no API key and
 * no database: which question comes next, and when the questioning stops, is
 * pure logic over what the patient has said so far.
 *
 *   npm run test:intake
 */

import { start, merge, applyYesNo, nextSlot, MAX_QUESTIONS, type Intake, type Slot } from '../src/orchestrator/intake.ts';
import type { Extraction } from '../src/orchestrator/extract.ts';
import { triage } from '../src/safety/rules.ts';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

const ex = (p: Partial<Extraction> = {}): Extraction => ({
  glucose_mg_dl: null, glucose_context: null, symptoms: [], symptoms_improved: [], meals: [],
  medication: { taken: null, missed: null, name: null }, intent: 'log', is_pregnant: null, notes_en: '', ...p,
});
const opts = { hasMedicines: true };

/** Simulate the turn loop: ask, record the slot, fold in the answer. */
function ask(it: Intake): [Intake, Slot | null] {
  const s = nextSlot(it, opts);
  return [s ? { ...it, asked: [...it.asked, s], pending: s } : it, s];
}
function answer(it: Intake, e: Extraction, text = ''): Intake {
  return { ...applyYesNo(merge(it, e, null), it.pending, text), pending: null };
}

console.log('\n  Follow-up questions\n');

// ── "My sugar is 250" — the case the feature exists for ────────────────
{
  let it = start(ex({ glucose_mg_dl: 250 }), 'r1');
  let s: Slot | null;
  [it, s] = ask(it);
  ok('250, timing unknown -> asks fasting or after a meal', s === 'context', `got ${s}`);
  it = answer(it, ex({ glucose_context: 'post_meal' }));
  [it, s] = ask(it);
  ok('250 after a meal -> asks about danger symptoms next', s === 'danger', `got ${s}`);
  it = answer(it, ex(), 'nahi');
  [it, s] = ask(it);
  ok('no danger symptoms -> asks what they ate', s === 'food', `got ${s}`);
  it = answer(it, ex({ meals: [{ description: 'biryani', items: ['biryani', 'roti'] }] }));
  [it, s] = ask(it);
  ok(`stops after ${MAX_QUESTIONS} questions and advises`, s === null && it.asked.length === MAX_QUESTIONS, `got ${s}`);
  ok('answers are carried into the recommendation', it.meals.includes('biryani') && it.context === 'post_meal');
}

// ── Facts the patient already gave are never asked again ──────────────────
{
  let it = start(ex({ glucose_mg_dl: 220, glucose_context: 'post_meal', meals: [{ description: 'naan', items: ['naan'] }] }), 'r');
  let s: Slot | null;
  [it, s] = ask(it);
  ok('220 after naan, context + food known -> asks about medicine', s === 'meds', `got ${s}`);
  it = answer(it, ex(), 'ji nahi, bhool gaya');
  ok('"ji nahi" to the medicine question -> missed dose', it.medsTaken === false, `got ${it.medsTaken}`);
  [, s] = ask(it);
  ok('then advises', s === null, `got ${s}`);
}
{
  const it = start(ex({ glucose_mg_dl: 210, glucose_context: 'post_meal', meals: [{ description: 'x', items: ['chawal'] }], medication: { taken: true, missed: false, name: null } }), 'r');
  ok('everything already said -> no questions at all', nextSlot(it, opts) === null);
}
{
  const it = applyYesNo(start(ex({ glucose_mg_dl: 200 }), 'r'), 'meds', 'ہاں لی تھی');
  ok('Urdu "ہاں" to the medicine question -> taken', it.medsTaken === true);
}

// ── In range: one question at most ───────────────────────────────────────
{
  let it = start(ex({ glucose_mg_dl: 120 }), 'r');
  let s: Slot | null;
  [it, s] = ask(it);
  ok('120, timing unknown -> asks timing', s === 'context', `got ${s}`);
  it = answer(it, ex({ glucose_context: 'post_meal' }));
  [, s] = ask(it);
  ok('120 after a meal is in range -> no interrogation', s === null, `got ${s}`);
  it = answer({ ...it, pending: null }, ex({ glucose_context: 'fasting' }));
  ok('but 120 fasting would count as high (>130 rule is for fasting)', nextSlot({ ...it, glucose: 140 }, opts) !== null);
}

// ── Symptom without a number ─────────────────────────────────────────────
{
  let it = start(ex({ symptoms: ['dizziness'] }), null);
  let s: Slot | null;
  [it, s] = ask(it);
  ok('dizzy, no reading -> asks them to check sugar', s === 'reading', `got ${s}`);
  it = answer(it, ex({ glucose_mg_dl: 260, glucose_context: 'random' }));
  [it, s] = ask(it);
  ok('then a 260 arrives -> context first (random is not an answer)', s === 'context', `got ${s}`);
  [, s] = ask(it);
  ok('with one question left at 260, the danger check is the one asked', s === 'danger', `got ${s}`);
}

// ── Safety: the intake makes triage see across messages ───────────────────
{
  let it = start(ex({ glucose_mg_dl: 280 }), 'r');
  [it] = ask(it); it = answer(it, ex({ glucose_context: 'post_meal' }));
  [it] = ask(it); it = answer(it, ex({ symptoms: ['vomiting'] }));
  const single = triage({ glucoseMgDl: undefined, symptoms: ['vomiting'] });
  const merged = triage({ glucoseMgDl: it.glucose ?? undefined, glucoseContext: it.context ?? undefined, symptoms: it.symptoms });
  ok('"vomiting" alone, judged per message, is not an emergency', single.severity !== 'red');
  ok('280 then "vomiting" two messages later -> RED_DKA_SUSPICION', merged.severity === 'red' && merged.findings.some((f) => f.ruleId === 'RED_DKA_SUSPICION'),
    `got ${merged.severity} [${merged.findings.map((f) => f.ruleId).join(', ')}]`);
}

// ── A new number mid-intake replaces the old one ──────────────────────────
{
  let it = start(ex({ glucose_mg_dl: 190, glucose_context: 'fasting' }), 'r1');
  it = merge(it, ex({ glucose_mg_dl: 160 }), 'r2');
  ok('a corrected reading wins and its timing is asked afresh', it.glucose === 160 && it.context === null && it.readingId === 'r2');
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
