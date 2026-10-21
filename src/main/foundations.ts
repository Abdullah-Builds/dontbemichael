/**
 * Company foundations' one writer (docs/designs/office-foundations.md, eng
 * review): the record lives in the app's private folder, out of every member's
 * reach, and only this class writes it. Members reach it through the hive
 * route `foundations`; the owner through the foundation card.
 *
 *   member ─(answer + source | gap | draft)─► handle()
 *     ├─ source checked: an owner message the app kept as sent to the sender, or a file in the
 *     │  office folders; Michael's confirmation; anything else goes to Michael
 *     ├─ fill only empty, owner wins, cap, a clash goes to Michael
 *     ├─ a gap kept once per question, the first one told to Michael
 *     ├─ foundations.json ─► telemetry event (harness.db, Pulse)
 *     ├─ company profile kept in step (owner wins)
 *     └─ publish soon ─► the Company foundations copy in company knowledge
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { privateRoot } from '../shared/agentPrivatePaths';
import { writeFileAtomic } from './atomicFile';
import {
  FOUNDATION_CAP, FOUNDATION_QUESTIONS, FOUNDATIONS_TAG, FOUNDATIONS_TITLE, cleanRecord, emptyRecord, isFoundationId, isFoundationsDoc, oneLine, questionsFor, renderFoundations,
  type FoundationAnswer, type FoundationId, type FoundationJob, type FoundationSourceKind, type FoundationsRecord, type FoundationsView
} from '../shared/foundations';

/** The profile facts the foundations share (one set of facts, eng finding 6). */
export interface ProfileFacts { hours?: string; fiscalYearStartMonth?: number }

export interface FoundationsDeps {
  /** The office's data folder; null while no office is open. */
  home: () => string | null;
  now?: () => number;
  /** One telemetry event per change (harness.db, eng finding 4). */
  record?: (ev: { agentId: string | null; kind: 'foundation'; ts: number; attrs: Record<string, unknown> }) => void;
  /** Publish the document into company knowledge, replacing the old copy;
   *  returns the new document id. A throw keeps the record and retries later. */
  publish?: (text: string, oldId: string | undefined) => string | undefined;
  /** The jobs the office has, for which sections the document prints. */
  jobs?: () => FoundationJob[];
  nameOf?: (id: string) => string;
  godId?: () => string | null;
  profile?: () => ProfileFacts;
  setProfile?: (patch: ProfileFacts) => void;
  /** Whether a message with this id came from the owner and reached this
   *  member (the owner's private list, never the shared hive log). */
  ownerSaid?: (messageId: string, recipient: string) => boolean;
  /** A member's jobs: a gap counts only for its own job's questions. */
  jobsOf?: (agentId: string) => FoundationJob[];
  /** Whether a published copy is still in company knowledge. */
  exists?: (docId: string) => boolean;
  /** Whether a path is a file inside the office folders this member can read. */
  inOffice?: (path: string, agentId: string) => boolean;
  /** An app message to a member or Michael, sent as `foundations`. */
  tell?: (to: string, subject: string, body: string) => void;
  /** The record changed (the renderer refreshes). */
  changed?: () => void;
  /** Delay before a change is published, so a burst publishes once. */
  publishDelayMs?: number;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthName = (m: number): string => MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1);

/** The profile fields a question shares, both ways. */
const PROFILE_LINKS: Array<{ id: FoundationId; read: (p: ProfileFacts) => string | undefined; write: (text: string) => ProfileFacts | null }> = [
  {
    id: 'hours',
    read: (p) => (typeof p.hours === 'string' && p.hours.trim() ? p.hours.trim() : undefined),
    write: (text) => ({ hours: text.slice(0, 200) })
  },
  {
    id: 'fiscal_year',
    read: (p) => (typeof p.fiscalYearStartMonth === 'number' && p.fiscalYearStartMonth >= 1 && p.fiscalYearStartMonth <= 12 ? `Starts in ${monthName(p.fiscalYearStartMonth)}` : undefined),
    write: (text) => {
      const month = firstMonth(text);
      return month ? { fiscalYearStartMonth: month } : null;
    }
  }
];

