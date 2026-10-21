/**
 * Pulse telemetry: the isolated store of data points (docs/designs/team-performance.md,
 * D16). Only the main process writes it, in harness.db in the app's own data
 * folder, outside every agent folder. Agents' activity reaches it through their
 * authenticated hook events (#61); the app adds its own events (cards, mail
 * decisions, presence, schedule runs).
 *
 *   sources ─► record() ─► buffer ─► flush() (one transaction a second) ─► telemetry_events
 *                                       │ fails
 *                                       └► failure counted for that day (D15)
 *
 * No prompt text, tool input or mail content is ever stored: only the kind,
 * time, a value and small attributes.
 */
import type Database from 'better-sqlite3';
import { dayKey } from '../shared/teamPerformance';

export type TelemetryKind =
  | 'prompt' | 'tool' | 'stop'
  | 'cost'
  | 'run-dispatch'
  | 'card-status' | 'card-reopen'
  | 'mail-decision' | 'email' | 'sent' | 'message'
  | 'presence'
  | 'advice-applied'
  // Team at work and Kept safe (proposal 3): working time a backfill read from
  // a past session, a trust layer decision, a step a setting stopped.
  | 'busy' | 'trust' | 'refused'
  // A message held because the check could not run (the hive's own line, so
  // the held count and the held list come from one event, owner 2026-10-16).
  | 'trust-held'
  // One per message the check let through or stopped (owner, 2026-10-16).
  | 'trust-checked'
  // A note new to a member's memory index, by id and source, never its text
  // (Learning, owner 2026-10-18: an edit or a repeat is not a new note).
  | 'note-added'
  // Company foundations (office-foundations.md, eng finding 4): a question
  // answered, changed or cleared, or work that hit it while empty, by id.
  | 'foundation';

export interface TelemetryEvent {
  agentId: string | null;
  kind: TelemetryKind;
  ts: number;
  value?: number;
  attrs?: Record<string, unknown>;
}

export interface TelemetryRow extends TelemetryEvent { id: number; office: string }

/** A card as the tasks diff needs it. */
export interface CardLite {
  id: string;
  status: string;
  assignee?: string;
  createdAt?: string;
  closedBy?: string;
  humanQA?: Array<{ kind?: string }>;
}

/** Idle this long and the owner counts as away (D11). */
export const AWAY_AFTER_SEC = 30 * 60;
const MAX_BUFFER = 5000;

export class TelemetryStore {
  private buf: Array<TelemetryEvent & { office: string }> = [];
  /** office \t day -> failed writes not yet saved (D15). */
  private failed = new Map<string, number>();
  private lastCost = new Map<string, string>();
  private lastCards = new Map<string, Map<string, string>>();
  private away: boolean | null = null;
  private loggedFailure = false;

