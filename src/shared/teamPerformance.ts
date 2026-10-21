/**
 * Pulse's measures (docs/designs/team-performance.md): what got done, what it
 * would cost at API prices, each member's cost for the work against the
 * office's usual, your time, kept as is, speed, work while you were away, plan
 * headroom and measured savings. Pure: the telemetry processor feeds it daily
 * rollups and records, and the renderer shows what it returns.
 *
 * No electron or node imports: main calls it, tests load it directly.
 */

/** Kinds of finished work the office records. */
export type WorkKind = 'email' | 'sent' | 'task' | 'check';
export const WORK_KINDS: readonly WorkKind[] = ['email', 'sent', 'task', 'check'];

/** One member's day, folded by the processor from telemetry events. */
export interface MemberDay {
  agentId: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  /** Value at API prices (or spent, on an API key). */
  usd: number;
  /** Value spent inside this member's scheduled run windows. */
  runUsd: number;
  emails: number;
  sent: number;
  tasks: number;
  /** Scheduled runs that did work. */
  checks: number;
  /** Scheduled runs that found nothing to do. */
  checksNothing: number;
  /** Pieces of work done while the owner was away (D11). */
  awayPieces: number;
  /** Working time: from each request a member takes to its last reply (proposal 3). */
  busyMs?: number;
  /** Requests the member took. */
  turns?: number;
}

/** A card the office finished (or reopened), for speed and kept as is. */
export interface CardFact {
  id: string;
  assignee: string;
  createdAt: number;
  doneAt?: number;
  /** Time spent Blocked or Waiting before it was done. */
  heldMs: number;
  reopened: boolean;
  /** A report card (humanQA kind report) or one the owner closed: left out. */
  excluded: boolean;
}

export type MailDecisionKind = 'approve' | 'approve-edited' | 'changes' | 'decline' | 'cancelled';
export interface MailDecision { agentId: string; decision: MailDecisionKind; at: number }

/** An ask a member raised for the owner. */
export interface AskFact { raisedBy: string; askedAt: number; answeredAt?: number }

/** The owner's plan reading (officeBreak), the most constrained window. */
export interface PlanReading { usedPct: number; resetsAt: number; windowMs: number; at: number }

/** The periods Pulse offers (owner, 2026-10-16): one list for the select and main. */
export const PERIODS = ['today', 'this-week', 'this-month'] as const;
export type Period = typeof PERIODS[number];
export const isPeriod = (v: unknown): v is Period => (PERIODS as readonly unknown[]).includes(v);

/** Local day keys and the first and last moment of a span of whole days. */
export interface DayRange { from: string; to: string; fromMs: number; toMs: number }

/** Local day key for a time. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole local days from `start` to `end`, both midnight dates. */
function span(start: Date, end: Date): DayRange {
  const endMs = new Date(end); endMs.setHours(23, 59, 59, 999);
  return { from: dayKey(start.getTime()), to: dayKey(end.getTime()), fromMs: start.getTime(), toMs: endMs.getTime() };
}

/** The first and last local day of a period; weeks start on Monday (D8), a
 *  month is the calendar month. Built on dates, never millisecond sums, so a
 *  DST change never loses or doubles a day. */
