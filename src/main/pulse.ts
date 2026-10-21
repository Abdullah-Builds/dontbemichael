/**
 * The Pulse service (docs/designs/team-performance.md): builds what the Pulse
 * view shows from the telemetry store, and carries out the owner's clicks on
 * ways to save. Nothing here changes a schedule or a model on its own: apply,
 * undo and dismiss run only from the owner's click (memory 2026-10-10, D10).
 *
 *   view ─ pulse:snapshot(period, compare) ─► snapshot() ─► pulseSnapshot (the period, and with
 *                                          Compare the span before) + adviceFor + savings + headroom
 *   view ─ pulse:apply    ─► apply()    ─► schedule: compare and set in config
 *                                          model: checked here, set by the renderer's roster
 *   view ─ pulse:undo / pulse:dismiss
 *   view ─ pulse:held(fromMs, toMs) ─► held() ─► private/held.jsonl rows (the held tile's list)
 *   view ─ pulse:checked(fromMs, toMs, way) ─► checked() ─► private/checked.jsonl rows (questions and answers lists)
 */
import type Database from 'better-sqlite3';
import type { ScheduledMission } from '../shared/missions';
import {
  compareFrom, dayKey, keptAsIs, measuredSaving, MIN_DECISIONS, periodRange, planHeadroom, previousRange, pulseSnapshot,
  type AskFact, type DayRange, type Period, type PlanReading, type PulseSnapshot
} from '../shared/teamPerformance';
import { adviceFor, visibleAdvice, ADVICE_WINDOW_MS, EARLY_SCALE, type Advice, type Dismissal, type EarlyMode, type LadderModel, type MissionFact } from '../shared/teamAdvice';
import { keptSafe, type KeptSafe } from '../shared/pulseSafety';
import { planCostFor, scaleSnapshot, type PlanPrice } from '../shared/claudePlan';
import { countFromDay, learnedNotes, learning, type AddedNote, type LearnedNote, type NoteFact } from '../shared/teamLearning';
import { parseHeld, type HeldRow } from '../shared/heldRecord';
import { parseChecked, type CheckedList, type CheckedRow } from '../shared/checkedRecord';
import { countFor, foundationsPulse, replayFoundations, type FoundationEvent, type FoundationJob, type FoundationsPulse } from '../shared/foundations';
import type { TelemetryStore } from './telemetryStore';
import type { TelemetryProcessor } from './telemetryProcessor';

export interface PulseDeps {
  db: () => Database.Database | null;
  store: TelemetryStore;
  processor: TelemetryProcessor;
  office: () => string | null;
  members: () => Array<{ id: string; isGod: boolean }>;
  godId: () => string | null;
  /** Cards with their asks (humanQA), from the board. */
  tasks: () => Array<{ humanQA?: Array<{ kind?: string; askedAt?: string; answeredAt?: string; raisedBy?: string }> }>;
  missions: () => ScheduledMission[];
  /** Each member's provider and model, from the roster. */
  models: () => Array<{ agentId: string; provider: string; model: string | null }>;
  ladder: () => LadderModel[];
  priceOf: (model: string) => number | undefined;
  applyMissions: (change: (list: ScheduledMission[]) => ScheduledMission[] | null) => { ok: boolean; error?: string };
  billing: () => 'account' | 'apiKey';
  /** The owner's plan and its monthly price (Settings first, else detected); null on an API key. */
  plan: () => PlanPrice | null;
  /** Members' memory notes (id, date, source and the line itself) and procedure counts. */
  memory: () => { notes: NoteFact[]; procedures: Record<string, number> };
  /** The held list's private record as text (private/held.jsonl), '' when none. */
  readHeld?: () => string;
  /** private/checked.jsonl, the lists of what the check let through or stopped. */
  readChecked?: () => string | Promise<string>;
  now?: () => number;
  /** Each member's job, for Company foundations (office-foundations.md). */
  memberJobs?: () => Record<string, FoundationJob[]>;
  /** The foundations record's answers: what is answered now, whatever the
   *  events say (an event can be lost or pruned). */
  foundationsAnswers?: () => Partial<Record<string, { at: string }>>;
}

