/**
 * Patient-app strings in Urdu and English.
 *
 * Urdu is the default because that is who the product is for. English exists
 * because plenty of Pakistani patients — especially younger ones, and the
 * family members who set the app up for a parent — read English more
 * comfortably, and because a demo audience needs to follow along.
 *
 * The choice also changes the language the agent replies in, and the voice it
 * is spoken with, not just the labels.
 */

import { getLang, type Lang } from './api.ts';

const UR = {
  holdToTalk: 'دبا کر رکھیں اور بولیں',
  listening: 'سن رہی ہوں…',
  thinking: 'سوچ رہی ہوں…',
  speaking: 'بول رہی ہوں…',
  connecting: 'جڑ رہا ہے…',
  tryAgain: 'دوبارہ کوشش کریں',
  hintLead: 'بٹن دبا کر رکھیں اور بتائیں:',
  hintExample: '«آج شوگر دو سو پچاس تھی، چکر آ رہے ہیں»',
  listen: '🔊 صحت ساتھی کو سنیں',
  typeInstead: 'لکھ کر بتائیں',
  close: 'بند کریں',
  typeHere: 'یہاں لکھیں…',
  send: 'بھیجیں',
  noTts: 'آواز فون کی اپنی ہے (سرور پر اردو آواز سیٹ نہیں)',
  error: 'خرابی',
  urgent: '⚠️ فوری توجہ',
  call1122: '📞 1122 پر کال کریں',
  waFamily: '💬 گھر والوں کو واٹس ایپ کریں',
  ok: 'ٹھیک ہے',
  tabTalk: 'بات کریں',
  tabRecord: 'ریکارڈ',
  tabMemory: 'یادداشت',
  recordTitle: 'شوگر کا ریکارڈ',
  loading: 'لوڈ ہو رہا ہے…',
  notEnough: 'ابھی کافی ریڈنگز نہیں',
  legendLow: '70 سے کم',
  legendOk: '70–180',
  legendHigh: '180–250',
  legendVHigh: '250 سے زیادہ',
  memoryTitle: 'میں آپ کے بارے میں کیا جانتی ہوں',
  memoryCount: (f: number, e: number) => `${f} باتیں یاد ہیں · ${e} گفتگو محفوظ`,
  concernsTitle: 'جن باتوں کا پوچھنا ہے',
  resolved: 'حل ہو گیا',
  since: 'سے',
  confidence: (p: number) => `${p}٪ یقین`,
  changedBefore: 'پہلے کچھ اور تھا',
  youSaidOn: (d: string) => `${d} کو آپ نے کہا:`,
  showOld: (n: number) => `پرانی باتیں دیکھیں (${n})`,
  hideOld: 'پرانی باتیں چھپائیں',
  changedLater: 'بعد میں بدل گیا',
  patient: 'مریض',
  demoPatient: 'ڈیمو مریض (راشدہ بی بی)',
  newPatient: 'نیا مریض شروع کریں',
  langLabel: 'English',
  medsTaken: 'دوا لی',
  medsMissed: 'دوا رہ گئی',
} as const;

const EN: Record<keyof typeof UR, unknown> = {
  holdToTalk: 'Hold the button and speak',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  connecting: 'Connecting…',
  tryAgain: 'Try again',
  hintLead: 'Hold the button and tell me:',
  hintExample: '“My sugar was 250 today and I feel dizzy”',
  listen: '🔊 Hear SehatSaathi',
  typeInstead: 'Type instead',
  close: 'Close',
  typeHere: 'Type here…',
  send: 'Send',
  noTts: 'Using your phone’s voice (no Urdu voice set on the server)',
  error: 'Error',
  urgent: '⚠️ Urgent',
  call1122: '📞 Call 1122',
  waFamily: '💬 WhatsApp your family',
  ok: 'OK',
  tabTalk: 'Talk',
  tabRecord: 'Record',
  tabMemory: 'Memory',
  recordTitle: 'Your sugar record',
  loading: 'Loading…',
  notEnough: 'Not enough readings yet',
  legendLow: 'Below 70',
  legendOk: '70–180',
  legendHigh: '180–250',
  legendVHigh: 'Above 250',
  memoryTitle: 'What I know about you',
  memoryCount: (f: number, e: number) => `${f} things remembered · ${e} conversations stored`,
  concernsTitle: 'Things I want to ask about',
  resolved: 'Resolved',
  since: 'since',
  confidence: (p: number) => `${p}% confident`,
  changedBefore: 'was different before',
  youSaidOn: (d: string) => `On ${d} you said:`,
  showOld: (n: number) => `Show earlier versions (${n})`,
  hideOld: 'Hide earlier versions',
  changedLater: 'changed later',
  patient: 'Patient',
  demoPatient: 'Demo patient (Rashida Bibi)',
  newPatient: 'Start a new patient',
  langLabel: 'اردو',
  medsTaken: 'Medicine taken',
  medsMissed: 'Medicine missed',
};

type Dict = typeof UR;

export function t(): Dict {
  return (getLang() === 'en' ? (EN as unknown as Dict) : UR);
}

export function dir(): 'rtl' | 'ltr' {
  return getLang() === 'en' ? 'ltr' : 'rtl';
}

export function lang(): Lang {
  return getLang();
}
