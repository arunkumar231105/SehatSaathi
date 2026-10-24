/**
 * A small, sourced reference for the diabetes medicines used in Pakistan.
 *
 * Why hand-written rather than a downloaded dataset: the public "medicine"
 * datasets we looked at either assigned indications at random (Metformin
 * "used for pain relief") or contained no medicine information at all. A
 * companion that explains medicines to people who may not be able to read the
 * leaflet has to be right, so every entry here is short, cites where it came
 * from, and says only what the patient-facing guides say.
 *
 * What this is used for — and what it is not:
 *   ✓ recognising a medicine the patient names, by brand or generic name
 *   ✓ explaining a medicine the patient ALREADY takes: what it is for, how to
 *     take it, common side effects, what to do about a missed dose
 *   ✓ the deterministic safety checks in checks.ts
 *   ✗ choosing, starting, switching, stopping or dosing anything — that
 *     needs blood tests and a doctor, and is never done here.
 *
 * Brands are limited to those found on Pakistani pharmacy listings (oladoc,
 * dawaai, drugsinfo.pk, IMC Hospital) in October 2026. Pakistan has hundreds
 * of brands per molecule; an unrecognised brand is asked about, never guessed.
 */

export type MedClass = 'biguanide' | 'sulfonylurea' | 'dpp4' | 'sglt2' | 'tzd' | 'insulin';

export interface Source { title: string; url: string }

export interface Medicine {
  id: string;
  generic: string;
  classId: MedClass;
  /** Lower-case names and spellings this medicine is recognised by, including Urdu script. */
  names: string[];
  /** Display brands found on Pakistani pharmacy listings. */
  brands: string[];
  /** Can it cause a hypo on its own? Drives the low-sugar and Ramzan checks. */
  causesLows: boolean;
  purpose: { en: string; ur: string };
  take: { en: string; ur: string };
  sideEffects: { en: string; ur: string };
  missedDose: { en: string; ur: string };
  /** The one warning sign worth knowing, and what to do. */
  warning: { en: string; ur: string };
  sources: Source[];
}

const NHS = (slug: string, title: string): Source => ({ title: `NHS — ${title}`, url: `https://www.nhs.uk/medicines/${slug}/` });
const IDF_DAR: Source = { title: 'IDF–DAR Diabetes and Ramadan Practical Guidelines 2021', url: 'https://www.daralliance.org/daralliance/idf-dar-practical-guidelines-2021/' };

const SKIP_IF_CLOSE = {
  en: 'If you forget a dose, take it when you remember unless it is nearly time for the next one — then skip it. Never take two doses together.',
  ur: 'اگر دوا بھول جائیں تو یاد آنے پر لے لیں، لیکن اگر اگلی خوراک کا وقت قریب ہو تو چھوڑ دیں۔ کبھی دو خوراکیں ایک ساتھ نہ لیں۔',
};

