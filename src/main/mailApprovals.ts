/**
 * Send on approval (docs/designs/send-on-approval.md): the proposals an agent
 * put up for the owner, kept by the app in mail-proposals.json in the app's
 * data folder (never tasks.json, which agents write), so what goes out is what
 * the owner approved. The rules are in shared/mailProposals.ts.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  addSendRecord,
  approvedUnsent,
  decisionMessage,
  describeEdits,
  fileProposal,
  memoryLine,
  pruneProposals,
  sendingChangeMessage,
  sendingMemoryLine,
  standingMemoryLine,
  waitingProposals,
  STANDING_KIND_MAX,
  STANDING_SENDS_KEPT,
  type MailProposal,
  type ProposalDecision,
  type SendRecord,
  type StandingApproval
} from '../shared/mailProposals';
import type { SendingMode } from '../shared/mailboxes';
import type { ProposalStore } from './mail';

export interface MailApprovalDeps {
  path: string;
  /** A hive message from the app (sender "mail"). Returns false when it could
   *  not go out (no hive), so nothing is recorded as told. */
  send(msg: { to: string; act: 'request' | 'inform'; subject: string; body: string }): boolean | void;
  /** Adds a line to an agent's memory notes. */
  remember(agentId: string, line: string): void;
  /** A toast titled with Michael's name (only Michael notifies). */
  toast(body: string): void;
  agentName(id: string): string;
  godId(): string;
  /** The Ask me board reads the list again. */
  changed(): void;
  /** Whether the agent could send this proposal's email now (its access and
   *  grant). Absent: assumed, as before. The late sweep skips one that can't,
   *  so Michael is never sent on a dead errand (OV6). */
  canSend?: (agentId: string, mailbox: string, proposalId: string) => boolean;
  now?: () => number;
}

/** A Send only grant on pause (S3, D10): since when, and whether Michael was told. */
export interface PausedNotice { since: number; told: boolean }

/** Michael hears about a paused grant once it has lasted this long, so the
 *  app's launch (members respawning) and a hire in flight never set it off (EV1). */
export const PAUSE_NOTICE_MS = 5 * 60 * 1000;

interface StoreFile {
  proposals: MailProposal[];
  standing: StandingApproval[];
  sends: SendRecord[];
  paused: Record<string, PausedNotice>;
}

const SUBJECT_MAX = 500;
const BODY_MAX = 200_000;
const NOTE_MAX = 2000;
const STORE_UNREADABLE =
  'The saved mail approvals file could not be read, so nothing was saved over it. Try again; if it keeps failing, the file needs repair.';

