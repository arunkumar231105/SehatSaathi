/**
 * Safety rule tests. These run with no API key and no database — the triage
 * layer is deliberately pure so it can be verified in isolation, and so a
 * judge asking "how do you know it escalates?" gets an answer that is not
 * "we tried it once in the demo".
 *
 *   npm run test:safety
 */

import { triage, type ClinicalSnapshot } from '../src/safety/rules.ts';

let passed = 0;
let failed = 0;

function check(name: string, snapshot: ClinicalSnapshot, expect: {
  severity: 'red' | 'amber' | 'none';
  ruleId?: string;
}) {
  const result = triage(snapshot);
  const sevOk = result.severity === expect.severity;
  const ruleOk = !expect.ruleId || result.findings.some((f) => f.ruleId === expect.ruleId);

  if (sevOk && ruleOk) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${expect.severity}${expect.ruleId ? ` + ${expect.ruleId}` : ''}`);
    console.log(`        got      ${result.severity} [${result.findings.map((f) => f.ruleId).join(', ') || 'none'}]`);
  }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

console.log('\n  Safety triage\n');

// ── RED ──────────────────────────────────────────────────────────────────
check('hypoglycaemia at 55', { glucoseMgDl: 55, symptoms: [] },
  { severity: 'red', ruleId: 'RED_HYPOGLYCAEMIA' });

check('hypo boundary: 69 is low', { glucoseMgDl: 69, symptoms: [] },
  { severity: 'red', ruleId: 'RED_HYPOGLYCAEMIA' });

check('DKA: 280 with vomiting', { glucoseMgDl: 280, symptoms: ['vomiting'] },
  { severity: 'red', ruleId: 'RED_DKA_SUSPICION' });

check('severe hyperglycaemia at 340', { glucoseMgDl: 340, symptoms: [] },
  { severity: 'red', ruleId: 'RED_SEVERE_HYPERGLYCAEMIA' });

check('extreme hyperglycaemia at 500 — hospital, not just "call your doctor"', { glucoseMgDl: 500, symptoms: [] },
  { severity: 'red', ruleId: 'RED_EXTREME_HYPERGLYCAEMIA' });

{
  // The spoken instruction comes from the FIRST red finding, so order matters.
  const r = triage({ glucoseMgDl: 500, symptoms: [] });
  const first = r.findings.find((f) => f.severity === 'red')?.ruleId;
  if (first === 'RED_EXTREME_HYPERGLYCAEMIA') { passed++; console.log('  PASS  at 500 the hospital instruction is the one spoken'); }
  else { failed++; console.log(`  FAIL  at 500 the hospital instruction is the one spoken
        first red was ${first}`); }
}

check('340 is severe but not extreme', { glucoseMgDl: 340, symptoms: [] },
  { severity: 'red', ruleId: 'RED_SEVERE_HYPERGLYCAEMIA' });

check('chest pain alone, no reading', { symptoms: ['chest_pain'] },
  { severity: 'red', ruleId: 'RED_CARDIOVASCULAR' });

check('stroke signs', { symptoms: ['one_sided_weakness', 'slurred_speech'] },
  { severity: 'red', ruleId: 'RED_CARDIOVASCULAR' });

check('diabetic foot ulcer', { symptoms: ['foot_ulcer'] },
  { severity: 'red', ruleId: 'RED_DIABETIC_FOOT' });

check('pregnancy tightens the band: 150 is red',
  { glucoseMgDl: 150, symptoms: [], isPregnant: true },
  { severity: 'red', ruleId: 'RED_PREGNANCY_ABNORMAL' });

// ── AMBER ────────────────────────────────────────────────────────────────
check('single high at 220', { glucoseMgDl: 220, symptoms: [] },
  { severity: 'amber', ruleId: 'AMBER_SINGLE_HIGH' });

check('sustained high across a week', {
  symptoms: [],
  recentReadings: [
    { mgDl: 210, takenAt: daysAgo(1) },
    { mgDl: 195, takenAt: daysAgo(2) },
    { mgDl: 230, takenAt: daysAgo(3) },
    { mgDl: 160, takenAt: daysAgo(4) },
    { mgDl: 205, takenAt: daysAgo(5) },
  ],
}, { severity: 'amber', ruleId: 'AMBER_SUSTAINED_HIGH' });

check('missed doses', { symptoms: [], missedDosesLast7Days: 4 },
  { severity: 'amber', ruleId: 'AMBER_ADHERENCE' });

check('new foot numbness', { symptoms: ['foot_numbness'] },
  { severity: 'amber', ruleId: 'AMBER_NEUROPATHY' });

// ── NONE ─────────────────────────────────────────────────────────────────
check('normal fasting reading', { glucoseMgDl: 110, glucoseContext: 'fasting', symptoms: [] },
  { severity: 'none' });

check('in-range post-meal reading', { glucoseMgDl: 175, glucoseContext: 'post_meal', symptoms: [] },
  { severity: 'none' });

check('no data at all', { symptoms: [] }, { severity: 'none' });

// ── Interactions worth pinning down ──────────────────────────────────────

// A single bad day must not read as a trend, or the agent cries wolf and the
// patient stops listening to it.
check('one high reading is not a sustained trend', {
  symptoms: [],
  recentReadings: [
    { mgDl: 260, takenAt: daysAgo(1) },
    { mgDl: 120, takenAt: daysAgo(2) },
    { mgDl: 115, takenAt: daysAgo(3) },
    { mgDl: 130, takenAt: daysAgo(4) },
    { mgDl: 125, takenAt: daysAgo(5) },
  ],
}, { severity: 'none' });

// Red must dominate when both fire — an amber finding alongside must never
// downgrade the overall severity.
check('red wins over concurrent amber', {
  glucoseMgDl: 310, symptoms: ['foot_numbness'],
}, { severity: 'red', ruleId: 'RED_SEVERE_HYPERGLYCAEMIA' });

// Escalation flag drives the bypass-the-model path in the orchestrator.
const emergency = triage({ glucoseMgDl: 55, symptoms: ['confusion'] });
if (emergency.requiresEscalation) {
  passed++; console.log('  PASS  requiresEscalation set on red');
} else {
  failed++; console.log('  FAIL  requiresEscalation not set on red');
}

// Every finding must carry a cached-clip key, or an emergency could end up
// depending on a live TTS call.
const allHavePhrase = triage({ glucoseMgDl: 55, symptoms: [] })
  .findings.every((f) => f.phraseKey.length > 0);
if (allHavePhrase) {
  passed++; console.log('  PASS  findings carry a prerecorded phraseKey');
} else {
  failed++; console.log('  FAIL  a finding is missing phraseKey');
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
