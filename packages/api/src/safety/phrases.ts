/**
 * Fixed Urdu phrases. Everything safety-critical the app says out loud comes
 * from this table, never from a live model, and each entry is rendered once
 * to a cached audio clip (see clips.ts) so an emergency reply does not depend
 * on a network call to a TTS provider.
 */

import { RULES } from './rules.ts';

export interface Phrase {
  ur: string;
  en: string;
}

const EXTRA: Record<string, Phrase> = {
  welcome: {
    ur: 'السلام علیکم! میں صحت ساتھی ہوں۔ بٹن دبا کر رکھیں اور بتائیں آج شوگر کتنی تھی یا طبیعت کیسی ہے۔',
    en: 'Hello! I am SehatSaathi. Hold the button and tell me your sugar or how you feel.',
  },
  didnt_catch: {
    ur: 'معاف کیجیے، میں سمجھ نہیں سکی۔ براہِ کرم دوبارہ آہستہ بولیں۔',
    en: 'Sorry, I did not catch that. Please say it again slowly.',
  },
  error: {
    ur: 'معاف کیجیے، ابھی کچھ مسئلہ ہو گیا ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔ اگر طبیعت خراب ہے تو 1122 پر کال کریں۔',
    en: 'Sorry, something went wrong. Try again shortly. If you feel unwell, call 1122.',
  },
  caregiver_notified: {
    ur: 'میں نے آپ کے گھر والوں کو اطلاع بھیج دی ہے۔',
    en: 'I have notified your family contact.',
  },
  refusal_dose: {
    ur: 'دوا کی مقدار بدلنا صرف آپ کے ڈاکٹر کا فیصلہ ہے۔ میں آپ کی بات ان تک پہنچانے میں مدد کر سکتی ہوں۔',
    en: 'Changing a dose is your doctor’s decision. I can help you take this to them.',
  },
};

/** rule phraseKey -> phrase, plus the extras above. */
export const PHRASES: Record<string, Phrase> = {
  ...Object.fromEntries(RULES.map((r) => [r.phraseKey, { ur: r.reasonUr, en: r.reasonEn }])),
  ...EXTRA,
};

export function phrase(key: string): Phrase {
  return PHRASES[key] ?? EXTRA.error!;
}