export class MailApprovals implements ProposalStore {
  constructor(private deps: MailApprovalDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  private empty(): StoreFile {
    return { proposals: [], standing: [], sends: [], paused: {} };
  }

  private coerceStore(v: unknown): StoreFile | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const raw = v as Record<string, unknown>;
    const ok = <T extends { id?: unknown }>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]).filter((x) => x && typeof x.id === 'string') : []);
    const sends = Array.isArray(raw.sends) ? (raw.sends as SendRecord[]).filter((r) => r && typeof r.messageId === 'string' && typeof r.agentId === 'string') : [];
    const paused = raw.paused && typeof raw.paused === 'object' && !Array.isArray(raw.paused) ? (raw.paused as Record<string, PausedNotice>) : {};
    return { ...raw, proposals: ok<MailProposal>(raw.proposals), standing: ok<StandingApproval>(raw.standing), sends, paused };
  }

  private load(): StoreFile {
    try {
      if (!existsSync(this.deps.path)) return this.empty();
      return this.coerceStore(JSON.parse(readFileSync(this.deps.path, 'utf8'))) ?? this.empty();
    } catch { return this.empty(); }
  }

  private loadForWrite(): StoreFile {
    if (!existsSync(this.deps.path)) return this.empty();
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.deps.path, 'utf8'));
    } catch {
      throw new Error(STORE_UNREADABLE);
    }
    const store = this.coerceStore(parsed);
    if (!store) throw new Error(STORE_UNREADABLE);
    return store;
  }

  /** Writes the parts given and keeps every other part as it is (EV3: a save
   *  that knew only proposals and standing wiped the rest). */
  private save(next: Partial<StoreFile>): void {
    const cur = this.loadForWrite();
    const data = { ...cur, ...next, proposals: pruneProposals(next.proposals ?? cur.proposals, this.now()) };
    const tmp = `${this.deps.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, this.deps.path);
    try { this.deps.changed(); } catch { /* window gone */ }
  }

  private read(): MailProposal[] { return this.load().proposals; }
  private write(list: MailProposal[]): void { this.save({ proposals: list }); }
  private today(): string { return new Date(this.now()).toISOString().slice(0, 10); }

  /** Standing approvals still in force, for one agent or all. */
  standing(agentId?: string): StandingApproval[] {
    return this.load().standing.filter((r) => !r.revokedAt && (!agentId || r.agentId === agentId));
  }

  getStanding(id: string): StandingApproval | undefined { return this.load().standing.find((r) => r.id === id); }

  /** One email sent under a standing approval, kept for the owner to look over. */
  recordStandingSend(id: string, email: { to: string; subject: string }): void {
    const all = this.load().standing;
    this.save({ standing: all.map((r) => (r.id === id ? { ...r, sends: [...(r.sends ?? []), { at: this.now(), to: email.to.slice(0, 200), subject: email.subject.slice(0, 200) }].slice(-STANDING_SENDS_KEPT) } : r)) });
  }

  /** The owner revoked it on the Access tab: the agent is told and remembers. */
  revokeStanding(id: string): { ok: true } | { ok: false; error: string } {
    const all = this.load().standing;
    const rule = all.find((r) => r.id === id);
    if (!rule || rule.revokedAt) return { ok: false, error: 'not found' };
    const revoked = { ...rule, revokedAt: this.now() };
    this.save({ standing: all.map((r) => (r.id === id ? revoked : r)) });
    try {
      this.deps.send({ to: rule.agentId, act: 'inform', subject: 'Standing approval revoked', body: `The owner revoked your standing approval "${rule.kind}". Propose these emails for approval again.` });
    } catch (e) { console.error('[mail] revoke message:', e); }
    try { this.deps.remember(rule.agentId, standingMemoryLine(revoked, false, this.today())); } catch { /* the revoke stands */ }
    return { ok: true };
  }

  /** Withdraws waiting and approved proposals: one id, or every one of an
   *  agent's from a mailbox. The agent hears once, with the reason. */
  cancel(match: { id: string } | { agentId: string; mailbox: string }, reason: string): number {
    // An email being sent is withdrawn too: its send checks again just before
    // the server and stops (once it reached the server it stays sent).
    const gone = this.withdraw(match, reason, (p) => p.state === 'waiting' || p.state === 'approved' || p.state === 'sending');
    if (!gone.length) return 0;
    const agentId = gone[0].agentId;
    const lines = gone.map((p) => `"${p.subject.slice(0, 80)}" to ${p.to.slice(0, 120)} (${p.id})`).join('\n');
    try {
      this.deps.send({ to: agentId, act: 'inform', subject: gone.length === 1 ? 'Email withdrawn' : `${gone.length} emails withdrawn`, body: `Not sent, and not to be sent another way: ${reason}\n${lines}` });
    } catch (e) { console.error('[mail] cancel message:', e); }
    return gone.length;
  }

  /** Marks the matching emails cancelled with a reason; returns them. */
  private withdraw(match: { id: string } | { agentId: string; mailbox: string }, reason: string, open: (p: MailProposal) => boolean): MailProposal[] {
    const list = this.read();
    const gone = list.filter((p) => open(p) && ('id' in match ? p.id === match.id : p.agentId === match.agentId && p.mailbox === match.mailbox));
    if (!gone.length) return [];
    const ids = new Set(gone.map((p) => p.id));
    this.write(list.map((p) => (ids.has(p.id) ? { ...p, state: 'cancelled' as const, decidedAt: this.now(), cancelReason: reason } : p)));
    return gone;
  }

  /**
   * The owner changed a member's Sending on a mailbox it keeps (owner,
   * 2026-10-09). The member is told and its memory notes get the new rule, so
   * an older note to propose no longer wins. Can send takes its waiting emails
   * off Ask me and hands them back to send itself; approved ones stay, and it
   * may still send them by id. Draft only is withdrawn by `cancel` first.
   * `handBack` false (a paused grant, which can't send) keeps them on Ask me.
   */
  sendingChanged(agentId: string, mailbox: string, address: string, sending: SendingMode, handBack = true): void {
    const handedBack = sending === 'send' && handBack
      ? this.withdraw({ agentId, mailbox }, `The owner set you to Can send from ${address}, so it is yours to send.`, (p) => p.state === 'waiting')
      : [];
    try { this.deps.send({ to: agentId, ...sendingChangeMessage(address, sending, handedBack) }); } catch (e) { console.error('[mail] sending change message:', e); }
    try { this.deps.remember(agentId, sendingMemoryLine(address, sending, this.today())); } catch { /* the change stands */ }
  }

  /**
   * Waiting emails from a mailbox their member sends from on Can send, which
   * puts nothing on Ask me: handed back with the same notice as a switch, so
   * an office whose cards came before this rule ends up the same (owner,
   * 2026-10-09). `canSend` gives the mailbox's address, or null when the
   * member does not send from it on Can send. Run at launch.
   */
  handBackCanSend(canSend: (agentId: string, mailbox: string) => string | null): number {
    const groups = new Map<string, MailProposal>();
    for (const p of this.waiting()) groups.set(`${p.agentId}\u0000${p.mailbox}`, p);
    let n = 0;
    for (const p of groups.values()) {
      const address = canSend(p.agentId, p.mailbox);
      if (address === null) continue;
      this.sendingChanged(p.agentId, p.mailbox, address, 'send');
      n++;
    }
    return n;
  }

  /**
   * A member lost a mailbox (its Send only grant ended, the mailbox moved or was
   * removed, or its email was turned off): its waiting and approved emails from
   * there are withdrawn and its standing approvals there revoked (D13, ship D3).
   * Up to two messages: one for the emails, one for the approvals, each revoked
   * approval with its memory note.
   */
  endGrant(agentId: string, mailbox: string, reason: string): void {
    this.cancel({ agentId, mailbox }, reason);
    const all = this.load().standing;
    const ending = all.filter((r) => r.agentId === agentId && r.mailbox === mailbox && !r.revokedAt);
    if (!ending.length) return;
    const at = this.now();
    const ids = new Set(ending.map((r) => r.id));
    this.save({ standing: all.map((r) => (ids.has(r.id) ? { ...r, revokedAt: at } : r)) });
    try {
      this.deps.send({ to: agentId, act: 'inform', subject: ending.length === 1 ? 'Standing approval revoked' : 'Standing approvals revoked', body: `${reason} So the owner's standing approvals from there are revoked: ${ending.map((r) => `"${r.kind}"`).join(', ')}.` });
    } catch (e) { console.error('[mail] revoke message:', e); }
    for (const r of ending) {
      try { this.deps.remember(agentId, standingMemoryLine({ ...r, revokedAt: at }, false, this.today())); } catch { /* the revoke stands */ }
    }
  }

  /** Keeps a send made under a Send only grant (E1b). */
  recordSend(rec: SendRecord): void {
    this.save({ sends: addSendRecord(this.load().sends, rec) });
  }

  /** The member's own send from a mailbox with this Message-ID. */
  sendRecord(agentId: string, mailbox: string, messageId: string): SendRecord | undefined {
    const id = messageId.trim();
    return this.load().sends.find((r) => r.agentId === agentId && r.mailbox === mailbox && r.messageId === id);
  }

  /** The member's latest sends from a mailbox, newest first. */
  recentSends(agentId: string, mailbox: string, limit = 20): SendRecord[] {
    return this.load().sends.filter((r) => r.agentId === agentId && r.mailbox === mailbox).slice(-limit).reverse();
  }

  /**
   * The grants paused now, by `agent:mailbox`. Returns the ones whose pause
   * has lasted PAUSE_NOTICE_MS and that Michael has not heard about, marking
   * them told; a grant no longer paused is forgotten, so a later pause is told
   * again (D10: Michael is told once per pause).
   */
  pausedDue(pausedNow: string[]): string[] {
    const now = this.now();
    const cur = this.load().paused;
    const next: Record<string, PausedNotice> = {};
    const due: string[] = [];
    for (const key of pausedNow) {
      const prior = cur[key] ?? { since: now, told: false };
      const tell = !prior.told && now - prior.since >= PAUSE_NOTICE_MS;
      if (tell) due.push(key);
      next[key] = { since: prior.since, told: prior.told || tell };
    }
    const same = Object.keys(next).length === Object.keys(cur).length && Object.entries(next).every(([k, v]) => cur[k]?.since === v.since && cur[k]?.told === v.told);
    if (!same) this.save({ paused: next });
    return due;
  }

  /** The proposals waiting for the owner, for Ask me. */
  waiting(): MailProposal[] { return waitingProposals(this.read()); }

  get(id: string): MailProposal | undefined { return this.read().find((p) => p.id === id); }

  /** Every kept proposal in any state (the Triggers tab reads the ones tied to a task). */
  all(): MailProposal[] { return this.read(); }

  file(p: Omit<MailProposal, 'id' | 'createdAt' | 'state'>): MailProposal {
    const list = this.read();
    const draft: MailProposal = { ...p, id: `mp_${this.now().toString(36)}_${randomBytes(3).toString('hex')}`, createdAt: this.now(), state: 'waiting' };
    const next = fileProposal(list, draft);
    // The card it replaced (same email still waiting), so the agent is told
    // its earlier id no longer works.
    const replaced = list.find((x) => x.state === 'waiting' && !next.some((y) => y.id === x.id));
    const proposal: MailProposal = replaced ? { ...draft, replaces: replaced.id } : draft;
    this.write(next.map((x) => (x.id === draft.id ? proposal : x)));
    this.deps.toast(`${this.deps.agentName(p.agentId)} has an email for you to approve in ASK ME.`);
    return proposal;
  }

  /** Before an approved email goes out: throws when it can't be recorded, so
   *  nothing is sent that a restart could send again (Codex P1). */
  markSending(id: string): void {
    this.write(this.read().map((p) => (p.id === id && p.state === 'approved' ? { ...p, state: 'sending' as const } : p)));
    if (this.get(id)?.state !== 'sending') throw new Error('not recorded');
  }

  /** The send failed: the email is approved and can be sent again. */
  unmarkSending(id: string): void {
    this.write(this.read().map((p) => (p.id === id && p.state === 'sending' ? { ...p, state: 'approved' as const } : p)));
  }

  markSent(id: string, messageId: string): void {
    this.write(this.read().map((p) => (p.id === id ? { ...p, state: 'sent' as const, sentAt: this.now(), messageId } : p)));
  }

  /**
   * The owner's decision on Ask me. Approve keeps the subject and body as the
   * owner left them; the agent is told, and anything the owner changed or
   * said goes into its memory notes so it learns their way of writing.
   */
  decide(id: string, decision: ProposalDecision, edit: { subject?: unknown; body?: unknown }, rawNote: unknown, rawStanding?: unknown): { ok: true } | { ok: false; error: string } {
    const list = this.read();
    const p = list.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'not found' };
    if (p.state !== 'waiting') return { ok: false, error: 'already decided' };
    const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, NOTE_MAX) : '';
    if (decision === 'changes' && !note) return { ok: false, error: 'note needed' };
    // An edit the owner emptied is refused, never quietly replaced by the
    // agent's draft; a field left out keeps the draft.
    if (decision === 'approve' && ((typeof edit.subject === 'string' && !edit.subject.trim()) || (typeof edit.body === 'string' && !edit.body.trim()))) {
      return { ok: false, error: 'subject and body needed' };
    }
    const subject = typeof edit.subject === 'string' && edit.subject.trim() ? edit.subject.slice(0, SUBJECT_MAX) : p.subject;
    const body = typeof edit.body === 'string' && edit.body.trim() ? edit.body.slice(0, BODY_MAX) : p.body;
    const edits = decision === 'approve' ? describeEdits({ subject: p.subject, body: p.body }, { subject, body }) : '';
    // The owner ticked the agent's offer: this kind goes out without asking
    // from now on, in the words the owner left on the card.
    const kind = decision === 'approve' && typeof rawStanding === 'string' ? rawStanding.replace(/\s+/g, ' ').trim().slice(0, STANDING_KIND_MAX) : '';
    const standing: StandingApproval | undefined = kind
      ? { id: `sa_${this.now().toString(36)}_${randomBytes(3).toString('hex')}`, agentId: p.agentId, mailbox: p.mailbox, kind, createdAt: this.now(), fromProposal: p.id, sends: [] }
      : undefined;
    const next: MailProposal = {
      ...p,
      state: decision === 'approve' ? 'approved' : decision === 'changes' ? 'changes' : 'declined',
      decidedAt: this.now(),
      ...(decision === 'approve' ? { approved: { subject, body } } : {}),
      ...(note ? { note } : {}),
      ...(standing ? { standingId: standing.id } : {})
    };
    this.save({ proposals: list.map((x) => (x.id === id ? next : x)), ...(standing ? { standing: [...this.load().standing, standing] } : {}) });
    const msg = decisionMessage(p, decision, edits, note, standing);
    try { this.deps.send({ to: p.agentId, ...msg }); } catch (e) { console.error('[mail] approval message:', e); }
    const line = memoryLine(p, decision, edits, note, this.today());
    if (line) { try { this.deps.remember(p.agentId, line); } catch { /* the decision stands */ } }
    if (standing) { try { this.deps.remember(p.agentId, standingMemoryLine(standing, true, this.today())); } catch { /* the approval stands */ } }
    return { ok: true };
  }

  /** An approved email the agent has not sent within the hour goes to
   *  Michael once, so it is never stranded. */
  sweep(): void {
    const list = this.read();
    // One the agent can't send now (its grant is paused or ended) is not a
    // job for Michael: it goes when it can, or was withdrawn.
    const late = approvedUnsent(list, this.now()).filter((p) => this.deps.canSend?.(p.agentId, p.mailbox, p.id) ?? true);
    if (!late.length) return;
    const told = new Set<string>();
    for (const p of late) {
      const sent = this.deps.send({
        to: this.deps.godId(), act: 'request',
        subject: 'Approved email not sent',
        body: `The owner approved ${this.deps.agentName(p.agentId)}'s email to ${p.to.slice(0, 200)}, "${p.subject.slice(0, 120)}", over an hour ago and it has not gone out. Ask ${this.deps.agentName(p.agentId)} to send it: send with mailbox "${p.mailbox}" and proposal "${p.id}".`
      });
      if (sent !== false) told.add(p.id);
    }
    if (!told.size) return;
    this.write(list.map((p) => (told.has(p.id) ? { ...p, remindedMichael: true } : p)));
  }
}
