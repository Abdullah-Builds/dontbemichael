/**
 * QuickBooks "Changes need my OK" (issue 320): the requests an agent's
 * QuickBooks changes put up for the owner, and the one-time grants the owner's
 * yes turns them into. Kept by the app in quickbooks-approvals.json in the
 * app's data folder (never a file agents write), so the call that runs is the
 * call the owner approved.
 *
 * The agent makes the call itself, over the owner's Claude account, so the app
 * cannot run it. Instead the PreToolUse hook refuses the call and files a
 * request here; on a yes the same call, with the same input, is let through
 * once. A grant is for one tool name plus a hash of its input, so a call that
 * differs in any way is refused again.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import {
  type QuickBooksApproval,
  QUICKBOOKS_GRANT_TTL_MS,
  QUICKBOOKS_INPUT_MAX,
  quickbooksApprovedMessage,
  quickbooksDeclinedMessage,
  QUICKBOOKS_WAIT_TTL_MS,
  quickbooksCanonicalInput,
  quickbooksInputLines,
  quickbooksToolWords
} from '../shared/quickbooks';

/** What the hook does with a refused change. */
export type { QuickBooksApproval, QuickBooksApprovalState } from '../shared/quickbooks';

export type QuickBooksGate =
  | { kind: 'granted'; id: string }
  | { kind: 'waiting'; id: string }
  | { kind: 'declined'; id: string }
  /** The agent already has WAITING_PER_AGENT_MAX requests open; this one is not filed. */
  | { kind: 'full' }
  /** The input is too large to show the owner in full; no request is filed. */
  | { kind: 'tooLarge' };

export interface QuickBooksApprovalDeps {
  path: string;
  /** A hive message from the app to a member, to tell it the owner's answer.
   *  Returns false when it could not go out (no hive). */
  send(msg: { to: string; act: 'inform'; subject: string; body: string }): boolean | void;
  /** The Ask me board reads the list again. */
  changed(): void;
  now?: () => number;
}

/** Most requests kept, so a runaway agent cannot grow the file without end. */
const KEEP_MAX = 200;
/** Most waiting requests one agent may have; the next is refused as a flood. */
export const WAITING_PER_AGENT_MAX = 10;

export function quickbooksInputHash(tool: string, input: unknown): string {
  return createHash('sha256').update(`${tool}\n${quickbooksCanonicalInput(input)}`).digest('hex');
}

export class QuickBooksApprovals {
  private list: QuickBooksApproval[] | null = null;

  constructor(private deps: QuickBooksApprovalDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  private load(): QuickBooksApproval[] {
    if (this.list) return this.list;
    let rows: QuickBooksApproval[] = [];
    try {
      const raw = JSON.parse(readFileSync(this.deps.path, 'utf8')) as { approvals?: unknown };
      if (Array.isArray(raw.approvals)) {
        rows = (raw.approvals as QuickBooksApproval[]).filter((r) => r
          && typeof r.id === 'string' && typeof r.agentId === 'string' && typeof r.tool === 'string'
          && typeof r.inputHash === 'string' && typeof r.expiresAt === 'number'
          && ['waiting', 'approved', 'declined', 'used'].includes(r.state));
      }
    } catch { /* no file yet, or unreadable: start empty, the next save replaces it */ }
    this.list = rows;
    return rows;
  }

  /** Drops what has lapsed. A grant that lapsed unused simply stops working. */
  private prune(): QuickBooksApproval[] {
    const now = this.now();
    const kept = this.load().filter((r) => r.expiresAt > now).slice(-KEEP_MAX);
    this.list = kept;
    return kept;
  }

  private save(next: QuickBooksApproval[]): void {
    this.list = next;
    const tmp = `${this.deps.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ approvals: next }, null, 2), 'utf8');
    renameSync(tmp, this.deps.path);
    try { this.deps.changed(); } catch { /* window gone */ }
  }

  /**
   * An agent's QuickBooks change reached the hook under Changes need my OK.
   * A grant for this exact call is used up and the call goes ahead; otherwise
   * the call is refused, with the request the owner has yet to answer (filed
   * now if there is none), or the owner's no.
   */
  gate(agentId: string, tool: string, input: unknown): QuickBooksGate {
    const hash = quickbooksInputHash(tool, input);
    const all = this.prune();
    const same = (r: QuickBooksApproval): boolean => r.agentId === agentId && r.tool === tool && r.inputHash === hash;

    const grant = all.find((r) => same(r) && r.state === 'approved');
    if (grant) {
      // Used once. The row stays a while for the record; the same call made again is a new request.
      this.save(all.map((r) => (r.id === grant.id ? { ...r, state: 'used' as const, expiresAt: this.now() + QUICKBOOKS_GRANT_TTL_MS } : r)));
      return { kind: 'granted', id: grant.id };
    }
    const waiting = all.find((r) => same(r) && r.state === 'waiting');
    if (waiting) return { kind: 'waiting', id: waiting.id };
    const no = all.find((r) => same(r) && r.state === 'declined');
    if (no) return { kind: 'declined', id: no.id };

    // Everything the owner approves must be shown to them in full.
    if (quickbooksCanonicalInput(input).length > QUICKBOOKS_INPUT_MAX) return { kind: 'tooLarge' };
    // Not asked yet, or a used grant: ask again. A flood of different calls is held at a cap.
    if (all.filter((r) => r.agentId === agentId && r.state === 'waiting').length >= WAITING_PER_AGENT_MAX) return { kind: 'full' };
    const now = this.now();
    const row: QuickBooksApproval = {
      id: `qb-${randomBytes(5).toString('hex')}`,
      agentId,
      tool,
      inputHash: hash,
      title: quickbooksToolWords(tool),
      lines: quickbooksInputLines(input),
      state: 'waiting',
      createdAt: now,
      expiresAt: now + QUICKBOOKS_WAIT_TTL_MS
    };
    this.save([...all.filter((r) => !(same(r) && r.state === 'used')), row]);
    return { kind: 'waiting', id: row.id };
  }

  /** Requests the owner has yet to answer, oldest first. */
  waiting(): QuickBooksApproval[] {
    return this.prune().filter((r) => r.state === 'waiting').sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The owner's answer. Only a waiting request can be answered, once. */
  decide(id: string, decision: 'approve' | 'decline'): { ok: true } | { ok: false; error: string } {
    const all = this.prune();
    const row = all.find((r) => r.id === id);
    if (!row || row.state !== 'waiting') return { ok: false, error: 'not waiting' };
    const now = this.now();
    const next: QuickBooksApproval = decision === 'approve'
      ? { ...row, state: 'approved', decidedAt: now, expiresAt: now + QUICKBOOKS_GRANT_TTL_MS }
      : { ...row, state: 'declined', decidedAt: now, expiresAt: now + QUICKBOOKS_GRANT_TTL_MS };
    this.save(all.map((r) => (r.id === id ? next : r)));
    // The member is usually idle by now and would never retry, so it is told.
    const msg = decision === 'approve' ? quickbooksApprovedMessage(row) : quickbooksDeclinedMessage(row);
    try { this.deps.send({ to: row.agentId, ...msg }); } catch (e) { console.error('[quickbooks] decision message:', e); }
    return { ok: true };
  }

  /** Withdraws every open request and unused grant of an agent (QuickBooks turned
   *  off for it, or it left the team). */
  revoke(agentId: string): number {
    const all = this.prune();
    const keep = all.filter((r) => !(r.agentId === agentId && (r.state === 'waiting' || r.state === 'approved')));
    if (keep.length === all.length) return 0;
    this.save(keep);
    return all.length - keep.length;
  }
}