export const MEDICINES: Medicine[] = [
  {
    id: 'metformin', generic: 'Metformin', classId: 'biguanide',
    names: ['metformin', 'glucophage', 'neodipar', 'neophage', 'میٹفارمن', 'میٹ فارمن', 'گلوکوفیج', 'نیوڈیپار'],
    brands: ['Glucophage', 'Neodipar', 'Neophage'],
    causesLows: false,
    purpose: {
      en: 'Lowers blood sugar by helping your body use its own insulin better. It is usually the first diabetes medicine.',
      ur: 'یہ جسم کو اپنی انسولین بہتر استعمال کرنے میں مدد دے کر شوگر کم کرتی ہے۔ عام طور پر شوگر کی پہلی دوا یہی ہوتی ہے۔',
    },
    take: { en: 'Take it with food, as your doctor prescribed — usually 1 to 3 times a day with meals.', ur: 'اسے کھانے کے ساتھ لیں، جیسے ڈاکٹر نے بتایا — عام طور پر دن میں ایک سے تین بار کھانے کے ساتھ۔' },
    sideEffects: {
      en: 'Upset stomach, diarrhoea, loss of appetite or a metallic taste — these usually settle in a couple of weeks. Over years it can lower vitamin B12, which causes tiredness.',
      ur: 'پیٹ خراب ہونا، دست، بھوک کم لگنا یا منہ کا ذائقہ بدلنا — یہ عام طور پر دو ہفتوں میں ٹھیک ہو جاتا ہے۔ کئی سال بعد وٹامن بی 12 کم ہو سکتا ہے جس سے تھکاوٹ ہوتی ہے۔',
    },
    missedDose: SKIP_IF_CLOSE,
    warning: {
      en: 'If you are vomiting, have diarrhoea or a fever, you can become dehydrated — speak to your doctor or pharmacist the same day about your medicines.',
      ur: 'اگر الٹی، دست یا بخار ہو تو جسم میں پانی کی کمی ہو سکتی ہے — اسی دن ڈاکٹر یا فارماسسٹ سے اپنی دواؤں کے بارے میں بات کریں۔',
    },
    sources: [NHS('metformin', 'Metformin')],
  },
  {
    id: 'gliclazide', generic: 'Gliclazide', classId: 'sulfonylurea',
    names: ['gliclazide', 'diamicron', 'glic mr', 'glicotron', 'gliget', 'گلیکلازائیڈ', 'ڈائمکرون'],
    brands: ['Diamicron MR', 'Glic MR', 'Glicotron MR', 'Gliget MR'],
    causesLows: true,
    purpose: { en: 'Makes your pancreas release more insulin, which lowers blood sugar.', ur: 'یہ لبلبے سے زیادہ انسولین نکلواتی ہے جس سے شوگر کم ہوتی ہے۔' },
    take: { en: 'Take it with or just after a meal — usually with breakfast — at the same time each day. Do not skip or delay meals while on it.', ur: 'اسے کھانے کے ساتھ یا فوراً بعد لیں — عام طور پر ناشتے کے ساتھ — اور روز ایک ہی وقت پر۔ اس دوا کے ساتھ کھانا نہ چھوڑیں اور نہ دیر کریں۔' },
    sideEffects: { en: 'Low sugar (a "hypo"), stomach pain, diarrhoea, some weight gain.', ur: 'شوگر کم ہو جانا، پیٹ میں درد، دست، کچھ وزن بڑھنا۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: {
      en: 'It can make your sugar go too low — sweating, shaking, dizziness or confusion. Take something sugary at once, and tell your doctor if lows keep happening.',
      ur: 'اس سے شوگر بہت کم ہو سکتی ہے — پسینہ، کپکپی، چکر یا الجھن۔ فوراً کوئی میٹھی چیز لیں، اور اگر بار بار ایسا ہو تو ڈاکٹر کو بتائیں۔',
    },
    sources: [NHS('gliclazide', 'Gliclazide')],
  },
  {
    id: 'glimepiride', generic: 'Glimepiride', classId: 'sulfonylurea',
    names: ['glimepiride', 'amaryl', 'getryl', 'گلیمیپرائیڈ', 'امریل', 'گیٹرل'],
    brands: ['Amaryl', 'Getryl'],
    causesLows: true,
    purpose: { en: 'Makes your pancreas release more insulin, which lowers blood sugar.', ur: 'یہ لبلبے سے زیادہ انسولین نکلواتی ہے جس سے شوگر کم ہوتی ہے۔' },
    take: { en: 'Once a day with breakfast or your first main meal. Do not skip meals while on it.', ur: 'دن میں ایک بار ناشتے یا دن کے پہلے بڑے کھانے کے ساتھ۔ اس دوا کے ساتھ کھانا نہ چھوڑیں۔' },
    sideEffects: { en: 'Low sugar (a "hypo"), feeling sick, some weight gain.', ur: 'شوگر کم ہو جانا، متلی، کچھ وزن بڑھنا۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: {
      en: 'It can make your sugar go too low — sweating, shaking, dizziness or confusion. Take something sugary at once, and tell your doctor if lows keep happening.',
      ur: 'اس سے شوگر بہت کم ہو سکتی ہے — پسینہ، کپکپی، چکر یا الجھن۔ فوراً کوئی میٹھی چیز لیں، اور اگر بار بار ایسا ہو تو ڈاکٹر کو بتائیں۔',
    },
    sources: [NHS('glimepiride', 'Glimepiride')],
  },
  {
    id: 'glibenclamide', generic: 'Glibenclamide', classId: 'sulfonylurea',
    names: ['glibenclamide', 'glyburide', 'daonil', 'گلیبینکلامائیڈ', 'ڈاؤنل'],
    brands: ['Daonil'],
    causesLows: true,
    purpose: { en: 'Makes your pancreas release more insulin, which lowers blood sugar.', ur: 'یہ لبلبے سے زیادہ انسولین نکلواتی ہے جس سے شوگر کم ہوتی ہے۔' },
    take: { en: 'With breakfast or the first main meal, as prescribed. Do not skip meals while on it.', ur: 'ناشتے یا پہلے بڑے کھانے کے ساتھ، جیسے ڈاکٹر نے بتایا۔ اس دوا کے ساتھ کھانا نہ چھوڑیں۔' },
    sideEffects: { en: 'Low sugar (a "hypo") — more often than with similar tablets, especially in older people — and some weight gain.', ur: 'شوگر کم ہو جانا — ملتی جلتی گولیوں سے زیادہ، خاص طور پر بزرگوں میں — اور کچھ وزن بڑھنا۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: {
      en: 'Lows on this medicine can last for hours. If you have sweating, shaking or confusion, take sugar at once and get help if it does not settle.',
      ur: 'اس دوا سے شوگر کم ہو تو کئی گھنٹے رہ سکتی ہے۔ پسینہ، کپکپی یا الجھن ہو تو فوراً چینی لیں اور ٹھیک نہ ہو تو مدد لیں۔',
    },
    sources: [{ title: 'NICE BNF — Glibenclamide', url: 'https://bnf.nice.org.uk/drugs/glibenclamide/' }],
  },
  {
    id: 'sitagliptin', generic: 'Sitagliptin', classId: 'dpp4',
    names: ['sitagliptin', 'januvia', 'trevia', 'tagtin', 'سیٹاگلپٹن', 'جنوویا'],
    brands: ['Januvia', 'Trevia', 'Tagtin'],
    causesLows: false,
    purpose: { en: 'Helps your body release insulin after meals, when sugar rises.', ur: 'یہ کھانے کے بعد جب شوگر بڑھتی ہے تو جسم کو انسولین نکالنے میں مدد دیتی ہے۔' },
    take: { en: 'Once a day, with or without food, at the same time each day.', ur: 'دن میں ایک بار، کھانے کے ساتھ یا بغیر، روز ایک ہی وقت پر۔' },
    sideEffects: { en: 'Headache is the most common. On its own it rarely causes lows, but it can with other diabetes medicines.', ur: 'سر درد سب سے عام ہے۔ اکیلے اس سے شوگر کم کم ہوتی ہے، لیکن دوسری شوگر کی دواؤں کے ساتھ ہو سکتی ہے۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: { en: 'Severe stomach pain that spreads to your back and does not go away needs urgent medical help.', ur: 'پیٹ میں شدید درد جو کمر تک جائے اور ٹھیک نہ ہو، تو فوراً ڈاکٹر یا ہسپتال جائیں۔' },
    sources: [NHS('sitagliptin', 'Sitagliptin')],
  },
  {
    id: 'vildagliptin', generic: 'Vildagliptin', classId: 'dpp4',
    names: ['vildagliptin', 'galvus', 'وِلڈاگلپٹن', 'گالوس'],
    brands: ['Galvus'],
    causesLows: false,
    purpose: { en: 'Helps your body release insulin after meals, when sugar rises.', ur: 'یہ کھانے کے بعد جب شوگر بڑھتی ہے تو جسم کو انسولین نکالنے میں مدد دیتی ہے۔' },
    take: { en: 'Usually once or twice a day, with or without food, as prescribed.', ur: 'عام طور پر دن میں ایک یا دو بار، کھانے کے ساتھ یا بغیر، جیسے ڈاکٹر نے بتایا۔' },
    sideEffects: { en: 'Dizziness or headache. Your doctor may check your liver blood test while you take it.', ur: 'چکر یا سر درد۔ اس دوا کے دوران ڈاکٹر جگر کا ٹیسٹ کروا سکتے ہیں۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: { en: 'Severe stomach pain that spreads to your back, or yellow eyes or skin, needs urgent medical help.', ur: 'پیٹ میں شدید درد جو کمر تک جائے، یا آنکھیں یا جلد پیلی ہو جائیں، تو فوراً ڈاکٹر یا ہسپتال جائیں۔' },
    sources: [{ title: 'EMA — Galvus (vildagliptin) product information', url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/galvus' }],
  },
  {
    id: 'empagliflozin', generic: 'Empagliflozin', classId: 'sglt2',
    names: ['empagliflozin', 'jardiance', 'ایمپاگلیفلوزن', 'جارڈیئنس'],
    brands: ['Jardiance'],
    causesLows: false,
    purpose: { en: 'Makes your kidneys pass extra sugar out in your urine. It also protects the heart and kidneys.', ur: 'یہ گردوں کے ذریعے اضافی شوگر پیشاب میں نکال دیتی ہے۔ یہ دل اور گردوں کی حفاظت بھی کرتی ہے۔' },
    take: { en: 'Once a day, in the morning, with or without food. Drink enough water.', ur: 'دن میں ایک بار، صبح، کھانے کے ساتھ یا بغیر۔ پانی مناسب پیتے رہیں۔' },
    sideEffects: { en: 'Passing more urine, thirst, and itching or infection in the private area — keep the area clean and dry.', ur: 'پیشاب زیادہ آنا، پیاس، اور شرم گاہ میں خارش یا انفیکشن — اس جگہ کو صاف اور خشک رکھیں۔' },
    missedDose: {
      en: 'Take it when you remember unless the next dose is less than 12 hours away — then skip it. Never take two doses together.',
      ur: 'یاد آنے پر لے لیں، لیکن اگر اگلی خوراک میں 12 گھنٹے سے کم ہوں تو چھوڑ دیں۔ کبھی دو خوراکیں ایک ساتھ نہ لیں۔',
    },
    warning: {
      en: 'If you are vomiting, not eating, or very unwell, a dangerous acid build-up can happen even when your sugar is not very high — contact your doctor the same day.',
      ur: 'اگر الٹی ہو رہی ہو، کھانا نہ کھا پا رہے ہوں یا طبیعت بہت خراب ہو، تو شوگر زیادہ نہ ہونے پر بھی جسم میں خطرناک تیزابیت ہو سکتی ہے — اسی دن ڈاکٹر سے رابطہ کریں۔',
    },
    sources: [NHS('empagliflozin', 'Empagliflozin')],
  },
  {
    id: 'dapagliflozin', generic: 'Dapagliflozin', classId: 'sglt2',
    names: ['dapagliflozin', 'forxiga', 'xiga', 'dapxiga', 'forzi', 'ڈاپاگلیفلوزن'],
    brands: ['Xiga', 'Dapxiga', 'Forzi'],
    causesLows: false,
    purpose: { en: 'Makes your kidneys pass extra sugar out in your urine. It also protects the heart and kidneys.', ur: 'یہ گردوں کے ذریعے اضافی شوگر پیشاب میں نکال دیتی ہے۔ یہ دل اور گردوں کی حفاظت بھی کرتی ہے۔' },
    take: { en: 'Once a day at the same time, with or without food. Drink enough water.', ur: 'دن میں ایک بار روز ایک ہی وقت پر، کھانے کے ساتھ یا بغیر۔ پانی مناسب پیتے رہیں۔' },
    sideEffects: { en: 'Passing more urine, back pain, and itching or infection in the private area — keep the area clean and dry.', ur: 'پیشاب زیادہ آنا، کمر درد، اور شرم گاہ میں خارش یا انفیکشن — اس جگہ کو صاف اور خشک رکھیں۔' },
    missedDose: {
      en: 'Take it when you remember unless the next dose is less than 12 hours away — then skip it. Never take two doses together.',
      ur: 'یاد آنے پر لے لیں، لیکن اگر اگلی خوراک میں 12 گھنٹے سے کم ہوں تو چھوڑ دیں۔ کبھی دو خوراکیں ایک ساتھ نہ لیں۔',
    },
    warning: {
      en: 'If you are vomiting, have diarrhoea or a fever, or feel very thirsty, confused or unusually tired, contact your doctor the same day.',
      ur: 'اگر الٹی، دست یا بخار ہو، یا بہت پیاس، الجھن یا غیر معمولی تھکاوٹ ہو، تو اسی دن ڈاکٹر سے رابطہ کریں۔',
    },
    sources: [NHS('dapagliflozin', 'Dapagliflozin')],
  },
  {
    id: 'pioglitazone', generic: 'Pioglitazone', classId: 'tzd',
    names: ['pioglitazone', 'piotec', 'piog', 'piozon', 'پائیوگلیٹازون'],
    brands: ['Piotec', 'Piog'],
    causesLows: false,
    purpose: { en: 'Helps your body respond better to its own insulin.', ur: 'یہ جسم کو اپنی انسولین پر بہتر ردِعمل دینے میں مدد دیتی ہے۔' },
    take: { en: 'Once a day, with or without food.', ur: 'دن میں ایک بار، کھانے کے ساتھ یا بغیر۔' },
    sideEffects: { en: 'Weight gain and swelling of the ankles or legs from fluid.', ur: 'وزن بڑھنا اور پانی رکنے سے ٹخنوں یا ٹانگوں میں سوجن۔' },
    missedDose: SKIP_IF_CLOSE,
    warning: {
      en: 'Fast weight gain, swollen legs or getting breathless can mean fluid is building up around the heart — tell your doctor soon.',
      ur: 'وزن تیزی سے بڑھنا، ٹانگوں میں سوجن یا سانس پھولنا دل پر پانی کا اثر ہو سکتا ہے — جلد ڈاکٹر کو بتائیں۔',
    },
    sources: [{ title: 'US FDA label — Actos (pioglitazone), via DailyMed', url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=pioglitazone' }],
  },
  {
    id: 'insulin_premix', generic: 'Premixed insulin (70/30)', classId: 'insulin',
    names: ['mixtard', 'humulin 70/30', 'humulin', '70/30', 'مکسٹارڈ', 'ہیومولن'],
    brands: ['Mixtard 30', 'Humulin 70/30'],
    causesLows: true,
    purpose: { en: 'Replaces insulin your body cannot make enough of. It covers both meals and the time between them.', ur: 'یہ وہ انسولین پوری کرتی ہے جو جسم کافی نہیں بناتا۔ یہ کھانے اور کھانوں کے درمیان دونوں وقت کام کرتی ہے۔' },
    take: {
      en: 'Usually injected twice a day about 30 minutes before breakfast and dinner, as your doctor showed you. Roll the pen or vial gently to mix it, and change the injection spot each time.',
      ur: 'عام طور پر دن میں دو بار، ناشتے اور رات کے کھانے سے تقریباً آدھا گھنٹہ پہلے، جیسے ڈاکٹر نے سکھایا۔ لگانے سے پہلے پین یا شیشی کو آہستہ گھما کر ملائیں، اور ہر بار جگہ بدلیں۔',
    },
    sideEffects: { en: 'Low sugar (a "hypo"), some weight gain, and lumps if you inject in the same spot.', ur: 'شوگر کم ہو جانا، کچھ وزن بڑھنا، اور ایک ہی جگہ لگانے سے گلٹیاں۔' },
    missedDose: {
      en: 'Do not inject an extra dose to make up. Ask your doctor or diabetes nurse in advance what to do if you miss one, and check your sugar more often that day.',
      ur: 'کمی پوری کرنے کے لیے زیادہ انسولین نہ لگائیں۔ پہلے سے ڈاکٹر یا نرس سے پوچھ رکھیں کہ خوراک رہ جائے تو کیا کریں، اور اس دن شوگر زیادہ بار چیک کریں۔',
    },
    warning: {
      en: 'Never inject and then skip the meal. Keep unopened insulin in the fridge, never the freezer; the one in use can stay out of the sun at room temperature for the time on its leaflet.',
      ur: 'انسولین لگا کر کبھی کھانا نہ چھوڑیں۔ نئی انسولین فریج میں رکھیں، فریزر میں کبھی نہیں؛ جو استعمال میں ہو وہ دھوپ سے دور کمرے کے درجہ حرارت پر اتنے دن رکھ سکتے ہیں جتنے پرچے پر لکھے ہیں۔',
    },
    sources: [NHS('insulin', 'Insulin')],
  },
  {
    id: 'insulin_glargine', generic: 'Insulin glargine (long-acting)', classId: 'insulin',
    names: ['glargine', 'lantus', 'basaglar', 'toujeo', 'لینٹس', 'گلارجین'],
    brands: ['Lantus'],
    causesLows: true,
    purpose: { en: 'A slow, steady background insulin that works for about a day.', ur: 'یہ آہستہ اور مستقل کام کرنے والی انسولین ہے جو تقریباً ایک دن چلتی ہے۔' },
    take: { en: 'Once a day at the same time every day, as your doctor showed you. Change the injection spot each time.', ur: 'دن میں ایک بار، روز ایک ہی وقت پر، جیسے ڈاکٹر نے سکھایا۔ ہر بار لگانے کی جگہ بدلیں۔' },
    sideEffects: { en: 'Low sugar (a "hypo"), some weight gain, and lumps if you inject in the same spot.', ur: 'شوگر کم ہو جانا، کچھ وزن بڑھنا، اور ایک ہی جگہ لگانے سے گلٹیاں۔' },
    missedDose: {
      en: 'Do not inject an extra dose to make up. Ask your doctor or diabetes nurse in advance what to do if you miss one, and check your sugar more often that day.',
      ur: 'کمی پوری کرنے کے لیے زیادہ انسولین نہ لگائیں۔ پہلے سے ڈاکٹر یا نرس سے پوچھ رکھیں کہ خوراک رہ جائے تو کیا کریں، اور اس دن شوگر زیادہ بار چیک کریں۔',
    },
    warning: {
      en: 'Keep unopened insulin in the fridge, never the freezer; the pen in use can stay out of the sun at room temperature for the time on its leaflet.',
      ur: 'نئی انسولین فریج میں رکھیں، فریزر میں کبھی نہیں؛ جو پین استعمال میں ہو وہ دھوپ سے دور کمرے کے درجہ حرارت پر اتنے دن رکھ سکتے ہیں جتنے پرچے پر لکھے ہیں۔',
    },
    sources: [NHS('insulin', 'Insulin')],
  },
];

/** Combination tablets: one brand, two medicines. */
export const COMBINATIONS: { names: string[]; brand: string; contains: string[] }[] = [
  { names: ['treviamet', 'janumet'], brand: 'Treviamet', contains: ['sitagliptin', 'metformin'] },
  { names: ['galvus met', 'galvusmet'], brand: 'Galvus Met', contains: ['vildagliptin', 'metformin'] },
  { names: ['amaryl m', 'amaryl-m'], brand: 'Amaryl M', contains: ['glimepiride', 'metformin'] },
  { names: ['glio-p', 'glio p', 'pioryl-g', 'pioryl g', 'pioglance', 'steady-p', 'steady p'], brand: 'pioglitazone + glimepiride', contains: ['pioglitazone', 'glimepiride'] },
  { names: ['dapxiga m', 'dapxiga-m', 'xiga met', 'xigamet'], brand: 'Dapxiga M / Xiga Met', contains: ['dapagliflozin', 'metformin'] },
];

export const RAMZAN_SOURCE = IDF_DAR;

const byId = new Map(MEDICINES.map((m) => [m.id, m]));
export const medicine = (id: string) => byId.get(id);

export interface Identified {
  /** What the patient's record or words called it. */
  asNamed: string;
  /** Every medicine it contains (two for a combination tablet). */
  medicines: Medicine[];
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[()\[\],.;:]/g, ' ').replace(/\s+/g, ' ')} `;
const hit = (hay: string, name: string) =>
  /[a-z]/.test(name) ? new RegExp(`[^a-z]${name.replace(/[-/]/g, '[- /]?')}[^a-z]`).test(hay) : hay.includes(name);

/**
 * Which medicines does this text name? Combination brands are matched first so
 * "Galvus Met" is read as vildagliptin + metformin, not as Galvus alone.
 */
export function identify(text: string): Medicine[] {
  const hay = norm(text);
  const ids = new Set<string>();
  let rest = hay;
  for (const c of COMBINATIONS) {
    if (c.names.some((n) => hit(rest, n))) {
      c.contains.forEach((id) => ids.add(id));
      for (const n of c.names) rest = rest.split(n).join(' ');
    }
  }
  for (const m of MEDICINES) if (m.names.some((n) => hit(rest, n))) ids.add(m.id);
  return [...ids].map((id) => byId.get(id)!).filter(Boolean);
}

/** Identify each entry of a patient's medicine list, keeping the ones we cannot recognise visible. */
export function identifyList(entries: string[]): { known: Identified[]; unknown: string[] } {
  const known: Identified[] = [];
  const unknown: string[] = [];
  for (const e of entries) {
    const meds = identify(e);
    if (meds.length) known.push({ asNamed: e, medicines: meds });
    else if (e.trim()) unknown.push(e);
  }
  return { known, unknown };
}