/** The month a financial year answer starts in: the one after "starts",
 *  "begins" or "from" ("ends in March, starts in April" is April), else the
 *  first month the text names, in its order ("July to June" and "Jul to Jun"
 *  are July; "calendar year" is January). "May" and "Mar" count only
 *  capitalized, so the words "may" and "mar" never read as months. */
export function firstMonth(text: string): number | null {
  for (const m of text.matchAll(/\b(?:starts?|starting|begins?|beginning|from)\b/gi)) {
    // To the end of its clause ("starts on the first business day of April").
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/[.;\n]/);
    const after = end === -1 ? rest : rest.slice(0, end);
    const month = earliestMonth(after);
    if (month) return month;
  }
  return earliestMonth(text);
}

function earliestMonth(text: string): number | null {
  let best: { at: number; month: number } | null = null;
  const take = (re: RegExp, month: number): void => {
    const hit = re.exec(text);
    if (hit && (!best || hit.index < best.at)) best = { at: hit.index, month };
  };
  MONTHS.forEach((m, i) => {
    const short = m === 'september' ? 'sept?' : m.slice(0, 3);
    if (m === 'may') take(/\bMay\b/, 5);
    else if (m === 'march') { take(/\bmarch\b/i, 3); take(/\bMar\b/, 3); }
    else take(new RegExp(`\\b(${m}|${short})\\b`, 'i'), i + 1);
  });
  take(/\bcalendar year\b/i, 1);
  return best ? (best as { month: number }).month : null;
}

/** What Michael is told when a question with a gap is answered off its card. */
const CLOSE_CARD = 'If a foundation card for it is open, close it as done.';

const same = (a: string, b: string): boolean => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** What a member sends to `foundations`, as `"foundation": {...}`. */
export interface FoundationPayload {
  question?: unknown;
  answer?: unknown;
  gap?: unknown;
  draft?: unknown;
  source?: unknown;
}

/** How sure the app is of an answer's source, strongest first: the owner's
 *  words through Michael, Michael's confirmation, the owner's words a member
 *  was taught (fills only an empty answer), a file in the office folders. */
type Level = 'owner' | 'michael' | 'taught' | 'file';

