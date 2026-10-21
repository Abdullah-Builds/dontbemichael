/**
 * Company foundations (docs/designs/office-foundations.md): one document of
 * business agnostic questions, one section per job, each answered once for the
 * whole office. This catalog drives the record the app writes, the document it
 * publishes into company knowledge, each member's section and the count Pulse
 * shows, so the four never drift.
 *
 *   catalog ─► record (main/foundations.ts, the one writer) ─► document (company knowledge)
 *                │                                            ├─► member's section (hook)
 *                └─ telemetry events (harness.db) ─► Pulse count, strip and proof
 *
 * No product is named anywhere: a question asks what is true for this business.
 * No electron or node imports.
 */
import { departmentOf, type DepartmentSource } from './officeRoles';

/** The jobs a section is written for: the office's departments, less the
 *  general team pod. */
export const FOUNDATION_JOBS = ['sales', 'marketing', 'finance', 'support', 'front-desk', 'people', 'it', 'operations'] as const;
export type FoundationJob = typeof FOUNDATION_JOBS[number];

/** Each section's heading in the document agents read. */
export const JOB_TITLES: Record<FoundationJob, string> = {
  sales: 'Sales',
  marketing: 'Marketing',
  finance: 'Finance',
  support: 'Customer support',
  'front-desk': 'Front desk and admin',
  people: 'People',
  it: 'IT',
  operations: 'Operations'
};

export interface FoundationQuestion {
  /** The question as the document prints it. */
  text: string;
  /** A few words for "missing ..." lines. */
  short: string;
}

/** Every question, by id. A question two jobs share has one id, so one answer
 *  (owner, 2026-10-19). */
export const FOUNDATION_QUESTIONS = {
  offer: { text: 'What we sell', short: 'what we sell' },
  customers: { text: 'Who we sell to (ideal customer)', short: 'ideal customer' },
  sales_process: { text: 'How a sale happens, step by step', short: 'how a sale happens' },
  market: { text: 'Businesses, consumers or both', short: 'businesses or consumers' },
  deals: { text: 'Where leads and deals are kept', short: 'where deals are kept' },
  prices: { text: 'Prices and terms', short: 'prices and terms' },
  voice: { text: 'How we sound (brand voice)', short: 'brand voice' },
  brand: { text: 'How we look (logo, colors, fonts)', short: 'brand look' },
  current_customers: { text: 'Who our customers are today', short: 'customers today' },
  competitors: { text: 'Who we compete with, and how we differ', short: 'competitors' },
  accounting: { text: 'Accounting method (cash or accrual)', short: 'accounting method' },
  fiscal_year: { text: 'Financial year', short: 'financial year' },
  money: { text: 'Where money in and out is recorded', short: 'where money is recorded' },
  owed: { text: 'Who owes us and whom we owe, and where that is kept', short: 'who owes whom' },
  results: { text: 'Statements, budgets or targets', short: 'budgets and targets' },
  policies: { text: 'Refunds, returns and service promises', short: 'service policies' },
  hours: { text: 'Opening hours', short: 'opening hours' },
  faq: { text: 'Common customer questions and their answers', short: 'common questions' },
  team: { text: 'Who is on the team and who handles what', short: 'who handles what' },
  calendar: { text: 'Where meetings and bookings are kept', short: 'where bookings are kept' },
  hiring: { text: 'How we hire and welcome new people', short: 'how we hire' },
  tools: { text: 'The systems we work in, and who uses each', short: 'our systems' },
  access: { text: 'How passwords and access are handled', short: 'how access is handled' },
  suppliers: { text: 'Our suppliers and how we order', short: 'suppliers' },
  stock: { text: 'Where stock is tracked', short: 'where stock is tracked' },
  shipping: { text: 'How orders are packed and delivered', short: 'how orders are delivered' }
} as const satisfies Record<string, FoundationQuestion>;
export type FoundationId = keyof typeof FOUNDATION_QUESTIONS;

