/**
 * Send once for a connected app (issue #54, the same rule mail already has).
 *
 * A write the broker forwards (anything other than GET or HEAD) is recorded
 * before it goes upstream. The same agent repeating the same write gets the
 * first answer back, including after a restart. If the app stopped before the
 * answer came back, the write may already have created an invoice, booking or
 * contact, and this app cannot check the other service, so the repeat is
 * refused and the agent is told to tell Michael. No card is opened: Michael
 * owns every card.
 *
 * The journal lives beside the mail send journal, under the app's own data
 * folder, mode 0600. It is not in the hive folder agents can read. It stores
 * the answer, never the credential. Only a write that worked is kept: a
 * refusal or an error may go again, with the same key. A damaged journal is set
 * aside and a fresh one started, as mail does.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { writeFileAtomic } from './atomicFile';

/** How long a finished write is replayed. Same window as a sent email. */
export const WRITE_MEMORY_MS = 10 * 60_000;
/** How long an interrupted write stays refused. Same window as mail. */
export const WRITE_PENDING_MS = 24 * 60 * 60_000;
/** Answers larger than this are not kept. The first caller still gets them. */
export const WRITE_BODY_KEEP = 256 * 1024;

export const WRITE_UNCERTAIN =
  'This change may already have gone out. Sending it was interrupted, and this app cannot check whether the other service kept it. Do not send it again. Tell Michael, so the owner can check.';
export const WRITE_NOT_SENT =
  'Not sent. The other service could not be reached. Try again in a moment.';
export const JOURNAL_UNSAVED =
  'This was not sent. The app could not record it before sending. Try again in a moment.';
export const WRITE_TOO_LARGE =
  'This change already went through. The answer was too large to keep. Do not send it again. Tell Michael.';

const QUICKBOOKS_HOSTS = new Set([
  'quickbooks.api.intuit.com',
  'sandbox-quickbooks.api.intuit.com'
]);

export function isWriteMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD';
}

export function isQuickBooksHost(hostname: string): boolean {
  return QUICKBOOKS_HOSTS.has(hostname.toLowerCase());
}

/** Stable id for this write. The short form is what providers are given. */
export function writeOnceIdentity(parts: {
  agentId: string;
  integrationId: string;
  method: string;
  pathAndQuery: string;
  body: Buffer;
}): { storageKey: string; idempotencyKey: string } {
  const bodyHash = createHash('sha256').update(parts.body).digest('hex');
  const storageKey = createHash('sha256').update(JSON.stringify([
    parts.agentId,
    parts.integrationId,
    parts.method.toUpperCase(),
    parts.pathAndQuery,
    bodyHash
  ])).digest('hex');
  return { storageKey, idempotencyKey: storageKey.slice(0, 32) };
}

/** QuickBooks dedupes on `requestid` (36 characters at most). Other hosts
 *  ignore a query they were not built for, so only QuickBooks gets one. */
export function withQuickBooksRequestId(url: URL, idempotencyKey: string): URL {
  if (!isQuickBooksHost(url.hostname) || url.searchParams.has('requestid')) return url;
  const next = new URL(url.href);
  next.searchParams.set('requestid', idempotencyKey);
  return next;
}

/** A failure before any connection is safe to retry. Anything else may have
 *  been applied: a timeout, a reset, or an abort after the bytes were sent. */
export function classifyUpstreamFailure(e: unknown): 'never' | 'uncertain' {
  const err = e as { name?: unknown; cause?: { name?: unknown; syscall?: unknown; code?: unknown } } | null;
  const name = err?.name;
  const causeName = err?.cause?.name;
  if (name === 'AbortError' || name === 'TimeoutError' || causeName === 'AbortError' || causeName === 'TimeoutError') {
    return 'uncertain';
  }
  const syscall = err?.cause?.syscall;
  if (syscall === 'connect' || syscall === 'getaddrinfo') return 'never';
  const code = err?.cause?.code;
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'never';
  }
  return 'uncertain';
}

interface WriteRow {
  at: number;
  idempotencyKey: string;
  pending?: true;
  status?: number;
  contentType?: string;
  /** Base64. Absent while pending, and when the answer was too large to keep. */
  body?: string;
  truncated?: true;
}