export type { AppliedChange, PulseView } from '../shared/pulseView';
import type { AppliedChange, PulseView } from '../shared/pulseView';

/** Window lengths by Claude Code's rate limit names. */
function windowMs(name: string): number {
  return /five_hour|5h/i.test(name) ? 5 * 3_600_000 : 7 * 86_400_000;
}

/** At most this many early lines, the most evidence first. */
export const EARLY_MAX = 3;
/** The early lines to show: the most evidence first, at most EARLY_MAX. */
export function earliest(all: Advice[]): Advice[] {
  const weight = (a: Advice): number => a.evidence.runs ?? (a.evidence.decisions ?? 0) + (a.evidence.reopens ?? 0);
  return [...all].sort((a, b) => weight(b) - weight(a)).slice(0, EARLY_MAX);
}

export class PulseService {
  private reading: PlanReading | null = null;
  constructor(private readonly d: PulseDeps) {}
  private now(): number { return this.d.now ? this.d.now() : Date.now(); }

  /** A status line's usage windows: keep the most constrained one (E6). */
  noteRateLimits(rateLimits: unknown, at = this.now()): void {
    if (!rateLimits || typeof rateLimits !== 'object') return;
    let best: PlanReading | null = null;
    for (const [name, w] of Object.entries(rateLimits as Record<string, { used_percentage?: unknown; resets_at?: unknown }>)) {
      const pct = typeof w?.used_percentage === 'number' ? w.used_percentage : NaN;
      const resets = typeof w?.resets_at === 'number' ? w.resets_at * 1000 : NaN;
      if (!(pct >= 0) || !(resets > at)) continue;
      if (!best || pct > best.usedPct) best = { usedPct: pct, resetsAt: resets, windowMs: windowMs(name), at };
    }
    if (best) this.reading = best;
  }

  private asks(): AskFact[] {
    const out: AskFact[] = [];
    for (const c of this.d.tasks()) for (const e of c.humanQA ?? []) {
      if (!e || e.kind === 'report' || !e.raisedBy || !e.askedAt) continue;
      const askedAt = Date.parse(e.askedAt);
      if (!Number.isFinite(askedAt)) continue;
      const answeredAt = e.answeredAt ? Date.parse(e.answeredAt) : NaN;
      out.push({ raisedBy: e.raisedBy, askedAt, ...(Number.isFinite(answeredAt) ? { answeredAt } : {}) });
    }
    return out;
  }