/** Each job's questions, in the order its section prints them. */
export const JOB_QUESTIONS: Record<FoundationJob, FoundationId[]> = {
  sales: ['offer', 'customers', 'sales_process', 'market', 'deals', 'prices'],
  marketing: ['customers', 'voice', 'brand', 'current_customers', 'offer', 'competitors'],
  finance: ['accounting', 'fiscal_year', 'money', 'owed', 'results'],
  support: ['offer', 'policies', 'hours', 'faq'],
  'front-desk': ['team', 'hours', 'calendar'],
  people: ['team', 'hiring'],
  it: ['tools', 'access'],
  operations: ['suppliers', 'stock', 'shipping']
};

/** An answer longer than this points to a file instead (about 300
 *  characters), so the document stays a few dozen lines. */
export const FOUNDATION_CAP = 300;

/** The tag on the Company foundations copy in company knowledge. */
export const FOUNDATIONS_TAG = 'foundations';

/** Whether a company knowledge document is the Company foundations copy. */
export function isFoundationsDoc(d: { tags?: unknown }): boolean {
  return Array.isArray(d.tags) && d.tags.includes(FOUNDATIONS_TAG);
}

/** An answer as one plain line: whitespace and line breaks collapse, and
 *  leading markdown marks go, so no answer can add a heading or a line to the
 *  context every member carries. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[#>*\-\s]+/, '').trim();
}

/** How long a draft request waits for its member before the card offers to
 *  ask again (2 days). */
export const DRAFT_WAIT_MS = 2 * 86_400_000;

/** A draft asked for, not yet back, and still within its wait. */
export function draftPending(d: { text?: string; requestedAt: string } | undefined, now: number): boolean {
  return !!d && !d.text && now - Date.parse(d.requestedAt) < DRAFT_WAIT_MS;
}

export function isFoundationId(id: unknown): id is FoundationId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FOUNDATION_QUESTIONS, id);
}

export function isFoundationJob(job: unknown): job is FoundationJob {
  return typeof job === 'string' && (FOUNDATION_JOBS as readonly string[]).includes(job);
}

/** A member's job, read like its studio department; null for the general
 *  team pod. */
export function jobOf(a: DepartmentSource): FoundationJob | null {
  const d = departmentOf(a);
  return isFoundationJob(d) ? d : null;
}

/** The jobs whose questions mention `id`. */
export function jobsAsking(id: FoundationId): FoundationJob[] {
  return FOUNDATION_JOBS.filter((j) => JOB_QUESTIONS[j].includes(id));
}

/** The questions of several jobs, once each, in section order. */
export function questionsFor(jobs: readonly FoundationJob[]): FoundationId[] {
  const out: FoundationId[] = [];
  for (const j of FOUNDATION_JOBS) {
    if (!jobs.includes(j)) continue;
    for (const q of JOB_QUESTIONS[j]) if (!out.includes(q)) out.push(q);
  }
  return out;
}

// ---- The record ---------------------------------------------------------------

/** Where an answer came from. `owner`: the owner's own words (an Ask me
 *  answer, or Michael citing a message the owner sent him); `profile`: the
 *  company profile; `file`: a file in the office folders; `michael`: outside
 *  text Michael checked and confirmed; `taught`: a member citing an owner
 *  message that reached it, which fills only an empty answer and Michael can
 *  replace. */
export type FoundationSourceKind = 'owner' | 'profile' | 'file' | 'michael' | 'taught';

export interface FoundationAnswer {
  text: string;
  /** Who gave it: 'owner', 'profile', or the member's id. */
  by: string;
  source: FoundationSourceKind;
  /** The message id or file path behind it, when there is one. */
  ref?: string;
  at: string;
}

/** Work that needed a question and found it empty. */
export interface FoundationHit {
  first: string;
  last: string;
  count: number;
  /** Members whose work hit it, first first. */
  by: string[];
  /** The latest member's line on what the work did without it. */
  evidence?: string;
  /** Michael has been told about it since it was last answered. */
  told?: boolean;
}