export class Foundations {
  private cache: { home: string; rec: FoundationsRecord } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: FoundationsDeps) {}

  private now(): number { return this.d.now ? this.d.now() : Date.now(); }
  private iso(): string { return new Date(this.now()).toISOString(); }

  file(): string | null {
    const home = this.d.home();
    return home ? join(privateRoot(home), 'foundations.json') : null;
  }

  /** The record now (an empty one with no office). */
  read(): FoundationsRecord {
    const home = this.d.home();
    if (!home) return emptyRecord();
    if (this.cache?.home === home) return this.cache.rec;
    const file = this.file()!;
    let rec = emptyRecord();
    try { if (existsSync(file)) rec = cleanRecord(JSON.parse(readFileSync(file, 'utf8'))); } catch {
      // A broken file reads as empty and the next write replaces it, so a copy
      // is kept beside it first: the answers it held can still be put back.
      try { copyFileSync(file, `${file}.broken-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`); } catch { /* best effort */ }
      console.error('[foundations] foundations.json could not be read; kept a copy beside it and started empty');
    }
    this.cache = { home, rec };
    return rec;
  }

  private save(rec: FoundationsRecord): void {
    const file = this.file();
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(rec, null, 2));
    this.cache = { home: this.d.home()!, rec };
    try { this.d.changed?.(); } catch { /* the view refreshes on its next read */ }
  }

  /** The office's document as agents read it. */
  document(): string {
    // Each name read once per document (a name is a registry read).
    const names = new Map<string, string>();
    const nameOf = (id: string): string => { let n = names.get(id); if (n === undefined) { n = this.nameOf(id); names.set(id, n); } return n; };
    return renderFoundations(this.read(), this.d.jobs?.() ?? [], nameOf);
  }

  private nameOf = (id: string): string => (this.d.nameOf ? this.d.nameOf(id) : id);

  private event(agentId: string | null, q: FoundationId, change: 'answered' | 'changed' | 'cleared' | 'hit', attrs: Record<string, unknown> = {}): void {
    try { this.d.record?.({ agentId, kind: 'foundation', ts: this.now(), attrs: { q, change, ...attrs } }); } catch { /* telemetry never blocks a write */ }
  }

  /**
   * At launch (and for a new office): the record is created when missing, with
   * the company profile's answers as a head start; the profile and the record
   * are brought into step; and a copy that changed is published.
   */
  seed(): void {
    const file = this.file();
    if (!file) return;
    if (!existsSync(file)) this.save(this.read());
    this.profileChanged();
    const rec = this.read();
    const gone = !!rec.publishedId && !!this.d.exists && !this.d.exists(rec.publishedId);
    if (rec.publishedText !== this.document() || !rec.publishedId || gone) this.publishSoon(0);
  }

  /**
   * The company profile changed. A Settings save passes the profile before
   * it, and only the fields it changed reach the foundations, so a page opened
   * before a newer answer never undoes it. At launch (no `before`), the
   * profile fills or corrects only answers the owner did not write.
   */
  profileChanged(before?: ProfileFacts): void {
    const p = this.d.profile?.() ?? {};
    const rec = this.read();
    let next = rec;
    const filled: FoundationId[] = [];
    for (const link of PROFILE_LINKS) {
      const v = link.read(p);
      const a = next.answers[link.id];
      if (before ? link.read(before) === v : a?.source === 'owner') continue;
      // In step when the answer says the same in the profile's own short form
      // (a 300 character answer is a 200 character field; "July to June" is month 7).
      const asProfile = a ? (() => { const patch = link.write(a.text); return patch ? link.read(patch) : undefined; })() : undefined;
      if (v && (!a || (!same(a.text, v) && !(asProfile && same(asProfile, v))))) {
        next = this.withAnswer(next, link.id, { text: v, by: 'profile', source: 'profile', at: this.iso() }, null);
        if (rec.hits[link.id]) filled.push(link.id);
      } else if (!v && a?.source === 'profile') {
        next = { ...next, answers: { ...next.answers } };
        delete next.answers[link.id];
        this.event(null, link.id, 'cleared');
      }
    }
    if (next !== rec) { this.save(next); this.publishSoon(); }
    // The owner answered in the company profile: Michael closes its card.
    for (const id of filled) this.toMichael('Foundation answered', `"${FOUNDATION_QUESTIONS[id].text}" (${id}) is answered now, from the company profile: ${next.answers[id]?.text ?? ''}\n\n${CLOSE_CARD}`);
  }

  /** Set an answer: drafts, snoozes and the gap notice for it go, and one
   *  telemetry event says what changed. */
  private withAnswer(rec: FoundationsRecord, id: FoundationId, a: FoundationAnswer, agentId: string | null): FoundationsRecord {
    const had = rec.answers[id];
    const next: FoundationsRecord = {
      ...rec,
      answers: { ...rec.answers, [id]: a },
      drafts: { ...rec.drafts },
      snoozed: { ...rec.snoozed },
      hits: { ...rec.hits }
    };
    delete next.drafts[id];
    delete next.snoozed[id];
    if (next.hits[id]) next.hits[id] = { ...next.hits[id]!, told: false };
    this.event(agentId, id, had ? 'changed' : 'answered', { by: a.by, source: a.source });
    return next;
  }

  /** Keep the company profile in step with an answer: the owner's words set
   *  it; a learned answer fills only an empty field (eng finding 6). */
  private toProfile(id: FoundationId, text: string, owner: boolean): void {
    const link = PROFILE_LINKS.find((l) => l.id === id);
    if (!link || !this.d.setProfile) return;
    if (!owner && link.read(this.d.profile?.() ?? {})) return;
    const patch = link.write(text);
    if (patch) try { this.d.setProfile(patch); } catch (e) { console.error('[foundations] profile', e); }
  }

  /** The owner's answer from the foundation card: it always wins. */
  ownerAnswer(id: unknown, text: unknown): { ok: true } | { ok: false; error: 'unknown' | 'empty' | 'too-long' | 'no-office' } {
    if (!isFoundationId(id)) return { ok: false, error: 'unknown' };
    if (!this.file()) return { ok: false, error: 'no-office' };
    const t = typeof text === 'string' ? oneLine(text) : '';
    if (!t) return { ok: false, error: 'empty' };
    if (t.length > FOUNDATION_CAP) return { ok: false, error: 'too-long' };
    this.save(this.withAnswer(this.read(), id, { text: t, by: 'owner', source: 'owner', at: this.iso() }, null));
    this.toProfile(id, t, true);
    this.publishSoon();
    return { ok: true };
  }

  /** Have a member draft it (design D8): the request is noted on the record
   *  and the member asked; its draft comes back into the card. */
  requestDraft(id: unknown, memberId: unknown): { ok: boolean } {
    if (!isFoundationId(id) || typeof memberId !== 'string' || !memberId || !this.file()) return { ok: false };
    const rec = this.read();
    this.save({ ...rec, drafts: { ...rec.drafts, [id]: { by: memberId, requestedAt: this.iso() } } });
    this.d.tell?.(memberId, `Draft: ${FOUNDATION_QUESTIONS[id].text}`,
      `The owner asked you to draft the company foundations answer to "${FOUNDATION_QUESTIONS[id].text}" (${id}) from what the office already holds: your files, your memory and company knowledge. Keep it under ${FOUNDATION_CAP} characters and send it to "foundations" with "foundation": {"question": "${id}", "draft": "<your draft>"}. The owner reads it on the card, edits it and saves it. If the office holds nothing to draft from, send the draft as "Nothing to draft from" and say what would answer it.`);
    return { ok: true };
  }

  /** Not now: out of Needs you for a week (design D2). */
  snooze(id: unknown, days = 7): { ok: boolean } {
    if (!isFoundationId(id) || !this.file()) return { ok: false };
    const rec = this.read();
    this.save({ ...rec, snoozed: { ...rec.snoozed, [id]: new Date(this.now() + days * 86_400_000).toISOString() } });
    return { ok: true };
  }

  /**
   * A message to `foundations` (the hive route). Returns the reply for the
   * sender, or null when none is owed (a gap report is answered only when the
   * question is answered already).
   */
  handle(from: string, payload: unknown): string | null {
    if (!this.file()) return 'Company foundations are not open. Try again later.';
    const p = (payload && typeof payload === 'object' ? payload : {}) as FoundationPayload;
    const id = p.question;
    if (!isFoundationId(id)) return `No company foundations question "${String(id ?? '')}". Use an id from your COMPANY FOUNDATIONS context, in square brackets after each question.`;
    const q = FOUNDATION_QUESTIONS[id].text;
    if (typeof p.gap === 'string') return this.gap(from, id, p.gap);
    // A draft comes only from the member the owner asked, or Michael (draft()).
    if (typeof p.draft === 'string') return this.draft(from, id, p.draft);
    // A member answers only its own job's questions (Michael any).
    const god = this.d.godId?.() ?? 'god';
    const isMichael = from === god || from === 'god';
    if (this.d.jobsOf && !isMichael && !questionsFor(this.d.jobsOf(from)).includes(id)) {
      return `"${q}" is not one of your job's foundations questions. Send what you know to ${this.michaelName()} instead.`;
    }
    // One plain line: an answer never adds headings or lines to the context
    // every member carries.
    const text = typeof p.answer === 'string' ? oneLine(p.answer) : '';
    if (!text) return `Nothing saved for "${q}": send "answer", "gap" or "draft" in "foundation".`;
    if (text.length > FOUNDATION_CAP) return `Not saved: keep the answer to "${q}" under ${FOUNDATION_CAP} characters. For more, save it to a file in the office folders and answer with its full path.`;
    const src = (p.source && typeof p.source === 'object' ? p.source : {}) as Record<string, unknown>;
    const level = this.level(from, src);
    if (!level) {
      if (typeof src.outside !== 'string' && typeof src.owner !== 'string' && typeof src.confirmed !== 'string' && typeof src.file !== 'string') {
        return `Not saved: an answer needs its source, "source": {"owner": "<id of the owner's message>"} or {"file": "<full path of the office file>"}, or {"outside": "<where it came from>"} for anything from outside the office.`;
      }
      this.toMichael('Foundation answer to check', `${this.nameOf(from)} offers this answer to "${q}" (${id}), from ${this.describe(src)}: ${text}\n\nIt comes from outside the office or from a source the app could not check, so it waits for you. If it is right, send it to "foundations" with "foundation": {"question": "${id}", "answer": "<the answer>", "source": {"confirmed": "<why you trust it>"}}; otherwise leave it.`);
      return `Sent to ${this.michaelName()} to check first, because the app could not check where it came from.`;
    }
    const rec = this.read();
    const had = rec.answers[id];
    if (had && same(had.text, text)) return `Already in the company foundations: "${q}".`;
    const ownerWrote = had && (had.source === 'owner' || had.source === 'profile');
    if (had && level !== 'owner' && ownerWrote) {
      this.toMichael('Foundation answer suggestion', `${this.nameOf(from)} suggests a different answer to "${q}" (${id}), which the owner answered: "${had.text}". Suggested, from ${this.describe(src)}: ${text}\n\nThe owner's answer stands; ask the owner if it should change.`);
      return `The owner's answer to "${q}" stands. Your suggestion went to ${this.michaelName()}.`;
    }
    if (had && (level === 'file' || level === 'taught')) {
      this.toMichael('Foundation answers differ', `Two answers to "${q}" (${id}) differ. Kept: "${had.text}", from ${this.nameOf(had.by)}. New, from ${this.nameOf(from)} (${this.describe(src)}): ${text}\n\nThe first stays until you decide. To replace it, send the right one to "foundations" with "source": {"confirmed": "<why>"}.`);
      return `A different answer to "${q}" is already recorded, so it stays and ${this.michaelName()} decides.`;
    }
    const source: FoundationSourceKind = level;
    const ref = typeof src.owner === 'string' ? src.owner : typeof src.file === 'string' ? src.file : undefined;
    this.save(this.withAnswer(rec, id, { text, by: from, source, at: this.iso(), ...(ref ? { ref } : {}) }, from));
    this.toProfile(id, text, level === 'owner');
    this.publishSoon();
    // Answered without the owner's card: Michael closes the card he raised for
    // it (told here when the answer is his own, else by a note).
    if (rec.hits[id] && isMichael) return `Saved to the company foundations: "${q}". ${CLOSE_CARD}`;
    if (rec.hits[id]) this.toMichael('Foundation answered', `"${q}" (${id}) is answered now, from ${this.nameOf(from)}: ${text}\n\n${CLOSE_CARD}`);
    return `Saved to the company foundations: "${q}". Every member who needs it sees it.`;
  }

  /** How sure the app is of a source: an owner message the app's list shows
   *  reaching the sender (owner rights only through Michael), Michael's
   *  confirmation, or a file in the office folders. */
  private level(from: string, src: Record<string, unknown>): Level | null {
    const god = this.d.godId?.() ?? 'god';
    const isMichael = from === god || from === 'god';
    if (typeof src.owner === 'string' && src.owner && this.d.ownerSaid?.(src.owner, from)) return isMichael ? 'owner' : 'taught';
    if (typeof src.confirmed === 'string' && src.confirmed.trim() && isMichael) return 'michael';
    if (typeof src.file === 'string' && isAbsolute(src.file) && this.d.inOffice?.(src.file, from)) return 'file';
    return null;
  }

  private describe(src: Record<string, unknown>): string {
    if (typeof src.outside === 'string') return `outside text (${src.outside.slice(0, 120)})`;
    if (typeof src.owner === 'string') return `a message said to be the owner's (${src.owner.slice(0, 60)}), which the app has no record of reaching them`;
    if (typeof src.file === 'string') return `the file ${src.file.slice(0, 200)}`;
    if (typeof src.confirmed === 'string') return 'a confirmation only you can give';
    return 'no source';
  }

  /** Work hit an empty question: kept once per question; Michael is told the
   *  first time (eng finding 8). */
  private gap(from: string, id: FoundationId, evidence: string): string | null {
    const rec = this.read();
    const answer = rec.answers[id];
    if (answer) return `"${FOUNDATION_QUESTIONS[id].text}" is answered: ${answer.text}`;
    // A gap counts only for the member's own job (Michael's for any), so no
    // member can fill Ask me with other jobs' questions.
    const god = this.d.godId?.() ?? 'god';
    if (this.d.jobsOf && from !== god && from !== 'god' && !questionsFor(this.d.jobsOf(from)).includes(id)) {
      return `"${FOUNDATION_QUESTIONS[id].text}" is not one of your job's foundations questions. If your work needs it, tell ${this.michaelName()}.`;
    }
    const at = this.iso();
    const was = rec.hits[id];
    const line = oneLine(evidence).slice(0, 200);
    const hit = { first: was?.first ?? at, last: at, count: (was?.count ?? 0) + 1, by: was?.by.includes(from) ? was.by : [...(was?.by ?? []), from], ...(line ? { evidence: line } : was?.evidence ? { evidence: was.evidence } : {}), told: true };
    this.save({ ...rec, hits: { ...rec.hits, [id]: hit } });
    this.event(from, id, 'hit');
    if (!was?.told) {
      this.toMichael('Foundation gap', `${this.nameOf(from)}'s work needed "${FOUNDATION_QUESTIONS[id].text}" (${id}) and it is empty in the company foundations.${line ? ` What the work did without it: ${line}` : ''}\n\nRaise one foundation card for it on Ask me, unless one is open (see "Company foundations" in your instructions).`);
    }
    return null;
  }

  private draft(from: string, id: FoundationId, text: string): string {
    const rec = this.read();
    const t = oneLine(text);
    if (!t) return 'Nothing saved: the draft was empty.';
    if (t.length > FOUNDATION_CAP) return `Not saved: keep the draft under ${FOUNDATION_CAP} characters.`;
    const asked = rec.drafts[id];
    // Only the member the owner asked (or Michael) fills the card's draft.
    const god = this.d.godId?.() ?? 'god';
    if (!asked || (from !== asked.by && from !== god && from !== 'god')) return `No draft was asked of you for "${FOUNDATION_QUESTIONS[id].text}".`;
    this.save({ ...rec, drafts: { ...rec.drafts, [id]: { ...asked, by: from, text: t, at: this.iso() } } });
    return 'Draft saved. The owner sees it on the card.';
  }

  private michaelName(): string {
    return this.nameOf(this.d.godId?.() ?? 'god');
  }

  private toMichael(subject: string, body: string): void {
    try { this.d.tell?.(this.d.godId?.() ?? 'god', subject, body); } catch (e) { console.error('[foundations] tell', e); }
  }

  /** Publish the readable copy once a burst of changes settles (eng finding 5). */
  publishSoon(delay = this.d.publishDelayMs ?? 5000): void {
    if (!this.d.publish) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.publishNow(); }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Publish now, when the text changed. A failure keeps the record; the next
   *  change or launch tries again. */
  publishNow(): void {
    if (!this.d.publish || !this.file()) return;
    const rec = this.read();
    const text = this.document();
    const present = !rec.publishedId || !this.d.exists || this.d.exists(rec.publishedId);
    if (rec.publishedId && rec.publishedText === text && present) return;
    try {
      const id = this.d.publish(text, rec.publishedId);
      if (id) this.save({ ...this.read(), publishedId: id, publishedText: text });
    } catch (e) { console.error('[foundations] publish', e); }
  }

  /** The record for the renderer: answers, drafts, snoozes and hits. */
  view(): FoundationsView {
    const r = this.read();
    return { answers: r.answers, drafts: r.drafts, snoozed: r.snoozed, hits: r.hits };
  }
}

/** What publishing the copy needs from company knowledge. */
export interface CopyStore {
  ingestText: (text: string, opts: { title?: string; tags?: string[] }) => { docId?: string } | unknown;
  list: () => Array<{ id: string; tags?: unknown }>;
  remove: (id: string) => unknown;
}

/** Publish the Company foundations copy: one copy in the store, which every
 *  office shares, so our old copy and any other office's go and no business
 *  reads another's answers. `changed` tells search by meaning. */
export function publishCopy(store: CopyStore, text: string, changed?: () => void): string | undefined {
  const r = store.ingestText(text, { title: FOUNDATIONS_TITLE, tags: [FOUNDATIONS_TAG] }) as { docId?: string } | undefined;
  for (const d of store.list()) {
    if (d.id !== r?.docId && isFoundationsDoc(d)) { try { store.remove(d.id); } catch { /* gone already */ } }
  }
  try { changed?.(); } catch { /* the next pass indexes it */ }
  return r?.docId;
}