  /**
   * Company foundations from harness.db (eng finding 4): the strip, each
   * member's count, and, once a member has enough work on both sides of the
   * day its hit questions were answered, kept as is without and with them.
   */
  foundations(office: string): FoundationsPulse {
    const db = this.d.db();
    const jobs = this.d.memberJobs?.() ?? {};
    if (!db) return { jobs: [], members: {} };
    let rows: Array<{ agent_id: string | null; ts: number; attrs: string | null }> = [];
    try { rows = db.prepare("SELECT agent_id, ts, attrs FROM telemetry_events WHERE office = ? AND kind = 'foundation' ORDER BY id").all(office) as typeof rows; } catch { return { jobs: [], members: {} }; }
    const events: FoundationEvent[] = [];
    for (const r of rows) {
      try {
        const a = r.attrs ? JSON.parse(r.attrs) as { q?: unknown; change?: unknown } : {};
        if (typeof a.q === 'string' && (a.change === 'answered' || a.change === 'changed' || a.change === 'cleared' || a.change === 'hit')) events.push({ agentId: r.agent_id, ts: r.ts, q: a.q, change: a.change });
      } catch { /* a broken row */ }
    }
    const state = replayFoundations(events);
    // The record says what is answered now; the events say when and who hit it.
    const answers = this.d.foundationsAnswers?.();
    if (answers) {
      for (const q of [...state.answeredAt.keys()]) if (!answers[q]) state.answeredAt.delete(q);
      for (const [q, a] of Object.entries(answers)) {
        const at = a ? Date.parse(a.at) : NaN;
        if (!state.answeredAt.has(q as never) && Number.isFinite(at)) state.answeredAt.set(q as never, at);
      }
    }
    const out = foundationsPulse(state, jobs);
    // The proof (D14): the first of a member's hit questions answered splits its
    // work in two; each side needs half the evidence advice needs.
    const firsts = new Map<string, { q: FoundationEvent['q']; at: number }>();
    for (const agentId of Object.keys(jobs)) {
      for (const [q, by] of state.hits) {
        const at = state.answeredAt.get(q);
        const was = firsts.get(agentId);
        if (at !== undefined && by.has(agentId) && (!was || at < was.at)) firsts.set(agentId, { q, at });
      }
    }
    if (!firsts.size) return out;
    const since = this.now() - 90 * 86_400_000;
    const cards = this.d.processor.cards(office, since);
    const decisions = this.d.processor.decisions(office, since);
    const min = Math.ceil(MIN_DECISIONS * EARLY_SCALE);
    for (const [agentId, first] of firsts) {
      const at = first.at;
      const before = keptAsIs(agentId, decisions.filter((d) => d.at < at), cards.filter((c) => (c.doneAt ?? 0) < at), min).share;
      const after = keptAsIs(agentId, decisions.filter((d) => d.at >= at), cards.filter((c) => (c.doneAt ?? 0) >= at), min).share;
      if (before === null || after === null) continue;
      const proof = { without: before, with: after, question: first.q as never };
      const c = countFor(new Set<string>(state.answeredAt.keys()), jobs[agentId]);
      out.members[agentId] = out.members[agentId] ? { ...out.members[agentId], proof } : { answered: c.answered, total: c.total, missing: [], more: 0, proof };
    }
    return out;
  }

  private dismissed(office: string): Dismissal[] {
    const db = this.d.db();
    if (!db) return [];
    return (db.prepare('SELECT advice_id AS id, band, at FROM telemetry_dismissed WHERE office = ?').all(office) as Dismissal[]);
  }

