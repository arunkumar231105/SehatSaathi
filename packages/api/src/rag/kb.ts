/**
 * Grounding corpus. Small, curated, Pakistan-specific. Every clinical claim
 * the agent makes should be traceable to one of these chunks, which the
 * caregiver dashboard can display for audit.
 *
 * Sources summarised: ADA Standards of Care (self-management essentials),
 * IDF-DAR Ramadan guidance, common Pakistani foods with glycaemic behaviour,
 * and locally available generics.
 */

import { q, vec } from '../db/client.ts';
import { embed } from '../llm/qwen.ts';

export interface KbChunk {
  source: string;
  title: string;
  content: string;
}

export const CORPUS: KbChunk[] = [
  { source: 'ADA-SoC', title: 'Hypoglycaemia 15-15 rule', content: 'Blood glucose below 70 mg/dL is hypoglycaemia. Take 15 g fast sugar (3 teaspoons sugar in water, half a glass of juice, or 3-4 glucose tablets), wait 15 minutes, recheck; repeat if still below 70. Once above 70, eat a small snack with carbohydrate. Do not drive. Common causes: skipped meal, extra activity, too much insulin or sulfonylurea (e.g. glimepiride/Amaryl, gliclazide/Diamicron).' },
  { source: 'ADA-SoC', title: 'Targets', content: 'Typical targets for adults with type 2 diabetes: fasting 80-130 mg/dL, 1-2 hours after meals below 180 mg/dL, HbA1c below 7%. Targets are individualised by the treating doctor, especially for elderly patients or those with hypoglycaemia risk, where looser targets are safer.' },
  { source: 'ADA-SoC', title: 'Hyperglycaemia and DKA warning', content: 'Readings above 250 mg/dL with nausea, vomiting, abdominal pain, deep or rapid breathing, fruity breath, or drowsiness suggest diabetic ketoacidosis — a medical emergency. Above 300 without symptoms still needs same-day medical contact. Drink water, do not exercise when above 250 with symptoms.' },
  { source: 'ADA-SoC', title: 'Sick-day rules', content: 'When ill (fever, vomiting, diarrhoea): keep taking diabetes medication unless the doctor says otherwise, check glucose every 4 hours, drink plenty of sugar-free fluids, and seek care if unable to keep fluids down, glucose stays above 300, or there are DKA symptoms.' },
  { source: 'ADA-SoC', title: 'Diabetic foot care', content: 'Check feet daily for cuts, blisters, redness, swelling. Never walk barefoot. Wash and dry between toes, moisturise (not between toes), cut nails straight. Any wound that is not healing in 2-3 days, any redness spreading, or numbness/tingling needs a doctor — foot infections in diabetes progress fast and are a leading cause of amputation in Pakistan.' },
  { source: 'ADA-SoC', title: 'Neuropathy', content: 'Numbness, tingling, burning or pins-and-needles in feet or hands can be diabetic peripheral neuropathy, linked to prolonged high glucose. It raises the risk of unnoticed foot injury. Report new symptoms to a doctor; better glucose control slows progression.' },
  { source: 'ADA-SoC', title: 'Dawn phenomenon', content: 'Fasting readings that are consistently high (above 130 mg/dL) despite good control at other times may be the dawn phenomenon — early-morning hormone release. Practical steps: avoid large late-night carbohydrate meals, take an evening walk, and discuss timing of evening medication with the doctor.' },
  { source: 'ADA-SoC', title: 'Exercise', content: 'A 20-30 minute walk after meals lowers post-meal glucose. Aim for 150 minutes per week. Carry a sugar source. Do not exercise when glucose is below 70 or above 250 with symptoms.' },
  { source: 'PK-meds', title: 'Metformin (Glucophage, Neophage, Metodine)', content: 'First-line type 2 diabetes medicine in Pakistan. Usually taken with or after meals to reduce stomach upset. Does not cause hypoglycaemia on its own. Common brands: Glucophage, Neophage, Metodine. Missed dose: take with the next meal, never double up. Only the doctor changes the dose.' },
  { source: 'PK-meds', title: 'Sulfonylureas (Amaryl, Diamicron, Daonil)', content: 'Glimepiride (Amaryl), gliclazide (Diamicron), glibenclamide (Daonil) make the pancreas release insulin and CAN cause hypoglycaemia, especially if a meal is skipped or during fasting. Take before meals as prescribed. Carry sugar.' },
  { source: 'PK-meds', title: 'Insulin basics', content: 'Common insulins in Pakistan: Humulin, Mixtard, Insulatard, Lantus, NovoMix. Store unopened in the fridge (not freezer); in-use pen at room temperature away from heat for up to 28 days. Rotate injection sites. Never change the dose without the doctor. Hypoglycaemia risk is real — always eat after rapid/mixed insulin.' },
  { source: 'PK-food', title: 'Roti and naan', content: 'One medium wheat roti (chapati) is about 15-20 g carbohydrate; whole-wheat (chakki atta) is better than maida. Naan is larger, made from refined flour, and raises glucose faster. Practical: fewer rotis, more sabzi and daal on the plate, and eat roti with protein.' },
  { source: 'PK-food', title: 'Rice, biryani, pulao', content: 'White rice and biryani are high-glycaemic; a plate of biryani can push post-meal glucose above 200 mg/dL. Reduce portion to one katori, add salad/raita, and walk afterwards. Brown rice or mixing rice with daal (khichri) blunts the spike.' },
  { source: 'PK-food', title: 'Daal, sabzi, chana', content: 'Lentils (daal), chickpeas (chana), lobia and vegetables are low-glycaemic, high in fibre, and good staples. Daal with one roti is a better meal than two rotis alone.' },
  { source: 'PK-food', title: 'Chai and sweet drinks', content: 'Doodh-patti and chai with 2 teaspoons sugar several times a day adds significant sugar. Switch to no sugar or a sweetener; avoid Rooh Afza, sweet lassi, packaged juices and cold drinks. Plain lassi (namkeen) and water are fine.' },
  { source: 'PK-food', title: 'Mithai, sohan halwa, gulab jamun', content: 'Sweets like sohan halwa, gulab jamun, jalebi and barfi are very high in sugar and fat. On Eid or weddings, take a very small piece with a meal, not on an empty stomach, and walk afterwards.' },
  { source: 'PK-food', title: 'Fried snacks', content: 'Samosa, pakora, paratha and nihari are high in fat and refined flour; they slow digestion but raise glucose for hours and worsen weight and cholesterol. Limit to occasional small portions.' },
  { source: 'PK-food', title: 'Fruit', content: 'Fruit is fine in moderation: one small portion (an apple, a guava, half a mango, a small banana) between meals rather than after a heavy meal. Mango, grapes and dates raise glucose quickly; guava, apple and orange are gentler. Avoid fruit juice.' },
  { source: 'IDF-DAR', title: 'Ramzan fasting — who should not fast', content: 'IDF-DAR classifies as very high risk: severe hypoglycaemia in the last 3 months, DKA, pregnancy with diabetes, dialysis, or poorly controlled type 1 diabetes. These patients are advised not to fast. Everyone should have a pre-Ramzan review with their doctor to adjust medication timing.' },
  { source: 'IDF-DAR', title: 'Ramzan fasting — safe practice', content: 'Check glucose during the fast (this does not break the fast). Break the fast immediately if glucose is below 70 mg/dL, above 300 mg/dL, or if there are hypoglycaemia symptoms. Take sehri as late as possible; avoid heavy fried and sweet foods at iftar; drink water between iftar and sehri.' },
  { source: 'ADA-SoC', title: 'When to call for emergency help', content: 'Call 1122 or go to hospital immediately for: chest pain, one-sided weakness, slurred speech, sudden vision loss, confusion or unconsciousness, glucose below 70 that does not respond to sugar, or glucose above 250 with vomiting or difficulty breathing.' },
  { source: 'ADA-SoC', title: 'Monitoring schedule', content: 'A practical home schedule: fasting reading on waking, and 2 hours after the biggest meal, at least a few days a week; more often when unwell or when medication changes. Write readings down or tell SehatSaathi, and bring the record to every doctor visit.' },
  { source: 'ADA-SoC', title: 'Pregnancy', content: 'In pregnancy, glucose targets are tighter (fasting below 95 mg/dL, 1-hour post-meal below 140). Any abnormal reading in pregnancy needs prompt medical review. Some tablets are not used in pregnancy; insulin is often preferred — only the doctor decides.' },
];

export async function ingest(): Promise<number> {
  const existing = await q<{ n: string }>(`SELECT count(*)::text AS n FROM kb_chunks`);
  if (Number(existing[0]?.n ?? 0) >= CORPUS.length) return 0;
  await q(`DELETE FROM kb_chunks`);
  let n = 0;
  for (const c of CORPUS) {
    const v = await embed(`${c.title}\n${c.content}`);
    await q(
      `INSERT INTO kb_chunks (source, title, content, embedding) VALUES ($1,$2,$3,$4)`,
      [c.source, c.title, c.content, vec(v)],
    );
    n++;
  }
  return n;
}

export interface Retrieved extends KbChunk {
  score: number;
}

export async function retrieve(query: string, k = 3): Promise<Retrieved[]> {
  let v: number[];
  try {
    v = await embed(query);
  } catch {
    return [];
  }
  return q<Retrieved>(
    `SELECT source, title, content, 1 - (embedding <=> $1) AS score
     FROM kb_chunks WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1 LIMIT $2`,
    [vec(v), k],
  );
}
