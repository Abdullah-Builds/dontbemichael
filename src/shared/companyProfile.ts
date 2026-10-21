/**
 * The company profile (owner, 2026-09-25): key facts about the business, each
 * with a short, definite answer, that every agent (Michael included) gets as
 * context. No open ended text: mission, product lists, ideal customers, selling
 * approach, policies and the like are documents, uploaded to company knowledge.
 *
 * Fields follow the standard ways a business is described (schema.org's
 * Organization and LocalBusiness, and Google Business Profile). Tax ids and
 * bank details are deliberately absent: every agent would see them.
 *
 * Pure data and pure functions, shared by setup, Settings and the hook that
 * delivers the profile to agents.
 */

export interface CompanyAddress {
  street?: string;
  city?: string;
  /** State, province or region. */
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface CompanyProfile {
  ceo?: string;
  address?: CompanyAddress;
  website?: string;
  /** The industry in the owner's words, asked only when no business type fits. */
  industry?: string;
  legalName?: string;
  entityType?: EntityType;
  phone?: string;
  email?: string;
  /** Social media profile links, one each. */
  social?: string[];
  /** Opening hours, e.g. "Mon to Fri 9am to 5pm". */
  hours?: string;
  /** IANA time zone, e.g. "America/Los_Angeles". */
  timeZone?: string;
  serviceArea?: ServiceArea;
  /** Languages customers are served in, e.g. "English, Spanish". */
  languages?: string;
  /** ISO 4217 code, e.g. "USD". */
  currency?: string;
  /** 1 (January) to 12. */
  fiscalYearStartMonth?: number;
}

export const ENTITY_TYPES = ['sole-proprietor', 'partnership', 'llc', 'corporation', 'nonprofit', 'other'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const SERVICE_AREAS = ['local', 'regional', 'national', 'international'] as const;
export type ServiceArea = typeof SERVICE_AREAS[number];

/** How each choice reads to an agent. Agent text is English (DESIGN.md 7.11). */
const ENTITY_WORDS: Record<EntityType, string> = {
  'sole-proprietor': 'sole proprietor',
  partnership: 'partnership',
  llc: 'LLC',
  corporation: 'corporation',
  nonprofit: 'nonprofit',
  other: 'other'
};
const AREA_WORDS: Record<ServiceArea, string> = {
  local: 'one city or town',
  regional: 'a region or state',
  national: 'the whole country',
  international: 'customers worldwide'
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MAX_FIELD = 200;
const MAX_SOCIAL = 5;

const clean = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD);
  return s || undefined;
};

/** A profile from anywhere (config, office.json, a form), with junk dropped. */
/** Setup step 2 starts the legal name from the step 1 business name. It keeps
 *  following the business name while it is empty or still the value we filled
 *  in last time (`lastFilled`); once the owner types their own, it is theirs. */
export function prefillLegalName(
  profile: CompanyProfile,
  businessName: string,
  lastFilled: string | undefined
): { profile: CompanyProfile; filled: string | undefined } {
  const name = businessName.trim();
  const current = profile.legalName;
  const ours = !current || current === lastFilled;
  if (!name || !ours || current === name) return { profile, filled: ours ? current : lastFilled };
  return { profile: { ...profile, legalName: name }, filled: name };
}

export function cleanCompanyProfile(raw: unknown): CompanyProfile {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const a = (o.address && typeof o.address === 'object' ? o.address : {}) as Record<string, unknown>;
  const address: CompanyAddress = {
    street: clean(a.street), city: clean(a.city), region: clean(a.region),
    postalCode: clean(a.postalCode), country: clean(a.country)
  };
  const month = typeof o.fiscalYearStartMonth === 'number' && Number.isInteger(o.fiscalYearStartMonth)
    && o.fiscalYearStartMonth >= 1 && o.fiscalYearStartMonth <= 12 ? o.fiscalYearStartMonth : undefined;
  const social = Array.isArray(o.social)
    ? o.social.map(clean).filter((s): s is string => !!s).slice(0, MAX_SOCIAL)
    : [];
  const out: CompanyProfile = {
    ceo: clean(o.ceo),
    address: Object.values(address).some(Boolean) ? stripUndefined(address) : undefined,
    website: clean(o.website),
    industry: clean(o.industry),
    legalName: clean(o.legalName),
    entityType: (ENTITY_TYPES as readonly string[]).includes(o.entityType as string) ? o.entityType as EntityType : undefined,
    phone: clean(o.phone),
    email: clean(o.email),
    social: social.length ? social : undefined,
    hours: clean(o.hours),
    timeZone: clean(o.timeZone),
    serviceArea: (SERVICE_AREAS as readonly string[]).includes(o.serviceArea as string) ? o.serviceArea as ServiceArea : undefined,
    languages: clean(o.languages),
    currency: clean(o.currency)?.toUpperCase(),
    fiscalYearStartMonth: month
  };
  return stripUndefined(out);
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** The fields setup can't continue without (owner, 2026-09-25). */
export type RequiredProfileField = 'ceo' | 'street' | 'city' | 'country' | 'industry';

/**
 * What the profile still needs. The business name and type are checked by
 * businessProfile.ts; the industry line is needed only when no business type
 * fits ("Something else").
 */
export function missingProfileFields(p: CompanyProfile, needsIndustry: boolean): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];
  if (!p.ceo) missing.push('ceo');
  if (!p.address?.street) missing.push('street');
  if (!p.address?.city) missing.push('city');
  if (!p.address?.country) missing.push('country');
  if (needsIndustry && !p.industry) missing.push('industry');
  return missing;
}