export interface FoundationDraft {
  by: string;
  requestedAt: string;
  text?: string;
  at?: string;
}

export interface FoundationsRecord {
  version: 1;
  answers: Partial<Record<FoundationId, FoundationAnswer>>;
  hits: Partial<Record<FoundationId, FoundationHit>>;
  drafts: Partial<Record<FoundationId, FoundationDraft>>;
  /** Not now: the card stays out of Needs you until this time. */
  snoozed: Partial<Record<FoundationId, string>>;
  /** The company knowledge copy now published, by document id. */
  publishedId?: string;
  /** The text last published, so a launch republishes only a change. */
  publishedText?: string;
}

export function emptyRecord(): FoundationsRecord {
  return { version: 1, answers: {}, hits: {}, drafts: {}, snoozed: {} };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const SOURCES: FoundationSourceKind[] = ['owner', 'profile', 'file', 'michael', 'taught'];

/** A record read from disk, keeping only well formed entries for known
 *  questions, so a hand edit or an older shape never breaks a reader. */
export function cleanRecord(raw: unknown): FoundationsRecord {
  const out = emptyRecord();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const each = (v: unknown, fn: (id: FoundationId, e: Record<string, unknown>) => void): void => {
    if (!v || typeof v !== 'object') return;
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) if (isFoundationId(id) && e && typeof e === 'object') fn(id, e as Record<string, unknown>);
  };
  each(r.answers, (id, e) => {
    const text = str(e.text), by = str(e.by), at = str(e.at);
    const source = SOURCES.includes(e.source as FoundationSourceKind) ? e.source as FoundationSourceKind : undefined;
    if (text && by && at && source) out.answers[id] = { text, by, source, at, ...(str(e.ref) ? { ref: e.ref as string } : {}) };
  });
  each(r.hits, (id, e) => {
    const first = str(e.first), last = str(e.last);
    const by = Array.isArray(e.by) ? e.by.filter((x): x is string => typeof x === 'string') : [];
    if (first && last) out.hits[id] = { first, last, count: typeof e.count === 'number' && e.count > 0 ? Math.floor(e.count) : 1, by, ...(str(e.evidence) ? { evidence: e.evidence as string } : {}), ...(e.told === true ? { told: true } : {}) };
  });
  each(r.drafts, (id, e) => {
    const by = str(e.by), requestedAt = str(e.requestedAt);
    if (by && requestedAt) out.drafts[id] = { by, requestedAt, ...(str(e.text) ? { text: e.text as string } : {}), ...(str(e.at) ? { at: e.at as string } : {}) };
  });
  if (r.snoozed && typeof r.snoozed === 'object') {
    for (const [id, until] of Object.entries(r.snoozed as Record<string, unknown>)) if (isFoundationId(id) && str(until)) out.snoozed[id] = until as string;
  }
  if (str(r.publishedId)) out.publishedId = r.publishedId as string;
  if (typeof r.publishedText === 'string') out.publishedText = r.publishedText;
  return out;
}

// ---- What agents read ------------------------------------------------------------

/** The document title in company knowledge. */
export const FOUNDATIONS_TITLE = 'Company foundations';

/** "Learned by Ryan, 19 Oct" style note on an answer the office learned. */
function answerNote(a: FoundationAnswer, nameOf: (id: string) => string): string {
  if (a.source === 'owner' || a.source === 'profile') return '';
  const day = new Date(a.at);
  const when = Number.isFinite(day.getTime()) ? `, ${day.getUTCDate()} ${day.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}` : '';
  return a.source === 'taught' ? ` (taught to ${nameOf(a.by)} by the owner${when})` : ` (learned by ${nameOf(a.by)}${when})`;
}

const line = (n: number, id: FoundationId, rec: FoundationsRecord, nameOf: (id: string) => string): string => {
  const a = rec.answers[id];
  return `${n}. ${FOUNDATION_QUESTIONS[id].text} [${id}]: ${a ? `${oneLine(a.text)}${answerNote(a, nameOf)}` : '<empty>'}`;
};