  constructor(
    private readonly db: () => Database.Database | null,
    private readonly office: () => string | null,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Queue one data point for the current office. */
  record(ev: TelemetryEvent): void {
    const office = this.office();
    if (!office) return;
    this.buf.push({ ...ev, office });
    if (this.buf.length >= MAX_BUFFER) this.flush();
  }

  /** Write the queued points in one transaction. A failure is counted for the
   *  day of each point it lost, and those days are left out of advice (D15). */
  flush(): void {
    if (!this.buf.length && !this.failed.size) return;
    const batch = this.buf;
    this.buf = [];
    const db = this.db();
    if (!db) { this.countFailures(batch); return; }
    try {
      const ins = db.prepare('INSERT INTO telemetry_events (office, agent_id, kind, ts, value, attrs) VALUES (?, ?, ?, ?, ?, ?)');
      const fail = db.prepare(`INSERT INTO telemetry_failures (office, day, count) VALUES (?, ?, ?)
        ON CONFLICT(office, day) DO UPDATE SET count = count + excluded.count`);
      db.transaction(() => {
        for (const e of batch) ins.run(e.office, e.agentId, e.kind, Math.round(e.ts), e.value ?? null, e.attrs ? JSON.stringify(e.attrs) : null);
        for (const [key, n] of this.failed) { const [office, day] = key.split('\t'); fail.run(office, day, n); }
      })();
      this.failed.clear();
      this.loggedFailure = false;
    } catch (e) {
      this.countFailures(batch);
      if (!this.loggedFailure) { this.loggedFailure = true; console.error('[pulse] telemetry write failed:', e); }
    }
  }

  private countFailures(batch: Array<TelemetryEvent & { office: string }>): void {
    for (const e of batch) {
      const key = `${e.office}\t${dayKey(e.ts)}`;
      this.failed.set(key, (this.failed.get(key) ?? 0) + 1);
    }
  }

  /** Days in an office with records that could not be saved, saved or pending. */
  failureDays(office: string): string[] {
    const days = new Set<string>();
    for (const key of this.failed.keys()) if (key.startsWith(`${office}\t`)) days.add(key.slice(office.length + 1));
    const db = this.db();
    if (db) {
      try {
        for (const r of db.prepare('SELECT day FROM telemetry_failures WHERE office = ?').all(office) as Array<{ day: string }>) days.add(r.day);
      } catch { /* the pending ones still count */ }
    }
    return [...days].sort();
  }

  /** A cost sample (running total). Stored only when it changed since the
   *  agent's last one for that session (eng review E4): repeats carry nothing. */
  cost(agentId: string, session: string, usd: number, tokens: number, model: string | null, ts = this.now()): void {
    if (!Number.isFinite(usd)) return;
    const key = `${agentId}\t${session}`;
    const sig = `${usd}|${tokens}`;
    if (this.lastCost.get(key) === sig) return;
    this.lastCost.set(key, sig);
    this.record({ agentId, kind: 'cost', ts, value: usd, attrs: { s: session, tokens, ...(model ? { model } : {}) } });
  }

  /** The 8 s tick's tasks: one card-status point per change (doneAt is the
   *  time a card reaches done). The first read of an office only remembers. */
  tasks(cards: CardLite[], ts = this.now()): void {
    const office = this.office();
    if (!office) return;
    const prev = this.lastCards.get(office);
    const next = new Map<string, string>();
    for (const c of cards) {
      if (!c || typeof c.id !== 'string' || typeof c.status !== 'string') continue;
      next.set(c.id, c.status);
      const was = prev?.get(c.id);
      if (!prev || was === c.status) continue;
      const excluded = c.closedBy === 'owner' || (Array.isArray(c.humanQA) && c.humanQA.some((e) => e?.kind === 'report'));
      this.record({
        agentId: c.assignee ?? null, kind: 'card-status', ts,
        attrs: { id: c.id, from: was ?? null, to: c.status, createdAt: c.createdAt ? Date.parse(c.createdAt) || null : null, ...(excluded ? { excluded: true } : {}) }
      });
    }
    this.lastCards.set(office, next);
  }

  /** The owner's presence from the system idle time (D11): away after 30
   *  minutes without input, or while the computer sleeps. */
  presence(idleSec: number, asleep: boolean, ts = this.now()): void {
    const away = asleep || idleSec >= AWAY_AFTER_SEC;
    if (away === this.away) return;
    this.away = away;
    this.record({ agentId: null, kind: 'presence', ts: away && !asleep ? ts - idleSec * 1000 : ts, value: away ? 1 : 0 });
  }

  /** Points after a cursor, oldest first, for the processor. */
  eventsAfter(office: string, afterId: number, limit = 5000): TelemetryRow[] {
    const db = this.db();
    if (!db) return [];
    const rows = db.prepare('SELECT id, office, agent_id, kind, ts, value, attrs FROM telemetry_events WHERE office = ? AND id > ? ORDER BY id LIMIT ?')
      .all(office, afterId, limit) as Array<{ id: number; office: string; agent_id: string | null; kind: TelemetryKind; ts: number; value: number | null; attrs: string | null }>;
    return rows.map((r) => {
      let attrs: Record<string, unknown> | undefined;
      try { attrs = r.attrs ? JSON.parse(r.attrs) : undefined; } catch { attrs = undefined; }
      return { id: r.id, office: r.office, agentId: r.agent_id, kind: r.kind, ts: r.ts, ...(r.value !== null ? { value: r.value } : {}), ...(attrs ? { attrs } : {}) };
    });
  }
}
