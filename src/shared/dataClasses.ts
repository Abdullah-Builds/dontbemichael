/**
 * The data privacy layer (issue #230, docs/designs/research-agent-privacy.md):
 * the kinds of data the owner lets the team send to Research, the one team
 * member who uses the internet. Each class is Allowed or Private; the seeded
 * defaults allow the common safe kinds and keep the sensitive ones in.
 * Passwords and keys are always private.
 *
 * Pure: no fs, no electron, so the guard, the Settings page and the tests share
 * it. The order is fixed and never re-sorted (design review D4).
 */

export type DataClassId =
  | 'places'
  | 'industry'
  | 'dates'
  | 'general'
  | 'names'
  | 'contact'
  | 'companies'
  | 'money'
  | 'accounts'
  | 'health'
  | 'quoted'
  | 'secrets';

export type DataClassSetting = 'allowed' | 'private';

export interface DataClass {
  id: DataClassId;
  /** The class as the guard's prompt names it. */
  label: string;
  /** What it covers, for the guard's prompt (the UI has its own words). */
  examples: string;
  /** How the class reads in a refusal: "it contains {phrase}". */
  phrase: string;
  defaultSetting: DataClassSetting;
  /** Always private; the owner cannot allow it. */
  locked?: boolean;
}

export const DATA_CLASSES: readonly DataClass[] = [
  { id: 'places', label: 'Places', examples: 'countries, regions, cities, time zones', phrase: 'a place', defaultSetting: 'allowed' },
  { id: 'industry', label: 'Industry and market topics', examples: 'product types, trends, regulations, standards', phrase: 'a market topic', defaultSetting: 'allowed' },
  { id: 'dates', label: 'Dates and general timing', examples: 'next quarter, holidays, deadlines in general', phrase: 'a date', defaultSetting: 'allowed' },
  { id: 'general', label: 'General questions', examples: 'how to, definitions, reference facts', phrase: 'a general question', defaultSetting: 'allowed' },
  { id: 'names', label: "People's names", examples: 'customers, staff, contacts', phrase: "a person's name", defaultSetting: 'private' },
  { id: 'contact', label: 'Contact details', examples: 'emails, phone numbers, street addresses', phrase: 'contact details', defaultSetting: 'private' },
  { id: 'companies', label: 'Company and brand names', examples: 'customers, suppliers, competitors, any named business', phrase: 'a company or brand name', defaultSetting: 'private' },
  { id: 'money', label: 'Money', examples: 'the business\'s prices, invoices, revenue, bank and card details', phrase: 'money details', defaultSetting: 'private' },
  { id: 'accounts', label: 'Account numbers and IDs', examples: 'customer IDs, order numbers, government IDs', phrase: 'an account number or ID', defaultSetting: 'private' },
  { id: 'health', label: 'Health and personal life', examples: 'medical, family, personal circumstances', phrase: 'health or personal details', defaultSetting: 'private' },
  { id: 'quoted', label: 'Text from your files and email', examples: 'quoted passages from documents or messages', phrase: 'text from the owner\'s files or email', defaultSetting: 'private' },
  { id: 'secrets', label: 'Passwords and keys', examples: 'logins, API keys, tokens', phrase: 'a password or key', defaultSetting: 'private', locked: true }
];

const BY_ID = new Map(DATA_CLASSES.map((c) => [c.id, c]));

export function isDataClassId(v: unknown): v is DataClassId {
  return typeof v === 'string' && BY_ID.has(v as DataClassId);
}

export type DataClassSettings = Record<DataClassId, DataClassSetting>;

/** The owner's choices over the seeded defaults. Unknown keys and values are
 *  ignored; a locked class is private whatever is stored. */
export function dataClassSettings(overrides: unknown): DataClassSettings {
  const out = {} as DataClassSettings;
  const o = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>) : {};
  for (const c of DATA_CLASSES) {
    const v = o[c.id];
    out[c.id] = c.locked ? 'private' : v === 'allowed' || v === 'private' ? v : c.defaultSetting;
  }
  return out;
}

/** What the owner saves: only the classes that differ from their default,
 *  so a later change to a default reaches offices that never touched it. */
export function cleanDataClassOverrides(value: unknown): Partial<Record<DataClassId, DataClassSetting>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const s = dataClassSettings(value);
  const out: Partial<Record<DataClassId, DataClassSetting>> = {};
  for (const c of DATA_CLASSES) if (!c.locked && s[c.id] !== c.defaultSetting) out[c.id] = s[c.id];
  return out;
}

export function allowedCount(s: DataClassSettings): { allowed: number; private: number } {
  let allowed = 0;
  for (const c of DATA_CLASSES) if (s[c.id] === 'allowed') allowed++;
  return { allowed, private: DATA_CLASSES.length - allowed };
}

