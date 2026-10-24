/**
 * Medicine reference and checks. No API key, no database.
 *
 *   npm run test:meds
 */

import { identify, identifyList, MEDICINES } from '../src/meds/reference.ts';
import { medicineChecks, doctorQuestions, type MedCheckInput } from '../src/meds/checks.ts';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}
const ids = (t: string) => identify(t).map((m) => m.id).sort().join('+');
const base = (p: Partial<MedCheckInput>): MedCheckInput => ({
  medications: [], readings: [], missedDoses7: 0, risingFastingDays: 0, timeInRange14: null,
  fastsInRamzan: false, pregnant: false, conditions: [], symptoms: [], ...p,
});
const checkIds = (p: Partial<MedCheckInput>) => medicineChecks(base(p)).checks.map((c) => c.id);
const ago = (d: number) => new Date(Date.now() - d * 86_400_000);

console.log('\n  Recognising medicines\n');
ok('"Metformin (Glucophage) 500mg twice daily" -> metformin', ids('Metformin (Glucophage) 500mg twice daily') === 'metformin');
ok('Pakistani brand "Neodipar 850" -> metformin', ids('Neodipar 850') === 'metformin');
ok('"Getryl 2mg" -> glimepiride', ids('Getryl 2mg') === 'glimepiride');
ok('"Diamicron MR 60" -> gliclazide', ids('Diamicron MR 60') === 'gliclazide');
ok('combination "Galvus Met 50/850" -> vildagliptin + metformin', ids('Galvus Met 50/850') === 'metformin+vildagliptin', ids('Galvus Met 50/850'));
ok('combination "Treviamet XR" -> sitagliptin + metformin', ids('Treviamet XR') === 'metformin+sitagliptin', ids('Treviamet XR'));
ok('"Mixtard 30" -> premixed insulin', ids('Mixtard 30 morning and evening') === 'insulin_premix');
ok('Urdu script "میٹفارمن" -> metformin', ids('میں میٹفارمن لیتی ہوں') === 'metformin');
ok('"xiga" is not found inside "dapxiga m" twice', ids('Dapxiga M') === 'dapagliflozin+metformin', ids('Dapxiga M'));
ok('unknown brand is kept visible, not guessed', identifyList(['Zyxomet 5mg']).unknown[0] === 'Zyxomet 5mg');
ok('no false match: "pioglitazone" is not read as "piog" plus something else', ids('pioglitazone 15') === 'pioglitazone');

console.log('\n  Safety checks\n');
ok('Glucophage + Treviamet -> metformin taken twice',
  checkIds({ medications: ['Glucophage 500', 'Treviamet 50/1000'] }).includes('DUPLICATE_METFORMIN'));
ok('Amaryl + Diamicron -> two sulfonylureas',
  checkIds({ medications: ['Amaryl 2mg', 'Diamicron MR'] }).includes('SAME_CLASS_SULFONYLUREA'));
ok('a low (55) in the last 2 weeks on gliclazide -> flagged',
  checkIds({ medications: ['Gliclazide 80'], readings: [{ mg_dl: 55, taken_at: ago(3) }] }).includes('LOWS_ON_HYPO_CAUSING_MED'));
ok('a low on metformin alone -> not blamed on the medicine',
  !checkIds({ medications: ['Metformin 500'], readings: [{ mg_dl: 60, taken_at: ago(3) }] }).includes('LOWS_ON_HYPO_CAUSING_MED'));
ok('two lows on insulin -> "today" urgency',
  medicineChecks(base({ medications: ['Lantus 20 units'], readings: [{ mg_dl: 60, taken_at: ago(1) }, { mg_dl: 58, taken_at: ago(4) }] })).checks[0]?.urgency === 'today');
ok('vomiting on dapagliflozin -> contact doctor today (DKA risk)',
  checkIds({ medications: ['Xiga 10mg'], symptoms: ['vomiting'] }).includes('SGLT2_WHILE_UNWELL'));
ok('vomiting on metformin -> dehydration check',
  checkIds({ medications: ['Glucophage'], symptoms: ['vomiting'] }).includes('METFORMIN_WHILE_VOMITING'));
ok('pioglitazone with heart failure -> flagged',
  checkIds({ medications: ['Piotec 30'], conditions: ['heart failure'] }).includes('PIOGLITAZONE_HEART'));
ok('pregnant on glimepiride -> see doctor soon',
  checkIds({ medications: ['Getryl 1mg'], pregnant: true }).includes('PREGNANCY_ORAL_AGENT'));
ok('pregnant on insulin only -> no flag',
  !checkIds({ medications: ['Mixtard 30'], pregnant: true }).includes('PREGNANCY_ORAL_AGENT'));
ok('fasts in Ramzan on gliclazide -> plan ahead',
  checkIds({ medications: ['Diamicron MR'], fastsInRamzan: true }).includes('RAMZAN_PLAN'));
ok('metformin alone, nothing unusual -> no checks', checkIds({ medications: ['Metformin 500 twice daily'] }).length === 0);

console.log('\n  Questions for the doctor\n');
{
  const input = base({ medications: ['Glucophage 500', 'Mystery tablet'], risingFastingDays: 5, missedDoses7: 3 });
  const { checks, known, unknown } = medicineChecks(input);
  const qs = doctorQuestions(input, checks, known, unknown);
  ok('rising fasting sugar becomes a question naming their medicine', qs.some((x) => x.en.includes('5 days') && x.en.includes('Glucophage')));
  ok('missed doses become a question about simpler timing', qs.some((x) => x.en.includes('missed my medicine 3 times')));
  ok('an unrecognised medicine becomes "what is this for?"', qs.some((x) => x.en.includes('Mystery tablet')));
  ok('always ends with the HbA1c / kidney / eye check question', qs.at(-1)!.en.includes('HbA1c'));
  ok('every question has an Urdu version', qs.every((x) => /[؀-ۿ]/.test(x.ur)));
}

console.log('\n  Never prescribes\n');
{
  // Every patient-facing string in the reference and in every check.
  const texts: string[] = [];
  for (const m of MEDICINES) for (const k of ['purpose', 'take', 'sideEffects', 'missedDose', 'warning'] as const) texts.push(m[k].en);
  const all = medicineChecks(base({
    medications: ['Glucophage', 'Treviamet', 'Amaryl', 'Diamicron', 'Xiga', 'Piotec'],
    readings: [{ mg_dl: 55, taken_at: ago(1) }, { mg_dl: 60, taken_at: ago(2) }],
    symptoms: ['vomiting'], conditions: ['heart failure', 'kidney disease'], pregnant: true, fastsInRamzan: true,
  }));
  ok('the kitchen-sink record fires every check family', all.checks.length >= 8, `${all.checks.length} checks`);
  for (const c of all.checks) texts.push(c.patientEn);
  const bad = texts.filter((t) =>
    /\b(increase|reduce|lower|raise|double|halve) (your |the )?(dose|insulin|medicine)/i.test(t) ||
    /(?<!not |never |don't |do not )\b(start|stop|switch to) (taking|using)\b/i.test(t));
  ok('no text tells a patient to start, stop, switch or re-dose a medicine', bad.length === 0, bad.join(' || '));
  ok('every reference entry cites a source', MEDICINES.every((m) => m.sources.length > 0 && m.sources.every((s) => s.url.startsWith('https://'))));
  ok('every reference entry has Urdu for every field', MEDICINES.every((m) => (['purpose', 'take', 'sideEffects', 'missedDose', 'warning'] as const).every((k) => /[؀-ۿ]/.test(m[k].ur))));
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
