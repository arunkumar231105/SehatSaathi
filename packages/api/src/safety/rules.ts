/**
 * Deterministic clinical triage.
 *
 * The language model NEVER makes a safety decision. It extracts structured
 * values (a glucose number, a symptom code) and it phrases things warmly in
 * Urdu — but whether a situation is an emergency is decided here, by code,
 * from a fixed rule table. That separation is the whole safety argument:
 * an LLM that is merely wrong about a recipe is annoying; an LLM that is
 * wrong about diabetic ketoacidosis is dangerous.
 *
 * Rules are data, not control flow, so every one of them is enumerable,
 * testable, and auditable after the fact via alerts.rule_id.
 */

export type SymptomCode =
  // hypoglycaemia cluster
  | 'dizziness' | 'sweating' | 'shakiness' | 'confusion' | 'palpitations'
  // DKA cluster
  | 'nausea' | 'vomiting' | 'abdominal_pain' | 'rapid_breathing' | 'fruity_breath'
  // cardiovascular / cerebrovascular
  | 'chest_pain' | 'one_sided_weakness' | 'slurred_speech' | 'sudden_vision_loss'
  // diabetic foot
  | 'foot_ulcer' | 'non_healing_wound' | 'spreading_redness'
  // neuropathy / chronic
  | 'foot_numbness' | 'tingling' | 'blurred_vision' | 'weight_loss'
  | 'excessive_thirst' | 'frequent_urination' | 'fatigue';

export type GlucoseContext = 'fasting' | 'pre_meal' | 'post_meal' | 'random' | 'bedtime';

/** Everything a rule is allowed to look at. Deliberately narrow. */
export interface ClinicalSnapshot {
  /** Reading reported in the current turn, if any. */
  glucoseMgDl?: number;
  glucoseContext?: GlucoseContext;
  /** Symptoms reported in the current turn. */
  symptoms: SymptomCode[];
  /** From profile memory — changes the threshold for several rules. */
  isPregnant?: boolean;
  /** Derived from tier-4 memory. */
  recentReadings?: { mgDl: number; takenAt: Date }[];
  missedDosesLast7Days?: number;
}

export type Severity = 'red' | 'amber';

export interface Finding {
  ruleId: string;
  severity: Severity;
  /** Key into the pre-recorded Urdu clip cache. Safety-critical speech is
   *  never generated live — a TTS outage must not silence an emergency. */
  phraseKey: string;
  reasonUr: string;
  reasonEn: string;
}

interface Rule {
  id: string;
  severity: Severity;
  phraseKey: string;
  reasonUr: string;
  reasonEn: string;
  test: (s: ClinicalSnapshot) => boolean;
}

const has = (s: ClinicalSnapshot, ...codes: SymptomCode[]) =>
  codes.some((c) => s.symptoms.includes(c));

/** Sustained elevation = most of the recent readings are high, not just one
 *  bad day. A single 200 after biryani is not a clinical trend. */
const sustainedHigh = (s: ClinicalSnapshot, days: number, threshold: number) => {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = (s.recentReadings ?? []).filter((r) => r.takenAt.getTime() >= cutoff);
  if (recent.length < 3) return false;
  return recent.filter((r) => r.mgDl > threshold).length / recent.length >= 0.6;
};

/**
 * Order matters only for reporting: all matching rules fire, and the caller
 * escalates on the highest severity present.
 */