export type WriteLookup =
  | { kind: 'fresh' }
  | { kind: 'uncertain' }
  | { kind: 'truncated'; status: number }
  | { kind: 'replay'; status: number; contentType: string; body: Buffer };

function validRow(v: unknown): v is WriteRow {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const row = v as WriteRow;
  if (typeof row.at !== 'number' || typeof row.idempotencyKey !== 'string') return false;
  if (row.pending === true) return true;
  if (typeof row.status !== 'number') return false;
  if (row.truncated === true) return true;
  return typeof row.body === 'string';
}

export class BrokerWriteOnce {
  private readonly rows = new Map<string, WriteRow>();

  constructor(
    private readonly journalPath: string,
    private readonly now: () => number = Date.now
  ) {
    this.load();
  }

  lookup(storageKey: string): WriteLookup {
    if (this.prune()) this.save();
    const row = this.rows.get(storageKey);
    if (!row) return { kind: 'fresh' };
    if (row.pending) return { kind: 'uncertain' };
    if (row.truncated || typeof row.body !== 'string' || typeof row.status !== 'number') {
      return { kind: 'truncated', status: row.status ?? 200 };
    }
    return {
      kind: 'replay',
      status: row.status,
      contentType: row.contentType || 'application/octet-stream',
      body: Buffer.from(row.body, 'base64')
    };
  }

  /** Record the write before it is sent. False means nothing should go out. */
  begin(storageKey: string, idempotencyKey: string): boolean {
    this.rows.set(storageKey, { at: this.now(), idempotencyKey, pending: true });
    if (this.save()) return true;
    this.rows.delete(storageKey);
    return false;
  }

  settle(storageKey: string, status: number, contentType: string, body: Buffer | undefined, truncated: boolean): void {
    const prev = this.rows.get(storageKey);
    const tooBig = truncated || (body != null && body.length > WRITE_BODY_KEEP);
    const row: WriteRow = {
      at: this.now(),
      idempotencyKey: prev?.idempotencyKey ?? '',
      status,
      contentType,
      ...(tooBig ? { truncated: true } : { body: (body ?? Buffer.alloc(0)).toString('base64') })
    };
    this.rows.set(storageKey, row);
    this.save();
  }

  /** The other service never saw the write, so a retry may send it. False
   *  means the pending row is still there and the retry must be refused. */
  forget(storageKey: string): boolean {
    const prev = this.rows.get(storageKey);
    this.rows.delete(storageKey);
    if (this.save()) return true;
    if (prev) this.rows.set(storageKey, prev);
    return false;
  }

  private load(): void {
    if (!existsSync(this.journalPath)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.journalPath, 'utf8'));
    } catch {
      this.setAside();
      return;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.values(raw).every(validRow)) {
      this.setAside();
      return;
    }
    for (const [key, value] of Object.entries(raw as Record<string, WriteRow>)) this.rows.set(key, value);
    if (this.prune()) this.save();
  }

  /** Nothing in the app could recover a journal that blocked every write, so
   *  a damaged one is moved aside, where it can still be looked at, and a
   *  fresh one starts. Its pending rows are lost with it, as with mail. */
  private setAside(): void {
    this.rows.clear();
    const aside = `${this.journalPath.replace(/\.json$/, '')}.damaged-${this.now()}.json`;
    try {
      renameSync(this.journalPath, aside);
      console.error(`[broker] write journal could not be read; set aside as ${basename(aside)}, starting a fresh one`);
    } catch {
      console.error('[broker] write journal could not be read or set aside; starting a fresh one');
    }
  }

  /** Drop rows outside their window. Pending is kept much longer than a
   *  finished answer: an interrupted write is the one that must not repeat. */
  private prune(): boolean {
    const now = this.now();
    let changed = false;
    for (const [key, row] of this.rows) {
      const limit = row.pending ? WRITE_PENDING_MS : WRITE_MEMORY_MS;
      if (now - row.at > limit) {
        this.rows.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  private save(): boolean {
    try {
      const data: Record<string, WriteRow> = {};
      for (const [key, row] of this.rows) data[key] = row;
      writeFileAtomic(this.journalPath, JSON.stringify(data), 0o600);
      return true;
    } catch {
      return false;
    }
  }
}