  appliedChanges(office: string): AppliedChange[] {
    const db = this.d.db();
    if (!db) return [];
    return (db.prepare('SELECT * FROM telemetry_applied WHERE office = ? ORDER BY id').all(office) as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id), adviceId: String(r.advice_id), agentId: String(r.agent_id), kind: String(r.kind),
      before: JSON.parse(String(r.before)), after: JSON.parse(String(r.after)), at: Number(r.at), undoneAt: r.undone_at === null ? null : Number(r.undone_at)
    }));
  }

  /** Every suggestion the last 14 days support, before dismissals. In the
   *  early mode, what the live days so far show at half the evidence (eng D1). */
  private allAdvice(office: string, early?: EarlyMode): Advice[] {
    const now = this.now();
    const since = early ? Math.max(early.from, now - ADVICE_WINDOW_MS) : now - ADVICE_WINDOW_MS;
    const days = this.d.processor.days(office, dayKey(since)).filter((x) => x.day >= dayKey(since));
    const cards = this.d.processor.cards(office, since);
    const decisions = this.d.processor.decisions(office, since);
    const godId = this.d.godId();
    const missions: MissionFact[] = this.d.missions()
      .filter((m) => m.enabled && (m.kind ?? 'dispatch') === 'dispatch')
      .map((m) => ({ id: m.id, to: m.to === 'god' && godId ? godId : m.to, label: m.label, intervalMs: m.intervalMs, timed: !!(m.times?.length || m.weekly) }));
    const members = this.d.models().map((m) => {
      const mine = days.filter((x) => x.agentId === m.agentId);
      const kept = keptAsIs(m.agentId, decisions, cards, early ? Math.ceil(MIN_DECISIONS * early.scale) : undefined);
      return {
        agentId: m.agentId, provider: m.provider, model: m.model, isGod: m.agentId === godId,
        pieces: mine.reduce((s, x) => s + x.emails + x.sent + x.tasks + x.checks, 0),
        mailDecisions: decisions.filter((x) => x.agentId === m.agentId && x.decision !== 'cancelled').length,
        keptShare: kept.share, keptDecisions: kept.decisions,
        reopens: cards.filter((c) => c.assignee === m.agentId && c.reopened).length,
        usdPerWeek: mine.reduce((s, x) => s + x.usd, 0) / 2
      };
    });
    // A change the owner applied in the window makes the evidence before it
    // stale: that suggestion waits for 14 days of new records.
    const recent = new Set(this.appliedChanges(office).filter((a) => a.undoneAt === null && a.at >= since).map((a) => a.adviceId));
    return adviceFor({
      now, runs: this.d.processor.runs(office, since), missions, members,
      ladder: this.d.ladder(), gapDays: this.d.store.failureDays(office), priceOf: this.d.priceOf
    }, early).filter((a) => !recent.has(a.id));
  }

  snapshot(period: Period, compare = false): PulseView {
    const office = this.d.office();
    const now = this.now();
    const billing = this.d.billing();
    const godId = this.d.godId();
    const db = this.d.db();
    const range = periodRange(period, now);
    const empty = pulseSnapshot({ period, now, days: [], cards: [], decisions: [], asks: [], members: [] });
    if (!office || !db) return { available: false, billing, collectingSince: null, liveSince: null, snapshot: empty, advice: [], early: [], adviceFrom: null, saved: { state: 'none' }, headroom: null, applied: [], trend: {}, keptSafe: keptSafe([]), learning: learning({ notes: [], procedures: {}, asks: [], turns: [], range }), plan: null, compare: null, compareReady: false, compareFrom: null };
    const first = this.d.processor.firstDay(office);
    // Recommendations and Compare count from live recording, never from a backfill.
    const live = this.d.processor.firstDay(office, true);
    const readyFrom = live ? compareFrom(period, live) : null;
    const compareReady = readyFrom !== null && dayKey(now) >= readyFrom;
    const before = compare && compareReady ? previousRange(period, now) : null;
    const from = Math.min(range.fromMs, before?.fromMs ?? range.fromMs, now - ADVICE_WINDOW_MS);
    const ids = this.d.members().map((m) => m.id);
    const days = this.d.processor.days(office, dayKey(from));
    const cards = this.d.processor.cards(office, from);
    const decisions = this.d.processor.decisions(office, from);
    const asks = this.asks();
    const gapDays = this.d.store.failureDays(office);
    // On a plan, each member's dollars are their part of the plan's real cost
    // for the period, split by share of the work (owner, 2026-10-15).
    const price = billing === 'account' ? this.planPrice() : null;
    const measure = (r: DayRange): { snapshot: PulseSnapshot; keptSafe: KeptSafe; periodCost: number; payPerUse: number } => {
      const raw = pulseSnapshot({
        period, now, range: r, days, cards, decisions, asks, members: ids, gapDays,
        sentAsWritten: decisions.filter((x) => x.decision === 'approve' && x.at >= r.fromMs && x.at <= r.toMs).length,
        ...(godId ? { michael: { agentId: godId, ...this.d.processor.michaelCounts(office, godId, r.fromMs, r.toMs) } } : {})
      });
      const periodCost = price ? planCostFor(price.monthly, r.fromMs, r.toMs, now) : 0;
      return {
        snapshot: price && raw.totalUsd > 0 ? scaleSnapshot(raw, periodCost / raw.totalUsd) : raw,
        keptSafe: keptSafe(this.d.processor.safetyRows(office, r.from, r.to)),
        periodCost,
        payPerUse: raw.totalUsd
      };
    };
    const cur = measure(range);
    const prev = before ? measure(before) : null;
    const plan = price ? { label: price.label, monthly: price.monthly, source: price.source, periodCost: cur.periodCost, payPerUse: cur.payPerUse } : null;
    const firstMs = live ? new Date(`${live}T00:00:00`).getTime() : now;
    const adviceReady = now - firstMs >= ADVICE_WINDOW_MS;
    const applied = this.appliedChanges(office);
    return {
      available: true,
      billing,
      collectingSince: first,
      liveSince: live,
      snapshot: cur.snapshot,
      advice: adviceReady ? visibleAdvice(this.allAdvice(office), this.dismissed(office), now) : [],
      // Before advice can show: what the live days so far show, as facts (eng D1).
      early: adviceReady || !live ? [] : earliest(this.allAdvice(office, { from: firstMs, scale: EARLY_SCALE })),
      adviceFrom: adviceReady ? null : dayKey(firstMs + ADVICE_WINDOW_MS),
      saved: this.saved(office, applied),
      headroom: billing === 'account' ? planHeadroom(this.reading) : null,
      applied,
      trend: this.trend(office, ids, price),
      keptSafe: cur.keptSafe,
      learning: this.learning(office, range, before, asks),
      foundations: this.foundations(office),
      plan,
      compare: prev ? { snapshot: prev.snapshot, keptSafe: prev.keptSafe } : null,
      compareReady,
      compareFrom: readyFrom
    };
  }

  /** What was held in a span, newest first (owner, 2026-10-16). */
  held(fromMs: number, toMs: number): HeldRow[] {
    let text = '';
    try { text = this.d.readHeld?.() ?? ''; } catch { text = ''; }
    return text.split('\n').map(parseHeld).filter((r): r is HeldRow => !!r && r.at >= fromMs && r.at <= toMs).sort((a, b) => b.at - a.at);
  }

  /** What the check let through or stopped in a span, one way, newest first.
   *  Throws when the record can't be read, so the list says so (DD5). */
  /** Read off the main thread's hot path: the file holds whole texts for 62
   *  days (ship review 2026-10-17). */
  async checked(fromMs: number, toMs: number, way: 'in' | 'out'): Promise<CheckedList> {
    const text = (await this.d.readChecked?.()) ?? '';
    const all = text.split('\n').map(parseChecked).filter((r): r is CheckedRow => !!r && r.way === way);
    // The first kept row says from when words are kept (design DD4).
    const since = all.reduce<number | null>((m, r) => (m === null || r.at < m ? r.at : m), null);
    return { rows: all.filter((r) => r.at >= fromMs && r.at <= toMs).sort((a, b) => b.at - a.at), since };
  }

  private planPrice(): PlanPrice | null {
    try { return this.d.plan(); } catch { return null; }
  }

  /** Learning for the period and, with Compare, the span before. */
  private learning(office: string, range: DayRange, before: DayRange | null, asks: AskFact[]): PulseView['learning'] {
    const turns = new Map<string, number>();
    for (const d of this.d.processor.days(office, before && before.from < range.from ? before.from : range.from)) turns.set(d.day, (turns.get(d.day) ?? 0) + (d.turns ?? 0));
    let mem: { notes: NoteFact[]; procedures: Record<string, number> } = { notes: [], procedures: {} };
    try { mem = this.d.memory(); } catch { /* memory unreadable: the row shows what it has */ }
    const adds = this.adds(office, Math.min(range.fromMs, before?.fromMs ?? range.fromMs));
    return learning({ notes: mem.notes, ...adds, procedures: mem.procedures, asks, turns: [...turns].map(([day, t]) => ({ day, turns: t })), range, previous: before });
  }

  /** The office's `note-added` records since a time, and the day they count from. */
  private adds(office: string, since: number): { added: AddedNote[]; countFrom: string | null } {
    try {
      const countFrom = countFromDay(this.d.processor.firstNoteAdded(office));
      return { added: countFrom ? this.d.processor.notesAdded(office, since) : [], countFrom };
    } catch { return { added: [], countFrom: null }; }
  }

  /** The new notes behind the Learning number for a span of days (owner,
   *  2026-10-18), by the same rule as the count. */
  learned(from: string, to: string): LearnedNote[] {
    const office = this.d.office();
    if (!office || !this.d.db()) return [];
    const range: DayRange = { from, to, fromMs: new Date(`${from}T00:00:00`).getTime(), toMs: new Date(`${to}T23:59:59.999`).getTime() };
    let notes: NoteFact[] = [];
    try { notes = this.d.memory().notes; } catch { /* the records still list, without their text */ }
    return learnedNotes({ notes, ...this.adds(office, range.fromMs) }, range);
  }

  /** Value per week, last four weeks (this week last), per member; on a plan,
   *  each week's part of the plan's cost for that week. */
  private trend(office: string, ids: string[], price: PlanPrice | null): Record<string, number[]> {
    const now = this.now();
    const monday = new Date(periodRange('this-week', now).fromMs);
    monday.setDate(monday.getDate() - 21);
    const start = monday.getTime();
    const days = this.d.processor.days(office, dayKey(start));
    const out: Record<string, number[]> = {};
    for (const id of ids) out[id] = [0, 0, 0, 0];
    for (const d of days) {
      const w = Math.floor((new Date(`${d.day}T12:00:00`).getTime() - start) / (7 * 86_400_000));
      if (w >= 0 && w < 4) (out[d.agentId] ??= [0, 0, 0, 0])[w] += d.usd;
    }
    if (price) {
      const week = 7 * 86_400_000;
      for (let w = 0; w < 4; w++) {
        const total = Object.values(out).reduce((s, v) => s + v[w], 0);
        if (total <= 0) continue;
        const factor = planCostFor(price.monthly, start + w * week, start + (w + 1) * week - 1, now) / total;
        for (const v of Object.values(out)) v[w] *= factor;
      }
    }
    return out;
  }

  /** D16: measured savings of every change still in place. */
  private saved(office: string, applied: AppliedChange[]): PulseView['saved'] {
    const live = applied.filter((a) => a.undoneAt === null);
    if (!live.length) return { state: 'none' };
    const now = this.now();
    let usd = 0, measuring: number | null = null;
    for (const a of live) {
      const days = this.d.processor.days(office, dayKey(a.at - ADVICE_WINDOW_MS)).filter((x) => x.agentId === a.agentId);
      // Up to this member's next change still in place, so changes never overlap.
      const next = live.filter((b) => b.agentId === a.agentId && b.at > a.at).reduce<number | undefined>((m, b) => (m === undefined || b.at < m ? b.at : m), undefined);
      const r = measuredSaving(days, a.at, now, next);
      if (r.state === 'measuring') measuring = Math.min(measuring ?? r.firstAt, r.firstAt);
      else usd += r.usd;
    }
    const measuredAny = live.some((a) => now >= a.at + 7 * 86_400_000);
    if (!measuredAny && measuring !== null) return { state: 'measuring', firstAt: measuring };
    return { state: 'measured', usd, since: Math.min(...live.map((a) => a.at)) };
  }

  private record(office: string, adviceId: string, agentId: string, kind: string, before: unknown, after: unknown): number {
    const db = this.d.db();
    if (!db) return 0;
    const at = this.now();
    const r = db.prepare('INSERT INTO telemetry_applied (office, advice_id, agent_id, kind, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(office, adviceId, agentId, kind, JSON.stringify(before), JSON.stringify(after), at);
    this.d.store.record({ agentId, kind: 'advice-applied', ts: at, attrs: { advice: adviceId } });
    return Number(r.lastInsertRowid);
  }

  /** The owner's Apply. A schedule change is made here, compare and set; a
   *  model change is checked here and made by the renderer (it owns models). */
  apply(adviceId: string, expected: unknown): { ok: true; kind: 'schedule'; appliedId: number } | { ok: true; kind: 'model'; agentId: string; to: string; from: string | null } | { ok: false; error: 'stale' | 'unavailable' | 'failed' } {
    const office = this.d.office();
    if (!office || !this.d.db()) return { ok: false, error: 'unavailable' };
    const a = this.allAdvice(office).find((x) => x.id === adviceId);
    if (!a) return { ok: false, error: 'stale' };
    // The change the owner saw must still be the change: a double click or an
    // edit elsewhere since the view loaded is refused, never applied twice.
    if (JSON.stringify(expected) !== JSON.stringify(a.change)) return { ok: false, error: 'stale' };
    if (a.change.kind === 'interval') {
      const { fromMs, toMs } = a.change;
      const res = this.d.applyMissions((list) => {
        const m = list.find((x) => x.id === a.missionId);
        if (!m || m.intervalMs !== fromMs || m.times?.length || m.weekly) return null;
        return list.map((x) => (x.id === m.id ? { ...x, intervalMs: toMs } : x));
      });
      if (!res.ok) return { ok: false, error: res.error === 'not found' ? 'stale' : 'failed' };
      return { ok: true, kind: 'schedule', appliedId: this.record(office, a.id, a.agentId, 'schedule', { missionId: a.missionId, intervalMs: fromMs }, { missionId: a.missionId, intervalMs: toMs }) };
    }
    if (a.change.kind === 'model') {
      const current = this.d.models().find((m) => m.agentId === a.agentId)?.model ?? null;
      if (current !== a.change.from) return { ok: false, error: 'stale' };
      return { ok: true, kind: 'model', agentId: a.agentId, to: a.change.to, from: a.change.from };
    }
    return { ok: false, error: 'failed' };
  }

  /** After the renderer set the model, record it for savings and Undo. */
  modelApplied(adviceId: string, agentId: string, from: string | null, to: string): number {
    const office = this.d.office();
    return office ? this.record(office, adviceId, agentId, 'model', { model: from }, { model: to }) : 0;
  }

  /** Undo restores the exact previous setting, if nothing changed it since. */
  undo(appliedId: number): { ok: true; kind: 'schedule' } | { ok: true; kind: 'model'; agentId: string; to: string | null } | { ok: false; error: 'stale' | 'unavailable' } {
    const office = this.d.office();
    const db = this.d.db();
    if (!office || !db) return { ok: false, error: 'unavailable' };
    const a = this.appliedChanges(office).find((x) => x.id === appliedId && x.undoneAt === null);
    if (!a) return { ok: false, error: 'stale' };
    const mark = (): void => { db.prepare('UPDATE telemetry_applied SET undone_at = ? WHERE id = ?').run(this.now(), a.id); };
    if (a.kind === 'schedule') {
      const before = a.before as { missionId: string; intervalMs: number };
      const after = a.after as { intervalMs: number };
      const res = this.d.applyMissions((list) => {
        const m = list.find((x) => x.id === before.missionId);
        if (!m || m.intervalMs !== after.intervalMs) return null;
        return list.map((x) => (x.id === m.id ? { ...x, intervalMs: before.intervalMs } : x));
      });
      if (!res.ok) return { ok: false, error: 'stale' };
      mark();
      return { ok: true, kind: 'schedule' };
    }
    // The model too: only while it is still the one the change set.
    // (Still the old one is fine too: the roster may not have saved the change yet.)
    const current = this.d.models().find((m) => m.agentId === a.agentId)?.model ?? null;
    if (current !== (a.after as { model: string | null }).model && current !== (a.before as { model: string | null }).model) return { ok: false, error: 'stale' };
    mark();
    return { ok: true, kind: 'model', agentId: a.agentId, to: (a.before as { model: string | null }).model };
  }

  /** Not now: hidden until the evidence crosses its next band (D13). */
  dismiss(adviceId: string): boolean {
    const office = this.d.office();
    const db = this.d.db();
    if (!office || !db) return false;
    const a = this.allAdvice(office).find((x) => x.id === adviceId);
    if (!a) return false;
    db.prepare(`INSERT INTO telemetry_dismissed (office, advice_id, band, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(office, advice_id) DO UPDATE SET band = excluded.band, at = excluded.at`).run(office, a.id, a.band, this.now());
    return true;
  }
}