/** The whole document, a section per job the office has (every job when it
 *  has none yet). A shared question prints under each job, one answer. */
export function renderFoundations(rec: FoundationsRecord, jobs: readonly FoundationJob[], nameOf: (id: string) => string = (id) => id): string {
  const shown = FOUNDATION_JOBS.filter((j) => !jobs.length || jobs.includes(j));
  const out = [`# ${FOUNDATIONS_TITLE}`, '', 'What each job needs to know about this business. Each question is answered once for the whole office; a question two jobs share has one answer.'];
  for (const j of shown) {
    out.push('', `## ${JOB_TITLES[j]}`);
    JOB_QUESTIONS[j].forEach((id, i) => out.push(line(i + 1, id, rec, nameOf)));
  }
  return out.join('\n');
}

/** What a member carries in context: its jobs' sections, and which of its
 *  questions are empty. Null for a member with no job section. */
export function sectionFor(rec: FoundationsRecord, jobs: readonly FoundationJob[], nameOf: (id: string) => string = (id) => id): string | null {
  if (!jobs.length) return null;
  const out = ['COMPANY FOUNDATIONS for your job. Follow these answers; they hold for the whole office.'];
  for (const j of FOUNDATION_JOBS) {
    if (!jobs.includes(j)) continue;
    out.push('', `## ${JOB_TITLES[j]}`);
    JOB_QUESTIONS[j].forEach((id, i) => out.push(line(i + 1, id, rec, nameOf)));
  }
  const empty = questionsFor(jobs).filter((id) => !rec.answers[id]);
  out.push('', empty.length ? `Empty now: ${empty.join(', ')}.` : 'Every question of your job is answered.');
  return out.join('\n');
}

/** What Michael carries: the whole document, and which questions the work hit
 *  while empty. */
export function michaelFoundations(rec: FoundationsRecord, jobs: readonly FoundationJob[], nameOf: (id: string) => string = (id) => id): string {
  const hit = (Object.keys(rec.hits) as FoundationId[]).filter((id) => !rec.answers[id]);
  return [
    'COMPANY FOUNDATIONS. The whole document, as every member reads its own job\'s part.',
    '',
    renderFoundations(rec, jobs, nameOf),
    '',
    hit.length ? `Empty questions the work hit: ${hit.join(', ')}.` : 'No empty question has been hit by the work.'
  ].join('\n');
}

// ---- The count -------------------------------------------------------------------

export interface FoundationsCount {
  answered: number;
  total: number;
  /** The empty questions, in section order. */
  missing: FoundationId[];
}

/** Answered questions over all of the jobs' questions, each weighing the same
 *  (owner, 2026-10-19). A shared answer counts for every job that lists it. */
export function countFor(answered: ReadonlySet<string>, jobs: readonly FoundationJob[]): FoundationsCount {
  const all = questionsFor(jobs);
  const missing = all.filter((id) => !answered.has(id));
  return { answered: all.length - missing.length, total: all.length, missing };
}

// ---- From telemetry, for Pulse --------------------------------------------------

/** One foundations event in harness.db: a question answered, changed or
 *  cleared, or work that hit it while empty. */
export interface FoundationEvent { agentId: string | null; ts: number; q: string; change: 'answered' | 'changed' | 'cleared' | 'hit' }

/** The state the events add up to: when each question was answered (still
 *  answered now), and who hit which question. */
export interface FoundationsState {
  answeredAt: Map<FoundationId, number>;
  hits: Map<FoundationId, Map<string, number>>;
}

export function replayFoundations(events: readonly FoundationEvent[]): FoundationsState {
  const answeredAt = new Map<FoundationId, number>();
  const hits = new Map<FoundationId, Map<string, number>>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (!isFoundationId(e.q)) continue;
    if (e.change === 'answered' || e.change === 'changed') { if (!answeredAt.has(e.q)) answeredAt.set(e.q, e.ts); }
    else if (e.change === 'cleared') answeredAt.delete(e.q);
    else if (e.change === 'hit' && e.agentId) {
      const by = hits.get(e.q) ?? new Map<string, number>();
      by.set(e.agentId, (by.get(e.agentId) ?? 0) + 1);
      hits.set(e.q, by);
    }
  }
  return { answeredAt, hits };
}