export function periodRange(period: Period, now: number): DayRange {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return span(d, d);
  if (period === 'this-month') return span(new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return span(monday, sunday);
}

/** The span Compare sets against the period (owner, 2026-10-16): up to the same
 *  day. Today against all of yesterday; this week against last week's Monday to
 *  the same weekday; this month against last month's 1st to the same date,
 *  capped at that month's last day. */
export function previousRange(period: Period, now: number): DayRange {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') { const y = new Date(d); y.setDate(d.getDate() - 1); return span(y, y); }
  if (period === 'this-month') {
    const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
    return span(start, new Date(start.getFullYear(), start.getMonth(), Math.min(d.getDate(), last)));
  }
  const back = new Date(d); back.setDate(d.getDate() - 7);
  const monday = new Date(back); monday.setDate(back.getDate() - ((back.getDay() + 6) % 7));
  return span(monday, back);
}

/** The first day a period can compare: its span before starts on or after the
 *  first live recorded day (owner, 2026-10-16, D8), the day recommendations use. */
export function compareFrom(period: Period, liveSince: string): string {
  const t = new Date(`${liveSince}T12:00:00`);
  for (let i = 0; i < 100; i++) {
    if (previousRange(period, t.getTime()).from >= liveSince) return dayKey(t.getTime());
    t.setDate(t.getDate() + 1);
  }
  return dayKey(t.getTime());
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const piecesOf = (d: MemberDay): number => d.emails + d.sent + d.tasks + d.checks;

/** At least this many pieces of a kind before its cost per piece is shown or compared. */
export const MIN_PIECES = 5;
/** Kept as is shows counts until this many decisions, then a share. */
export const MIN_DECISIONS = 10;

export interface Outcome {
  kind: WorkKind;
  total: number;
  /** Who did it, largest first. */
  by: Array<{ agentId: string; count: number }>;
  /** Emails sent as written, or checks that found work. */
  sub?: number;
}

export type CostVerdict = 'cheaper' | 'usual' | 'pricier' | 'too-few';
export interface CostForWork {
  kind: WorkKind | null;
  /** This member's cost per piece of that kind. */
  perPiece: number | null;
  /** The office median for that kind. */
  usual: number | null;
  verdict: CostVerdict;
  /** Marker position on the bar, 0 (cheaper) to 1 (pricier), 0.5 = usual. */
  position: number;
}

export interface MemberMeasures {
  agentId: string;
  counts: Record<WorkKind, number>;
  checksNothing: number;
  usd: number;
  share: number;
  /** Cost per piece by kind, shown at MIN_PIECES or more. */
  perPiece: Partial<Record<WorkKind, number>>;
  costForWork: CostForWork;
  asks: number;
  askWaitMs: number | null;
  /** Kept as is: counts, and a share from MIN_DECISIONS. */
  kept: { kept: number; decisions: number; share: number | null };
  speedMs: number | null;
  awayShare: number | null;
  /** Working time in the period, and requests taken (Team at work). */
  busyMs: number;
  turns: number;
  /** Working time per day of the period, first day first. */
  dayBusy: number[];
}

export interface PulseSnapshot {
  period: Period;
  from: string;
  to: string;
  totalUsd: number;
  outcomes: Outcome[];
  members: MemberMeasures[];
  yourTime: { asks: number; medianWaitMs: number | null };
  awayShare: number | null;
  /** Days in the period with records that could not be saved (D15). */
  gapDays: string[];
  /** Michael's own tile (D7): requests routed, questions to you, cards opened. */
  michael: { agentId: string; routed: number; questions: number; cardsOpened: number; share: number } | null;
}

/** Cost per piece for one member's days: runs from run value, the rest share
 *  the value outside run windows in proportion to their counts (an estimate). */
export function perPieceOf(days: MemberDay[]): Partial<Record<WorkKind, number>> {
  let usd = 0, run = 0, emails = 0, sent = 0, tasks = 0, checks = 0;
  for (const d of days) { usd += d.usd; run += d.runUsd; emails += d.emails; sent += d.sent; tasks += d.tasks; checks += d.checks; }
  const out: Partial<Record<WorkKind, number>> = {};
  if (checks >= MIN_PIECES) out.check = run / checks;
  const outside = emails + sent + tasks;
  const each = outside > 0 ? Math.max(0, usd - run) / outside : 0;
  if (emails >= MIN_PIECES) out.email = each;
  if (sent >= MIN_PIECES) out.sent = each;
  if (tasks >= MIN_PIECES) out.task = each;
  return out;
}

/** D6: the member's main kind against the office median for that kind. */
export function costForWork(member: Record<WorkKind, number>, perPiece: Partial<Record<WorkKind, number>>, officeMedian: Partial<Record<WorkKind, number>>): CostForWork {
  const kinds = WORK_KINDS.filter((k) => perPiece[k] !== undefined && officeMedian[k] !== undefined);
  if (!kinds.length) return { kind: null, perPiece: null, usual: null, verdict: 'too-few', position: 0.5 };
  const kind = kinds.reduce((a, b) => (member[b] > member[a] ? b : a));
  const mine = perPiece[kind]!;
  const usual = officeMedian[kind]!;
  if (usual <= 0) return { kind, perPiece: mine, usual, verdict: 'usual', position: 0.5 };
  const ratio = mine / usual;
  const verdict: CostVerdict = ratio < 0.85 ? 'cheaper' : ratio > 1.15 ? 'pricier' : 'usual';
  const position = 0.5 + 0.4 * Math.max(-1, Math.min(1, Math.log2(Math.max(ratio, 1e-6))));
  return { kind, perPiece: mine, usual, verdict, position };
}

/** Kept as is (E2): drafts approved without edits plus finished cards never
 *  reopened, over drafts decided (not cancelled) plus finished cards. */
export function keptAsIs(agentId: string, decisions: MailDecision[], cards: CardFact[], minDecisions = MIN_DECISIONS): { kept: number; decisions: number; share: number | null } {
  let kept = 0, total = 0;
  for (const d of decisions) {
    if (d.agentId !== agentId || d.decision === 'cancelled') continue;
    total++;
    if (d.decision === 'approve') kept++;
  }
  for (const c of cards) {
    if (c.assignee !== agentId || c.excluded || c.doneAt === undefined) continue;
    total++;
    if (!c.reopened) kept++;
  }
  return { kept, decisions: total, share: total >= minDecisions ? kept / total : null };
}

/** The whole Pulse snapshot for a period. */
export function pulseSnapshot(input: {
  period: Period;
  now: number;
  /** The days to measure; the period's own range when left out. Compare runs
   *  this for the span before too, so its bars and the tile numbers come from
   *  one function (owner, 2026-10-16, D9). */
  range?: DayRange;
  days: MemberDay[];
  cards: CardFact[];
  decisions: MailDecision[];
  asks: AskFact[];
  members: string[];
  /** Emails sent as written in the period (approve without edits). */
  sentAsWritten?: number;
  gapDays?: string[];
  /** Michael's id and what he did in the period (counted by the processor). */
  michael?: { agentId: string; routed: number; cardsOpened: number };
}): PulseSnapshot {
  const { from, to, fromMs, toMs } = input.range ?? periodRange(input.period, input.now);
  const inRange = (t: number | undefined): boolean => t !== undefined && t >= fromMs && t <= toMs;
  const days = input.days.filter((d) => d.day >= from && d.day <= to);
  const ids = [...new Set([...input.members, ...days.map((d) => d.agentId)])];
  const byMember = new Map<string, MemberDay[]>();
  for (const d of days) byMember.set(d.agentId, [...(byMember.get(d.agentId) ?? []), d]);
  const totalUsd = days.reduce((s, d) => s + d.usd, 0);
  const periodDays: string[] = [];
  for (let t = fromMs; dayKey(t) <= to; t += 86_400_000) { const k = dayKey(t); if (!periodDays.includes(k)) periodDays.push(k); }

  const pieces = new Map(ids.map((id) => [id, perPieceOf(byMember.get(id) ?? [])]));
  const officeMedian: Partial<Record<WorkKind, number>> = {};
  for (const k of WORK_KINDS) {
    const m = median(ids.map((id) => pieces.get(id)![k]).filter((v): v is number => v !== undefined));
    if (m !== null) officeMedian[k] = m;
  }

  const members: MemberMeasures[] = ids.map((agentId) => {
    const mine = byMember.get(agentId) ?? [];
    const counts: Record<WorkKind, number> = { email: 0, sent: 0, task: 0, check: 0 };
    let usd = 0, nothing = 0, away = 0, all = 0;
    for (const d of mine) {
      counts.email += d.emails; counts.sent += d.sent; counts.task += d.tasks; counts.check += d.checks;
      usd += d.usd; nothing += d.checksNothing; away += d.awayPieces; all += piecesOf(d);
    }
    let busyMs = 0, turns = 0;
    const dayBusy = periodDays.map(() => 0);
    for (const d of mine) {
      busyMs += d.busyMs ?? 0; turns += d.turns ?? 0;
      const i = periodDays.indexOf(d.day);
      if (i >= 0) dayBusy[i] += d.busyMs ?? 0;
    }
    const asks = input.asks.filter((a) => a.raisedBy === agentId && inRange(a.askedAt));
    const waits = asks.filter((a) => a.answeredAt !== undefined).map((a) => a.answeredAt! - a.askedAt);
    const done = input.cards.filter((c) => c.assignee === agentId && !c.excluded && inRange(c.doneAt));
    const speed = median(done.map((c) => Math.max(0, c.doneAt! - c.createdAt - c.heldMs)));
    return {
      agentId,
      counts,
      checksNothing: nothing,
      usd,
      share: totalUsd > 0 ? usd / totalUsd : 0,
      perPiece: pieces.get(agentId)!,
      costForWork: costForWork(counts, pieces.get(agentId)!, officeMedian),
      asks: asks.length,
      askWaitMs: median(waits),
      kept: keptAsIs(agentId, input.decisions.filter((d) => inRange(d.at)), input.cards.filter((c) => inRange(c.doneAt))),
      speedMs: speed,
      awayShare: all > 0 ? away / all : null,
      busyMs,
      turns,
      dayBusy
    };
  });

  const outcome = (kind: WorkKind, sub?: number): Outcome => {
    const by = members.map((m) => ({ agentId: m.agentId, count: m.counts[kind] })).filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
    return { kind, total: by.reduce((s, b) => s + b.count, 0), by, ...(sub !== undefined ? { sub } : {}) };
  };
  const allAsks = input.asks.filter((a) => inRange(a.askedAt));
  const allPieces = days.reduce((s, d) => s + piecesOf(d), 0);
  return {
    period: input.period,
    from,
    to,
    totalUsd,
    outcomes: [
      outcome('email'),
      outcome('sent', input.sentAsWritten),
      outcome('task'),
      outcome('check', members.reduce((s, m) => s + m.counts.check, 0))
    ].map((o) => (o.kind === 'check' ? { ...o, total: o.total + members.reduce((s, m) => s + m.checksNothing, 0) } : o)),
    members: members.sort((a, b) => b.usd - a.usd),
    yourTime: { asks: allAsks.length, medianWaitMs: median(allAsks.filter((a) => a.answeredAt !== undefined).map((a) => a.answeredAt! - a.askedAt)) },
    awayShare: allPieces > 0 ? days.reduce((s, d) => s + d.awayPieces, 0) / allPieces : null,
    gapDays: (input.gapDays ?? []).filter((d) => d >= from && d <= to),
    michael: input.michael ? {
      agentId: input.michael.agentId,
      routed: input.michael.routed,
      questions: allAsks.filter((a) => a.raisedBy === input.michael!.agentId).length,
      cardsOpened: input.michael.cardsOpened,
      share: totalUsd > 0 ? (members.find((m) => m.agentId === input.michael!.agentId)?.usd ?? 0) / totalUsd : 0
    } : null
  };
}

/** E6: plan headroom. The pace warning shows once 20% of the window has passed
 *  and used% / (elapsed / window) is over 100%; `runsOutAt` is when used reaches
 *  100% at that pace. */
export function planHeadroom(r: PlanReading | null): { usedPct: number; resetsAt: number; runsOutAt: number | null } | null {
  if (!r || !Number.isFinite(r.usedPct) || r.windowMs <= 0) return null;
  const start = r.resetsAt - r.windowMs;
  const elapsed = Math.max(0, r.at - start);
  const frac = elapsed / r.windowMs;
  if (frac < 0.2 || r.usedPct <= 0) return { usedPct: r.usedPct, resetsAt: r.resetsAt, runsOutAt: null };
  const pace = r.usedPct / frac;
  if (pace <= 100) return { usedPct: r.usedPct, resetsAt: r.resetsAt, runsOutAt: null };
  const runsOutAt = start + (100 / r.usedPct) * elapsed;
  return { usedPct: r.usedPct, resetsAt: r.resetsAt, runsOutAt: runsOutAt < r.resetsAt ? runsOutAt : null };
}

/** D16: measured saving of one applied change for its member: (cost per piece
 *  in the 14 days before minus cost per piece since) times pieces since, at API
 *  prices. Measuring for the first 7 days; zero or negative is reported as is.
 *  `until`: when the member's next change was applied; this one is measured only
 *  up to that day, so two changes never count the same work (Codex review,
 *  2026-10-16). */
export function measuredSaving(days: MemberDay[], appliedAt: number, now: number, until?: number): { state: 'measuring'; firstAt: number } | { state: 'measured'; usd: number } {
  const firstAt = appliedAt + 7 * 86_400_000;
  if (now < firstAt) return { state: 'measuring', firstAt };
  const appliedDay = dayKey(appliedAt);
  const beforeFrom = dayKey(appliedAt - 14 * 86_400_000);
  const before = days.filter((d) => d.day >= beforeFrom && d.day < appliedDay);
  const lastDay = until === undefined ? null : dayKey(until);
  const after = days.filter((d) => d.day > appliedDay && (lastDay === null || d.day <= lastDay));
  const per = (ds: MemberDay[]): number | null => {
    const p = ds.reduce((s, d) => s + piecesOf(d), 0);
    return p > 0 ? ds.reduce((s, d) => s + d.usd, 0) / p : null;
  };
  const b = per(before), a = per(after);
  const since = after.reduce((s, d) => s + piecesOf(d), 0);
  if (b === null || a === null) return { state: 'measured', usd: 0 };
  return { state: 'measured', usd: (b - a) * since };
}

/** A Team at work callout (owner, 2026-10-15, proposal 3). */
export type WorkChip = { kind: 'busiest' } | { kind: 'times'; times: number } | { kind: 'quiet' } | { kind: 'costly'; perHour: number };

/** Below this much working time a member's value per hour is not judged. */
export const MIN_BUSY_FOR_RATE_MS = 10 * 60_000;

/** Team at work: the average, each member's callout, and what the headline says. */
export function teamAtWork(members: Array<{ agentId: string; busyMs: number; usd: number }>): {
  avgMs: number;
  totalMs: number;
  chips: Record<string, WorkChip>;
  /** The two busiest members' share of all working time, when there are three or more members. */
  topTwo: { ids: string[]; share: number } | null;
  quiet: string[];
  /** The member who cost the most for the least work, if one stands out. */
  costliest: { agentId: string; usd: number; busyMs: number } | null;
} {
  const totalMs = members.reduce((s, m) => s + m.busyMs, 0);
  const avgMs = members.length ? totalMs / members.length : 0;
  const chips: Record<string, WorkChip> = {};
  if (totalMs <= 0) return { avgMs, totalMs, chips, topTwo: null, quiet: [], costliest: null };
  const byBusy = [...members].sort((a, b) => b.busyMs - a.busyMs);
  const rates = members.filter((m) => m.busyMs >= MIN_BUSY_FOR_RATE_MS && m.usd > 0).map((m) => m.usd / (m.busyMs / 3_600_000));
  const usual = median(rates);
  let costliest: { agentId: string; usd: number; busyMs: number; perHour: number } | null = null;
  for (const m of members) {
    // Dollars may be a share of a flat plan, so any cost counts; the rate is what is compared.
    if (m.busyMs < MIN_BUSY_FOR_RATE_MS || m.usd <= 0 || usual === null || rates.length < 3) continue;
    const perHour = m.usd / (m.busyMs / 3_600_000);
    if (perHour >= 2 * usual) {
      chips[m.agentId] = { kind: 'costly', perHour };
      if (!costliest || perHour > costliest.perHour) costliest = { agentId: m.agentId, usd: m.usd, busyMs: m.busyMs, perHour };
    }
  }
  const quiet: string[] = [];
  byBusy.forEach((m, i) => {
    if (chips[m.agentId]) return;
    if (i === 0) chips[m.agentId] = { kind: 'busiest' };
    else if (avgMs > 0 && m.busyMs >= 2 * avgMs) chips[m.agentId] = { kind: 'times', times: Math.round((m.busyMs / avgMs) * 10) / 10 };
    // A member with no time at all is not "mostly quiet": Pulse folds them into
    // one "N more were quiet" row instead (eng review D1, 2026-10-19).
    else if (m.busyMs > 0 && m.busyMs < avgMs * 0.25) { chips[m.agentId] = { kind: 'quiet' }; quiet.push(m.agentId); }
  });
  const topTwo = members.length >= 3 ? { ids: byBusy.slice(0, 2).map((m) => m.agentId), share: (byBusy[0].busyMs + byBusy[1].busyMs) / totalMs } : null;
  return { avgMs, totalMs, chips, topTwo, quiet, costliest: costliest ? { agentId: costliest.agentId, usd: costliest.usd, busyMs: costliest.busyMs } : null };
}