export const RULES: Rule[] = [
  // ── RED ────────────────────────────────────────────────────────────────
  {
    id: 'RED_HYPOGLYCAEMIA',
    severity: 'red',
    phraseKey: 'hypo_15_15',
    reasonUr:
      'آپ کی شوگر بہت کم ہے۔ ابھی فوراً تین چمچ چینی یا آدھا گلاس میٹھا جوس لیں، پھر پندرہ منٹ بعد دوبارہ شوگر چیک کریں۔',
    reasonEn:
      'Blood glucose below 70 mg/dL — hypoglycaemia. Patient instructed on the 15-15 rule.',
    // Below 70 is hypoglycaemia regardless of context or symptoms.
    test: (s) => s.glucoseMgDl !== undefined && s.glucoseMgDl < 70,
  },
  {
    id: 'RED_DKA_SUSPICION',
    severity: 'red',
    phraseKey: 'dka_emergency',
    reasonUr:
      'آپ کی شوگر بہت زیادہ ہے اور ساتھ میں ایسی علامات ہیں جو خطرناک ہو سکتی ہیں۔ فوراً ہسپتال جائیں یا 1122 پر کال کریں۔',
    reasonEn:
      'Glucose above 250 mg/dL with ketoacidosis-suggestive symptoms — possible DKA.',
    // High sugar alone is urgent; high sugar WITH these symptoms is an emergency.
    test: (s) =>
      s.glucoseMgDl !== undefined &&
      s.glucoseMgDl > 250 &&
      has(s, 'nausea', 'vomiting', 'abdominal_pain', 'rapid_breathing', 'fruity_breath'),
  },
  {
    id: 'RED_SEVERE_HYPERGLYCAEMIA',
    severity: 'red',
    phraseKey: 'severe_high',
    reasonUr:
      'آپ کی شوگر خطرناک حد تک زیادہ ہے۔ پانی پیتے رہیں اور فوراً ڈاکٹر سے رابطہ کریں۔',
    reasonEn: 'Blood glucose above 300 mg/dL — severe hyperglycaemia.',
    test: (s) => s.glucoseMgDl !== undefined && s.glucoseMgDl > 300,
  },
  {
    id: 'RED_CARDIOVASCULAR',
    severity: 'red',
    phraseKey: 'emergency_call',
    reasonUr:
      'یہ ہنگامی حالت ہو سکتی ہے۔ فوراً 1122 پر کال کریں یا قریبی ہسپتال جائیں۔',
    reasonEn:
      'Chest pain, unilateral weakness, slurred speech, sudden vision loss or confusion — possible cardiac or cerebrovascular event.',
    test: (s) =>
      has(s, 'chest_pain', 'one_sided_weakness', 'slurred_speech', 'sudden_vision_loss', 'confusion'),
  },
  {
    id: 'RED_DIABETIC_FOOT',
    severity: 'red',
    phraseKey: 'foot_urgent',
    reasonUr:
      'ذیابیطس میں پاؤں کا زخم بہت جلدی بگڑ جاتا ہے۔ آج ہی ڈاکٹر کو ضرور دکھائیں۔',
    reasonEn:
      'Foot ulcer, non-healing wound or spreading erythema — diabetic foot infection risk.',
    // Diabetic foot infections escalate fast and are a leading amputation
    // cause in Pakistan; this never waits for a follow-up conversation.
    test: (s) => has(s, 'foot_ulcer', 'non_healing_wound', 'spreading_redness'),
  },
  {
    id: 'RED_PREGNANCY_ABNORMAL',
    severity: 'red',
    phraseKey: 'pregnancy_urgent',
    reasonUr:
      'حمل کے دوران شوگر کا کنٹرول بہت ضروری ہے۔ براہِ کرم آج ہی اپنے ڈاکٹر سے رابطہ کریں۔',
    reasonEn: 'Abnormal glucose during pregnancy — tighter thresholds apply.',
    // Pregnancy narrows the safe band considerably, so a reading that would
    // only be amber otherwise is escalated.
    test: (s) =>
      s.isPregnant === true &&
      s.glucoseMgDl !== undefined &&
      (s.glucoseMgDl < 70 || s.glucoseMgDl > 140),
  },

  // ── AMBER ──────────────────────────────────────────────────────────────
  {
    id: 'AMBER_SUSTAINED_HIGH',
    severity: 'amber',
    phraseKey: 'sustained_high',
    reasonUr:
      'آپ کی شوگر کئی دن سے زیادہ چل رہی ہے۔ کھانے میں احتیاط کریں اور جلد ڈاکٹر سے ملیں۔',
    reasonEn: 'Majority of readings above 180 mg/dL over the last 7 days.',
    test: (s) => sustainedHigh(s, 7, 180),
  },
  {
    id: 'AMBER_SINGLE_HIGH',
    severity: 'amber',
    phraseKey: 'single_high',
    reasonUr: 'آپ کی شوگر معمول سے زیادہ ہے۔ پانی پیئیں اور تھوڑی چہل قدمی کریں۔',
    reasonEn: 'Single reading between 180 and 300 mg/dL.',
    test: (s) =>
      s.glucoseMgDl !== undefined && s.glucoseMgDl > 180 && s.glucoseMgDl <= 300,
  },
  {
    id: 'AMBER_ADHERENCE',
    severity: 'amber',
    phraseKey: 'adherence',
    reasonUr:
      'لگتا ہے آپ سے دوا کچھ دن رہ گئی ہے۔ دوا وقت پر لینا بہت ضروری ہے۔',
    reasonEn: 'Three or more missed doses reported in the last 7 days.',
    test: (s) => (s.missedDosesLast7Days ?? 0) >= 3,
  },
  {
    id: 'AMBER_NEUROPATHY',
    severity: 'amber',
    phraseKey: 'neuropathy',
    reasonUr:
      'پاؤں میں سن ہونا یا سوئیاں چبھنا ذیابیطس کی وجہ سے ہو سکتا ہے۔ ڈاکٹر سے معائنہ کروائیں۔',
    reasonEn: 'New numbness or tingling — possible peripheral neuropathy.',
    test: (s) => has(s, 'foot_numbness', 'tingling'),
  },
  {
    id: 'AMBER_WEIGHT_LOSS',
    severity: 'amber',
    phraseKey: 'weight_loss',
    reasonUr: 'بغیر کوشش کے وزن کم ہونا اہم علامت ہے۔ ڈاکٹر سے مشورہ کریں۔',
    reasonEn: 'Unexplained weight loss reported.',
    test: (s) => has(s, 'weight_loss'),
  },
];

export interface TriageResult {
  severity: Severity | 'none';
  findings: Finding[];
  /** True when the turn must bypass the model and play a cached Urdu clip. */
  requiresEscalation: boolean;
}

/**
 * Run the full rule table. Called BEFORE the model composes a reply (so an
 * emergency short-circuits generation entirely) and again AFTER, as an
 * output filter.
 */
export function triage(snapshot: ClinicalSnapshot): TriageResult {
  const findings: Finding[] = RULES.filter((r) => {
    try {
      return r.test(snapshot);
    } catch {
      // A malformed snapshot must never crash triage — degrade to "not fired"
      // rather than taking the safety layer offline.
      return false;
    }
  }).map(({ id, severity, phraseKey, reasonUr, reasonEn }) => ({
    ruleId: id,
    severity,
    phraseKey,
    reasonUr,
    reasonEn,
  }));

  const severity: Severity | 'none' = findings.some((f) => f.severity === 'red')
    ? 'red'
    : findings.length > 0
      ? 'amber'
      : 'none';

  return { severity, findings, requiresEscalation: severity === 'red' };
}