/** One job on the strip: its count, and the questions its work hit that are
 *  still empty. */
export interface FoundationsJobRow { job: FoundationJob; answered: number; total: number; waiting: FoundationId[]; hits: number }

/** One member's count on Team at work and in its detail. */
export interface FoundationsMember {
  answered: number;
  total: number;
  /** Empty questions the member's work hit. */
  missing: FoundationId[];
  /** Empty questions no work has needed yet. */
  more: number;
  /** Kept as is before and after the questions its work hit were answered,
   *  once both sides have enough work. */
  proof?: { without: number; with: number; question: FoundationId };
}

export interface FoundationsPulse {
  jobs: FoundationsJobRow[];
  members: Record<string, FoundationsMember>;
}

/** The strip and the counts. The strip lists only jobs whose members' work hit
 *  a question that is still empty, the most hit first (design D4, D7); a member
 *  missing nothing has no entry (D9). */
export function foundationsPulse(state: FoundationsState, memberJobs: Record<string, FoundationJob[]>): FoundationsPulse {
  const answered = new Set<string>(state.answeredAt.keys());
  const jobs = new Map<FoundationJob, FoundationsJobRow>();
  const members: Record<string, FoundationsMember> = {};
  for (const [agentId, mine] of Object.entries(memberJobs)) {
    if (!mine.length) continue;
    const c = countFor(answered, mine);
    const hitByMe = c.missing.filter((id) => state.hits.get(id)?.has(agentId));
    if (c.missing.length) members[agentId] = { answered: c.answered, total: c.total, missing: hitByMe, more: c.missing.length - hitByMe.length };
    for (const job of mine) {
      for (const id of JOB_QUESTIONS[job]) {
        const n = state.hits.get(id)?.get(agentId) ?? 0;
        if (!n || answered.has(id)) continue;
        const jc = countFor(answered, [job]);
        const row = jobs.get(job) ?? { job, answered: jc.answered, total: jc.total, waiting: [], hits: 0 };
        if (!row.waiting.includes(id)) row.waiting.push(id);
        row.hits += n;
        jobs.set(job, row);
      }
    }
  }
  return { jobs: [...jobs.values()].sort((a, b) => b.hits - a.hits || FOUNDATION_JOBS.indexOf(a.job) - FOUNDATION_JOBS.indexOf(b.job)), members };
}

// ---- The foundation card (design D2, D8, D10) ----------------------------------

/** The question a foundation card asks: a humanQA entry Michael wrote with
 *  "kind": "foundation" and the question id, or null for any other ask. */
export function foundationAsk(e: { kind?: unknown; foundation?: unknown } | null | undefined): FoundationId | null {
  return e && e.kind === 'foundation' && isFoundationId(e.foundation) ? e.foundation : null;
}

/** Whether Not now still hides a question (until its time passes). */
export function isSnoozed(snoozed: Partial<Record<string, string>> | undefined, id: string, now: number): boolean {
  const until = snoozed?.[id];
  return !!until && Date.parse(until) > now;
}

/** What the renderer reads of the record. */
export type FoundationsView = Pick<FoundationsRecord, 'answers' | 'drafts' | 'snoozed' | 'hits'>;

/** The one time "Company knowledge is always on" card is due: the owner had
 *  turned the old switch off, has not read the card, and keeps documents of
 *  their own in the store (the Company foundations copy is the app's). */
export function knowledgeNoticeDue(enabled: boolean | undefined, seen: boolean | undefined, docs: ReadonlyArray<{ tags?: unknown }> | (() => ReadonlyArray<{ tags?: unknown }>)): boolean {
  // The documents are read only when the rest says the notice could be due.
  return enabled === false && !seen && (typeof docs === 'function' ? docs() : docs).some((d) => !isFoundationsDoc(d));
}