/** "Mountain View, CA": the city line older parts of the app still read (businessCity). */
export function cityLine(a: CompanyAddress | undefined): string | undefined {
  const parts = [a?.city, a?.region].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/** The address on one line. */
export function addressLine(a: CompanyAddress | undefined): string | undefined {
  if (!a) return undefined;
  const regionPostal = [a.region, a.postalCode].filter(Boolean).join(' ');
  const parts = [a.street, a.city, regionPostal, a.country].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * The profile as agents read it: facts from the owner, one per line, only the
 * fields that are filled in, and a pointer to company knowledge for everything
 * that isn't a short fact. Null when there is nothing to say.
 */
export function companyProfileContext(
  business: { name?: string; industry?: string },
  p: CompanyProfile
): string | null {
  const lines: string[] = [];
  const add = (label: string, value: string | undefined) => { if (value) lines.push(`${label}: ${value}`); };
  add('Business name', business.name);
  if (p.legalName && p.legalName !== business.name) add('Legal name', p.legalName);
  if (p.entityType) add('Business type', ENTITY_WORDS[p.entityType]);
  add('Industry', p.industry ?? business.industry);
  add('CEO', p.ceo);
  add('Headquarters', addressLine(p.address));
  add('Website', p.website);
  add('Main phone', p.phone);
  add('Public email', p.email);
  if (p.social?.length) add('Social media', p.social.join(', '));
  add('Business hours', p.hours);
  add('Time zone', p.timeZone);
  if (p.serviceArea) add('Serves', AREA_WORDS[p.serviceArea]);
  add('Languages served', p.languages);
  add('Currency', p.currency);
  if (p.fiscalYearStartMonth) add('Financial year starts', MONTHS[p.fiscalYearStartMonth - 1]);
  if (lines.length === 0) return null;
  return [
    'COMPANY PROFILE. Facts the owner entered about this business; use them as they are.',
    ...lines,
    'Everything else about the company (products and prices, ideal customers, how it sells, policies) is in the company knowledge store.'
  ].join('\n');
}

/**
 * A profile page's save on top of the latest profile: only the fields the
 * owner changed since the page opened are taken from the page, so a page left
 * open never undoes a newer answer (Company foundations writes opening hours
 * and the financial year into the profile; review, 2026-10-20).
 */
export function mergeEditedProfile(opened: CompanyProfile, edited: CompanyProfile, latest: CompanyProfile): CompanyProfile {
  return cleanCompanyProfile(mergeEdits(opened, edited, latest));
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Field by field, inside nested parts too (the address, social links), so
 *  two pages that changed different lines of the address both keep theirs. */
function mergeEdits(opened: unknown, edited: unknown, latest: unknown): Record<string, unknown> {
  const was = isPlain(opened) ? opened : {};
  const now = isPlain(edited) ? edited : {};
  const out: Record<string, unknown> = { ...(isPlain(latest) ? latest : {}) };
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[k]) === JSON.stringify(now[k])) continue;
    if (now[k] === undefined) delete out[k];
    else if (isPlain(now[k]) && isPlain(was[k])) out[k] = mergeEdits(was[k], now[k], out[k]);
    else out[k] = now[k];
  }
  return out;
}