export function classPhrase(id: DataClassId): string {
  return BY_ID.get(id)?.phrase ?? 'private details';
}

export interface PatternHit { classId: DataClassId }

/** Luhn check for a card number. */
function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const isCard = (digits: string): boolean => digits.length >= 13 && digits.length <= 19 && luhn(digits);
/** How card numbers start: Visa 4, Mastercard 51 to 55 and 22 to 27, Amex 34
 *  and 37, Diners 30, 36 and 38, JCB 35, Discover 6011 and 65, UnionPay 62.
 *  Lists of round numbers and years mostly start otherwise, so they are not
 *  read as a card (owner review: a list of price tiers read as one). */
const CARD_START = /^(?:4|5[1-5]|2[2-7]|3[04-8]|6011|6[25])/;

/**
 * Whether a run of digit groups holds a card number: the whole run, one solid
 * group, or groups printed the way cards are (four digits that start like a
 * card, then groups of four to six, the last of any length). Reading only the
 * whole run missed a card written next to its expiry, its security code or
 * another number ("4111 1111 1111 1111 12/27"): the extra digits failed the
 * Luhn check.
 */
function hasCard(run: string): boolean {
  const groups = run.split(/[ -]/);
  if (isCard(groups.join(''))) return true;
  for (let i = 0; i < groups.length; i++) {
    if (isCard(groups[i])) return true;
    if (groups[i].length !== 4 || !CARD_START.test(groups[i])) continue;
    let digits = groups[i];
    for (let j = i + 1; j < groups.length && digits.length < 19; j++) {
      digits += groups[j];
      if (isCard(digits)) return true;
      // A group outside four to six digits can only end a card.
      if (groups[j].length < 4 || groups[j].length > 6) break;
    }
  }
  return false;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// A phone number: an optional +country code, then 9 to 15 digits in groups.
const PHONE = /(?:^|[^\w])(\+?\d[\d\s().-]{7,}\d)(?![\w])/g;
// Digit groups joined by one space or hyphen: "4111 1111 1111 1111 12/27".
const DIGIT_RUN = /\d+(?:[ -]\d+)*/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/;
const US_SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const SECRETS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|pwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{6,}/i
];
const LONG_DIGITS = /\b\d{9,}\b/;

/**
 * The private data fixed patterns can see, each tied to its class so a
 * refusal names it. Patterns catch only what has a shape (an email, a card
 * number, a key); names and quoted text are left to the AI check.
 */
export function patternHits(text: string): PatternHit[] {
  const hits: PatternHit[] = [];
  // Fullwidth forms and invisible characters must not hide a shape (ship
  // review: an sk- key with a zero width space, a joiner or a Hangul filler
  // inside passed as plain text).
  const t = typeof text === 'string' ? text.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '') : '';
  if (SECRETS.some((re) => re.test(t))) hits.push({ classId: 'secrets' });
  if (EMAIL.test(t)) hits.push({ classId: 'contact' });
  for (const m of t.matchAll(DIGIT_RUN)) {
    if (hasCard(m[0])) { hits.push({ classId: 'money' }); break; }
  }
  if (IBAN.test(t)) hits.push({ classId: 'accounts' });
  if (US_SSN.test(t)) hits.push({ classId: 'accounts' });
  // Shapes that look like digits but are not contact details: dates and
  // times, lists of years, book numbers (ship review: plain questions were
  // refused as phone numbers).
  const plain = t
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b/g, ' ')
    .replace(/\b(?:ISBN(?:-1[03])?:?\s*)?97[89][- ]?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?[\dX]\b/gi, ' ')
    .replace(/\b(?:(?:19|20)\d{2}[\s,]+)+(?:19|20)\d{2}\b/g, ' ');
  for (const m of plain.matchAll(PHONE)) {
    const digits = m[1].replace(/\D/g, '');
    // Years, prices and plain counts are not phone numbers: a phone has 9 to
    // 15 digits and either a + or a separator inside it.
    if (digits.length >= 9 && digits.length <= 15 && (/^\+/.test(m[1]) || /[\s().-]/.test(m[1])) && !/\d\.\d{3}\.\d{3}/.test(m[1])) {
      hits.push({ classId: 'contact' });
      break;
    }
  }
  if (LONG_DIGITS.test(plain) && !hits.some((h) => h.classId === 'money' || h.classId === 'accounts')) {
    hits.push({ classId: 'accounts' });
    // A bare run of phone length may be a phone number too.
    if (/\b\d{9,15}\b/.test(plain) && !hits.some((h) => h.classId === 'contact')) hits.push({ classId: 'contact' });
  }
  return hits;
}

/** The first pattern hit on a class the owner keeps private, or null. */
export function privatePatternHit(text: string, settings: DataClassSettings): PatternHit | null {
  return patternHits(text).find((h) => settings[h.classId] === 'private') ?? null;
}
