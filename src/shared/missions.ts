/**
 * Schedules (missions): the rules every surface shares. Main's scheduler, the
 * IPC operations, the router's schedule requests and the renderer all read
 * this one module, so "who owns a schedule", "when does it run next" and "what
 * does a run send" can't drift apart between them (eng review, 2026-09-25).
 *
 * Everything here is pure: no Electron, no config reads, no clocks except the
 * `now` a caller passes in. That is what lets test/missions.test.cjs pin the
 * scheduler's behavior with fake times.
 *
 * Ownership: a schedule belongs to the agent in `to`. Michael's schedules say
 * `'god'` (the router resolves that alias), and a legacy `'broadcast'` row is
 * Michael's too until migrateMissions rewrites it.
 */
import { normalizeWeekly, nextWeeklyFireMs, weeklyDelayMs } from './weeklySchedule';
import { formatEvery, formatTimes, normalizeLine, normalizeTimes, nextTimesFireMs, simpleTimes, timesDelayMs, type ScheduleLine } from './scheduleTimes';
import { formatWeekly } from './weeklySchedule';
import { scheduledRunBody, relayRunBody } from './scheduleMessage';

export interface ScheduledMission {
  id: string;
  label: string;
  intervalMs: number;
  /** Day-of-week + time. When present and valid it REPLACES `intervalMs`; the
   *  interval stays on the record so switching back restores it. */
  weekly?: { days: number[]; minute: number };
  /** Several "when" lines (src/shared/scheduleTimes.ts). When present and valid
   *  they REPLACE both `intervalMs` and `weekly`. A single plain line is stored
   *  as `intervalMs` or `weekly` instead, so this is set only when needed. */
  times?: ScheduleLine[];
  /** The agent that owns and runs this schedule: an agent id, or `'god'` for
   *  Michael. (`'broadcast'` only on rows migrateMissions has not seen yet.) */
  to: string;
  /** A legacy prompt on older schedules (sent after the standard message), or
   *  the heartbeat's own description. New schedules leave it empty. */
  body: string;
  /** The job's focus area (docs/designs/schedule-focus-areas.md, FA1): what the
   *  agent concentrates on when this job runs, within its Work style, in plain
   *  words. Sent only in the run message (FA2). Required on new jobs; older
   *  jobs without one keep running as before (FA4). */
  focus?: string;
  enabled: boolean;
  autoCompact?: boolean;
  lastFiredAt?: number;
  /** When its current times took effect: added, turned on, or given new times.
   *  A slot before this was never the schedule's to run, so it is not "missed"
   *  (catchUpFloor). Main stamps it; absent on rows from before it existed. */
  scheduledSince?: number;
  kind?: 'dispatch' | 'heartbeat' | 'compact';
  quietThresholdMs?: number;
  /** Who added it: `'owner'`, or the id of the agent whose request the owner
   *  approved in ASK ME. Absent on rows from before this existed (= owner). */
  createdBy?: string;
  /** A former "everyone" schedule: Michael gets it and hands the job out. */
  relay?: boolean;
  /** Who approved the request that set it: 'michael' or 'owner'. */
  approvedBy?: 'michael' | 'owner';
}

export const OWNER = 'owner';

/** The longest focus area a job keeps. */
export const FOCUS_MAX = 600;

/** A focus area as stored: trimmed, one paragraph, capped; undefined when empty. */
export function cleanFocus(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, FOCUS_MAX);
  return t || undefined;
}

/**
 * The "Scheduled jobs" lines added to an agent's Work style at session start
 * (FA2): each enabled job's name and times, without its focus, which comes
 * with the run. Null when the agent has no jobs.
 */
export function scheduledJobsBlock(missions: ScheduledMission[], agentId: string, godId: string): string | null {
  const jobs = missionsFor(missions, agentId, godId).filter((m) => m.enabled && (m.kind ?? 'dispatch') === 'dispatch');
  if (!jobs.length) return null;
  return [
    '### Scheduled jobs',
    ...jobs.map((m) => `- ${m.label.trim()}: ${whenWords(m)}`),
    'Each job\'s focus comes with its run message and applies to that run only. Everything else you do follows this Work style alone.'
  ].join('\n');
}
export const GOD_ALIAS = 'god';

/** The agent id that owns `m`. Michael's aliases collapse to `godId`. */
export function ownerOf(m: Pick<ScheduledMission, 'to'>, godId: string): string {
  return m.to === GOD_ALIAS || m.to === 'broadcast' ? godId : m.to;
}

/** The schedules `agentId` owns, in stored order. */
export function missionsFor(missions: ScheduledMission[], agentId: string, godId: string): ScheduledMission[] {
  return missions.filter((m) => ownerOf(m, godId) === agentId);
}

/** A job that sends its agent to the mailbox: the name or focus speaks of the
 *  inbox, or of checking, reading or sorting email. */
const MAIL_CHECK = /\b(?:inbox|mailbox(?:es)?)\b|\b(?:check|read|triage|sort|clear)(?:\s+(?!and\b|then\b|to\b)\w+){0,2}\s+e-?mails?\b/i;

/** True when `m` is a running job that looks in the mailbox and its agent has
 *  no way to: its email is off and it holds no Gmail connector that is on
 *  (`gmail`). The hook refuses the mail call, so each run is a wasted turn
 *  (docs/designs/multi-mailbox.md); the schedules say so beside the job. */
export function cannotCheckEmail(m: ScheduledMission, email: { enabled: boolean } | undefined, gmail = false): boolean {
  if (!m.enabled || (m.kind ?? 'dispatch') !== 'dispatch' || email?.enabled || gmail) return false;
  return MAIL_CHECK.test(`${m.label} ${m.focus ?? ''} ${m.body}`);
}

/** May `actor` (an agent id) ask for a change to `m`? Only its own. */
export function canEdit(actor: string, m: Pick<ScheduledMission, 'to'>, godId: string): boolean {
  return ownerOf(m, godId) === actor;
}

/** When this schedule runs next, or null when it can't say (off, unusable, or
 *  an interval schedule that has never fired). Matches what the scheduler arms. */
export function nextRunAt(m: ScheduledMission, now: number): number | null {
  if (!m.enabled) return null;
  const times = m.kind === 'heartbeat' ? null : normalizeTimes(m.times);
  if (times) return nextTimesFireMs(times, now);
  const weekly = m.kind === 'heartbeat' ? null : normalizeWeekly(m.weekly);
  if (weekly) return nextWeeklyFireMs(weekly, now);
  if (!(m.intervalMs > 0)) return null;
  return m.lastFiredAt ? m.lastFiredAt + m.intervalMs : null;
}

/**
 * One-time upgrade of stored schedules to per-agent ownership:
 * - an "everyone" row becomes Michael's, marked `relay` so the run tells him to
 *   hand the job out (design 3A);
 * - a row with no `createdBy` is the owner's.
 * Idempotent: a second pass changes nothing.
 */
export function migrateMissions(missions: ScheduledMission[]): { missions: ScheduledMission[]; changed: boolean } {
  let changed = false;
  const out = missions.map((m) => {
    let next = m;
    if (next.to === 'broadcast') { next = { ...next, to: GOD_ALIAS, relay: true }; changed = true; }
    if (!next.createdBy) { next = { ...next, createdBy: OWNER }; changed = true; }
    return next;
  });
  return { missions: out, changed };
}

/** Saved before the 24 day ceiling: the timer can't wait longer, so the stored
 *  value, the Schedules tab and the timer all say 24 days. Runs on every load,
 *  not once (review, 2026-09-25). */
export function clampIntervals(missions: ScheduledMission[]): { missions: ScheduledMission[]; changed: boolean } {
  let changed = false;
  const out = missions.map((m) => {
    if (!(m.intervalMs > MAX_INTERVAL_MS)) return m;
    changed = true;
    return { ...m, intervalMs: MAX_INTERVAL_MS };
  });
  return { missions: out, changed };
}

/* ─────────────────────────────── the scheduler ─────────────────────────────── */

export type ArmPlan =
  | { type: 'skip' }
  | { type: 'heartbeat' }
  /** Self-rescheduling weekly slots; `firstDelayMs` is the first wait (0 = a
   *  missed slot to catch up now). Later waits are recomputed at each re-arm. */
  | { type: 'weekly'; weekly: { days: number[]; minute: number }; firstDelayMs: number }
  /** Several "when" lines; self-rescheduling like weekly. */
  | { type: 'times'; times: ScheduleLine[]; firstDelayMs: number }
  /** Wait `firstDelayMs`, fire, then fire every `everyMs`. */
  | { type: 'interval'; firstDelayMs: number; everyMs: number };

export interface ArmContext {
  /** Id of the built-in standup, which waits for the office to open. */
  standupId: string;
  /** Has the standup already been sent on this launch (standupOnOfficeOpen)? */
  standupFiredThisLaunch: boolean;
}

/** The time before which a passed slot is not a missed run: the later of the
 *  last run and when the current times took effect. Without the second, a job
 *  added at 14:00 for "weekdays at 09:00" ran at once, as if 09:00 was missed. */
export function catchUpFloor(m: ScheduledMission): number {
  return Math.max(m.lastFiredAt ?? 0, m.scheduledSince ?? 0);
}

/** How the scheduler should arm `m` at `now`. The same decisions syncMissions
 *  made inline before this module existed; see test/missions.test.cjs. */
export function armPlan(m: ScheduledMission, now: number, ctx: ArmContext): ArmPlan {
  if (!m.enabled) return { type: 'skip' };
  const times = m.kind === 'heartbeat' ? null : normalizeTimes(m.times);
  if (times) {
    const firstDelayMs = timesDelayMs(times, now, catchUpFloor(m));
    return firstDelayMs === null ? { type: 'skip' } : { type: 'times', times, firstDelayMs };
  }
  // A weekly mission needs no interval, so the interval guard comes after it.
  const weekly = m.kind === 'heartbeat' ? null : normalizeWeekly(m.weekly);
  if (!weekly && !(m.intervalMs > 0)) return { type: 'skip' };
  if (m.kind === 'heartbeat') return { type: 'heartbeat' };
  if (weekly) {
    const firstDelayMs = weeklyDelayMs(weekly, now, catchUpFloor(m));
    return firstDelayMs === null ? { type: 'skip' } : { type: 'weekly', weekly, firstDelayMs };
  }
  // Honor lastFiredAt so an edit elsewhere doesn't restart this interval from
  // zero. The standup waits a full interval until the office opens, because its
  // launch fire is sent by standupOnOfficeOpen.
  const waitForOpen = m.id === ctx.standupId && !ctx.standupFiredThisLaunch;
  const everyMs = Math.min(m.intervalMs, MAX_TIMER_MS);
  const firstDelayMs = waitForOpen ? everyMs : Math.min(MAX_TIMER_MS, Math.max(0, m.intervalMs - (now - (m.lastFiredAt ?? 0))));
  return { type: 'interval', firstDelayMs, everyMs };
}

/** What one run sends, or null for a compaction-only mission (no dispatch). */
export function firePayload(m: ScheduledMission): { to: string; subject: string; body: string } | null {
  if (m.kind === 'compact') return null;
  return {
    to: m.to,
    subject: m.label,
    body: m.relay ? relayRunBody(m.label, m.body, m.focus) : scheduledRunBody(m.label, m.body, m.focus)
  };
}

/* ───────────────────────────────── run now ───────────────────────────────── */
// The owner runs one job at once, to see it work without waiting for its clock
// (docs/designs/schedule-run-now.md). A run now sends exactly what the clock
// sends (firePayload) and stamps lastFiredAt the same way, so it is a real run.

/** How soon after a run the same job can be run again by hand. A double click,
 *  or a click right after the clock fired, would otherwise send the job twice. */
export const RUN_NOW_GAP_MS = 60_000;

export type RunNowCheck =
  | { ok: true; mission: ScheduledMission }
  | { ok: false; error: 'not found' | 'not a job' | 'just ran' };

/** May the schedule `id` be run now? Only a job (a dispatch schedule) can: the
 *  heartbeat is the office's own pulse and a compact row sends nothing. A paused
 *  job can, so the owner can try it before turning it on. */
export function runNowCheck(list: ScheduledMission[], id: string, now: number): RunNowCheck {
  const mission = list.find((m) => m.id === id);
  if (!mission) return { ok: false, error: 'not found' };
  if ((mission.kind ?? 'dispatch') !== 'dispatch' || !firePayload(mission)) return { ok: false, error: 'not a job' };
  const last = mission.lastFiredAt ?? 0;
  if (last > 0 && now >= last && now - last < RUN_NOW_GAP_MS) return { ok: false, error: 'just ran' };
  return { ok: true, mission };
}

/** What a row says after main answers a run now: sent, ran a moment ago (the
 *  gap above), or failed for any other reason. */
export function runNowOutcome(res: { ok: boolean; error?: string }): 'sent' | 'justRan' | 'failed' {
  if (res.ok) return 'sent';
  return res.error === 'just ran' ? 'justRan' : 'failed';
}

/* ──────────────────────────── one-schedule edits ──────────────────────────── */
// Each operation names the one schedule it changes and is applied by main to the
// list it reads at that moment, so a screen opened earlier can never delete a
// schedule it didn't know about (eng review R2).

/** What decides when a schedule runs. A change here is new times. */
function timingKey(m: ScheduledMission): string {
  return JSON.stringify([m.kind ?? 'dispatch', m.intervalMs, normalizeWeekly(m.weekly), normalizeTimes(m.times)]);
}

/** `m` with `scheduledSince` set: `now` when its times just took effect, else
 *  the stored value. Without a `now` nothing is stamped. */
function withSince(m: ScheduledMission, since: number | undefined): ScheduledMission {
  const out = { ...m };
  if (since === undefined) delete out.scheduledSince; else out.scheduledSince = since;
  return out;
}

/** Insert or replace `incoming` by id. `lastFiredAt` is the scheduler's, so the
 *  newer of the two stamps wins; `createdBy` is never rewritten by an edit.
 *  With `now`, a new schedule, new times or turning it on set `scheduledSince`
 *  (catchUpFloor); otherwise the stored value stands, whatever the caller sent. */
export function upsertMission(list: ScheduledMission[], incoming: ScheduledMission, now?: number): ScheduledMission[] {
  const prev = list.find((m) => m.id === incoming.id);
  if (!prev) {
    const added = { ...incoming, createdBy: incoming.createdBy ?? OWNER };
    return [...list, now === undefined ? added : withSince(added, now)];
  }
  const lastFiredAt = Math.max(incoming.lastFiredAt ?? 0, prev.lastFiredAt ?? 0) || undefined;
  const merged: ScheduledMission = { ...incoming, lastFiredAt, createdBy: prev.createdBy ?? incoming.createdBy ?? OWNER };
  // An explicit `weekly: undefined` is the switch back to interval mode, and
  // an absent or undefined `times` drops the extra lines.
  if (!('weekly' in incoming) || incoming.weekly === undefined) delete merged.weekly;
  if (!('times' in incoming) || incoming.times === undefined) delete merged.times;
  const restarted = timingKey(merged) !== timingKey(prev) || (merged.enabled && !prev.enabled);
  const since = now !== undefined && restarted ? now : prev.scheduledSince;
  return list.map((m) => (m.id === incoming.id ? withSince(merged, since) : m));
}

export function deleteMission(list: ScheduledMission[], id: string): ScheduledMission[] {
  return list.filter((m) => m.id !== id);
}

/** Turn one schedule on or off. Null when there is no such schedule. With
 *  `now`, turning it on sets `scheduledSince`, so a slot that passed while it
 *  was off is not run. */
export function setMissionEnabled(list: ScheduledMission[], id: string, on: boolean, now?: number): ScheduledMission[] | null {
  if (!list.some((m) => m.id === id)) return null;
  return list.map((m) => {
    if (m.id !== id) return m;
    const next = { ...m, enabled: on };
    return on && !m.enabled && now !== undefined ? withSince(next, now) : next;
  });
}

/** Pause every schedule `agentId` owns (the owner closed that agent, design 6A
 *  as amended by eng review R1). Returns how many were switched off. */
export function pauseMissionsOf(list: ScheduledMission[], agentId: string, godId: string): { missions: ScheduledMission[]; paused: number } {
  let paused = 0;
  const missions = list.map((m) => {
    if (!m.enabled || ownerOf(m, godId) !== agentId) return m;
    paused++;
    return { ...m, enabled: false };
  });
  return { missions, paused };
}

/* ───────────────────────── agent schedule requests ───────────────────────── */
// An agent never changes a schedule itself (owner, 2026-09-25). It sends a
// request from its outbox; the owner approves or declines it in ASK ME, and only
// an approval applies the change.

export type ScheduleOp = 'add' | 'update' | 'pause' | 'resume' | 'delete';

/** The schedule an add or update proposes. */
export interface ScheduleDraft {
  label: string;
  intervalMs: number;
  /** An update that set new times (false: a rename only). */
  whenGiven?: boolean;
  weekly?: { days: number[]; minute: number };
  times?: ScheduleLine[];
  /** The job's focus area (FA1): required on an add, optional on an update. */
  focus?: string;
}

export interface ScheduleRequest {
  id: string;
  /** The asking agent (from its outbox folder, never from the message). */
  agentId: string;
  op: ScheduleOp;
  /** The schedule an update, pause, resume or delete targets. */
  missionId?: string;
  /** The proposed schedule for add and update. */
  draft?: ScheduleDraft;
  /** The target as it was when the agent asked; a mismatch at approval time
   *  means the owner or someone else changed it since. */
  snapshot?: string;
  /** Why the agent asks, in its words, shown on the card (owner, 2026-09-27:
   *  "there is no rational or explanation behind what made agent propose this"). */
  reason?: string;
  /** Michael passed it to the owner (it shows in ASK ME), with his note on
   *  what he can't settle. Otherwise Michael decides it (owner, 2026-09-27). */
  escalated?: boolean;
  escalation?: string;
  /** Michael has been told about it, and when. */
  sentToMichael?: boolean;
  sentToMichaelAt?: number;
  createdAt: number;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const LABEL_MAX = 80;

/** Node timers can't wait longer than 2^31-1 ms (about 24.8 days): a longer
 *  delay is clamped to 1 ms, so the job would fire nonstop (review, 2026-09-25).
 *  Intervals stay at or under 24 days, and armPlan never arms a longer wait. */
export const MAX_INTERVAL_MS = 24 * 86_400_000;
const MAX_TIMER_MS = 2_147_483_647;

/** Day names ("mon", "weekdays", "weekends", "daily") as day numbers, or null. */
function parseDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const days = new Set<number>();
  for (const r of raw) {
    if (typeof r !== 'string') return null;
    const d = r.trim().toLowerCase();
    if (d === 'weekdays') [1, 2, 3, 4, 5].forEach((x) => days.add(x));
    else if (d === 'weekends') [0, 6].forEach((x) => days.add(x));
    else if (d === 'daily' || d === 'every day') [0, 1, 2, 3, 4, 5, 6].forEach((x) => days.add(x));
    else {
      // "mon", "tues", "Friday", "Mondays", "weds", "mon.": a start of a real
      // day name, never just its first three letters, so "monthly" or
      // "sunset" is not read as a day.
      const w = d.replace(/\.$/, '');
      const day = w.length >= 3
        ? DAY_NAMES.findIndex((n) => n.startsWith(w) || w === `${n}s` || (w === 'weds' && n === 'wednesday'))
        : -1;
      if (day < 0) return null;
      days.add(day);
    }
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

/** "09:00" as minutes since midnight; "09:75" is not a time. */
function parseClock(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const t = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(raw);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  return Number(t[1]) * 60 + Number(t[2]);
}

function parseEvery(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const hit = /^\s*(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)\s*$/i.exec(raw);
  if (!hit) return null;
  const unit = hit[2].toLowerCase()[0];
  return Number(hit[1]) * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}

/** One `when` object as a line: `{ every, days?, between? }` or `{ days, at }`. */
function whenLine(when: unknown): ScheduleLine | null {
  if (!when || typeof when !== 'object') return null;
  const w = when as { every?: unknown; days?: unknown; at?: unknown; between?: unknown };
  if (w.every !== undefined) {
    const everyMs = parseEvery(w.every);
    if (everyMs === null) return null;
    const line: Record<string, unknown> = { kind: 'every', everyMs };
    if (w.days !== undefined) { const days = parseDays(w.days); if (!days) return null; line.days = days; }
    if (w.between !== undefined) {
      if (!Array.isArray(w.between) || w.between.length !== 2) return null;
      const from = parseClock(w.between[0]);
      const to = parseClock(w.between[1]);
      if (from === null || to === null) return null;
      line.from = from; line.to = to;
    }
    return normalizeLine(line);
  }
  const days = parseDays(w.days);
  const minute = parseClock(w.at);
  return days && minute !== null ? normalizeLine({ kind: 'at', days, minute }) : null;
}

/**
 * Read an agent's `when`: one object or a list of them.
 *   `{ "every": "2h" }` (m, h or d; 1 minute to 24 days) runs around the clock;
 *   `{ "every": "2h", "days": ["weekdays"], "between": ["08:00", "18:00"] }`
 *     limits it (every is then at most 1d);
 *   `{ "days": ["mon", "fri"] | ["weekdays"], "at": "09:00" }`.
 * A list runs at whichever line comes due first. Null if anything is unusable.
 */
export function parseWhen(when: unknown): { intervalMs: number; weekly?: { days: number[]; minute: number }; times?: ScheduleLine[] } | null {
  // The plain "every" keeps its old, longer range (up to 24 days).
  if (when && typeof when === 'object' && !Array.isArray(when)) {
    const w = when as { every?: unknown; days?: unknown; between?: unknown };
    if (w.every !== undefined && w.days === undefined && w.between === undefined) {
      const ms = parseEvery(w.every);
      return ms !== null && ms >= 60_000 && ms <= MAX_INTERVAL_MS ? { intervalMs: ms } : null;
    }
  }
  const list = Array.isArray(when) ? when : [when];
  const lines: ScheduleLine[] = [];
  for (const w of list) {
    const line = whenLine(w);
    if (!line) return null;
    lines.push(line);
  }
  const times = normalizeTimes(lines);
  if (!times) return null;
  const simple = simpleTimes(times);
  if (simple && 'weekly' in simple) {
    const weekly = normalizeWeekly(simple.weekly);
    return weekly ? { intervalMs: 86_400_000, weekly } : null;
  }
  if (simple) return { intervalMs: simple.intervalMs };
  const firstEvery = times.find((l) => l.kind === 'every');
  return { intervalMs: firstEvery && firstEvery.kind === 'every' ? firstEvery.everyMs : 86_400_000, times };
}

/** What an approval must find unchanged. */
export function missionFingerprint(m: ScheduledMission): string {
  const w = normalizeWeekly(m.weekly);
  const t = normalizeTimes(m.times);
  // The focus joins only when set, so a request filed before focus areas
  // existed is not made stale by the upgrade.
  return JSON.stringify([m.label, m.intervalMs, w ? `${w.days.join(',')}@${w.minute}` : '', m.enabled, ...(t ? [JSON.stringify(t)] : []), ...(m.focus ? [`focus:${m.focus}`] : [])]);
}

/**
 * Turn an agent's `schedule` payload into a pending request, or say why not.
 * `actor` is the owning outbox folder. `reason` goes back to the agent.
 */
export function buildScheduleRequest(
  actor: string, payload: unknown, missions: ScheduledMission[], godId: string, now: number, id: string, why?: string
): { ok: true; request: ScheduleRequest } | { ok: false; reason: string } {
  const built = buildRequestShape(actor, payload, missions, godId, now, id);
  if (!built.ok) return built;
  // The owner decides on the card, so the card says why (owner, 2026-09-27).
  // Checked last, so a request with other problems hears about those first.
  const reason = (why ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!reason) return { ok: false, reason: 'Say why in the message "body", in a sentence or two the owner can read on the card: what you noticed and what the change fixes.' };
  return { ok: true, request: { ...built.request, reason } };
}

function buildRequestShape(
  actor: string, payload: unknown, missions: ScheduledMission[], godId: string, now: number, id: string
): { ok: true; request: ScheduleRequest } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'The "schedule" field must be an object.' };
  const p = payload as { op?: unknown; id?: unknown; label?: unknown; when?: unknown; focus?: unknown };
  const op = p.op;
  if (op !== 'add' && op !== 'update' && op !== 'pause' && op !== 'resume' && op !== 'delete') {
    return { ok: false, reason: 'Unknown op. Use add, update, pause, resume, delete or list.' };
  }
  const label = typeof p.label === 'string' ? p.label.trim() : '';
  if (label.length > LABEL_MAX) return { ok: false, reason: `Keep the label under ${LABEL_MAX} characters.` };
  if (typeof p.focus === 'string' && p.focus.trim().length > FOCUS_MAX) return { ok: false, reason: `Keep the focus under ${FOCUS_MAX} characters.` };
  const focus = cleanFocus(p.focus);

  if (op === 'add') {
    if (!label) return { ok: false, reason: 'An add needs a "label" naming the job.' };
    const when = parseWhen(p.when);
    if (!when) return { ok: false, reason: 'An add needs a usable "when": {"every": "2h"} (1 minute to 24 days), {"every": "2h", "days": ["weekdays"], "between": ["08:00", "18:00"]}, {"days": ["mon"], "at": "09:00"}, or a list of these.' };
    if (!focus) return { ok: false, reason: 'An add needs a "focus": what to concentrate on when this job runs, within your Work style, in a sentence or two.' };
    return { ok: true, request: { id, agentId: actor, op, draft: { label, ...when, focus }, createdAt: now } };
  }

  const missionId = typeof p.id === 'string' ? p.id : '';
  const target = missions.find((m) => m.id === missionId);
  if (!target) return { ok: false, reason: 'No schedule has that "id". Send {"op": "list"} to see your schedules and their ids.' };
  if (!canEdit(actor, target, godId)) return { ok: false, reason: 'That schedule belongs to another team member. You can only ask about your own.' };

  const base: ScheduleRequest = { id, agentId: actor, op, missionId, snapshot: missionFingerprint(target), createdAt: now };
  if (op !== 'update') return { ok: true, request: base };
  const when = p.when === undefined ? null : parseWhen(p.when);
  if (p.when !== undefined && !when) return { ok: false, reason: 'That "when" is not usable.' };
  if (!label && !when && !focus) return { ok: false, reason: 'An update needs a new "label", "when" or "focus".' };
  const draft: ScheduleDraft = {
    label: label || target.label,
    whenGiven: !!when,
    intervalMs: when ? when.intervalMs : target.intervalMs,
    ...(when ? (when.weekly ? { weekly: when.weekly } : {}) : (target.weekly ? { weekly: target.weekly } : {})),
    ...(when ? (when.times ? { times: when.times } : {}) : (target.times ? { times: target.times } : {})),
    ...(focus ?? target.focus ? { focus: focus ?? target.focus } : {})
  };
  return { ok: true, request: { ...base, draft } };
}

/** A draft's timing as "when" lines, or null when it can't be one (a plain
 *  interval longer than a day). */
function draftLines(d: ScheduleDraft): ScheduleLine[] | null {
  const times = normalizeTimes(d.times);
  if (times) return times;
  const w = normalizeWeekly(d.weekly);
  if (w) return [{ kind: 'at', days: w.days, minute: w.minute }];
  return d.intervalMs > 0 && d.intervalMs <= 86_400_000 ? [{ kind: 'every', everyMs: d.intervalMs }] : null;
}

/** The job a request is about: its target schedule, else its draft's name. */
function requestJob(req: ScheduleRequest, missions: ScheduledMission[]): string {
  const target = missions.find((m) => m.id === req.missionId);
  return (target?.label ?? req.draft?.label ?? '').trim().toLowerCase();
}

/**
 * File a new request among the pending ones (owner, 2026-09-27: "showing two
 * cards on the exact same topic may confuse owner"). A request from the same
 * agent about the same job joins the pending one into one card:
 *   - two adds or updates: one change whose "when" lines are both sets of
 *     times together (Nick's "weekdays at 08:00" and "weekdays at 14:00"
 *     become one schedule at 08:00 and 14:00);
 *   - anything else, or times that can't sit together: the newer request
 *     replaces the older, since it is the agent's latest intent.
 * The reasons are kept, both when they differ.
 */
export function fileScheduleRequest(pending: ScheduleRequest[], incoming: ScheduleRequest, missions: ScheduledMission[]): ScheduleRequest[] {
  const job = requestJob(incoming, missions);
  const i = pending.findIndex((p) => p.agentId === incoming.agentId && job && requestJob(p, missions) === job);
  if (i < 0) return [...pending, incoming];
  const prev = pending[i];
  const reasons = [...new Set([prev.reason, incoming.reason].filter((r): r is string => !!r))];
  const reason = reasons.join(' ').slice(0, 600) || undefined;
  // A joined request goes back to Michael to decide as one, even if the older
  // one had gone to the owner (pre-landing review, 2026-09-27).
  const reset = { escalated: undefined, escalation: undefined, sentToMichael: undefined, sentToMichaelAt: undefined };
  let merged: ScheduleRequest = { ...incoming, ...reset, reason };
  const shaping = (r: ScheduleRequest) => (r.op === 'add' || r.op === 'update') && !!r.draft;
  if (shaping(prev) && shaping(incoming)) {
    const base = prev.op === 'update' ? prev : incoming.op === 'update' ? incoming : prev;
    const label = incoming.draft!.label;
    if (incoming.op === 'update' && incoming.draft!.whenGiven === false) {
      // A rename after a timing change: the timing stays, the name is the new one.
      merged = { ...base, ...reset, id: incoming.id, draft: { ...prev.draft!, label, ...(incoming.draft!.focus ? { focus: incoming.draft!.focus } : {}) }, reason, createdAt: incoming.createdAt };
    } else if (prev.op === 'add' || incoming.op === 'add') {
      // Asking for another time for the job: both sets of times together.
      const a = draftLines(prev.draft!);
      const b = draftLines(incoming.draft!);
      const seen = new Set<string>();
      const lines = a && b ? [...a, ...b].filter((l) => { const k = JSON.stringify(l); if (seen.has(k)) return false; seen.add(k); return true; }) : null;
      const times = lines ? normalizeTimes(lines) : null;
      if (times) {
        const simple = simpleTimes(times);
        const focus = incoming.draft!.focus ?? prev.draft!.focus;
        const timing: ScheduleDraft = simple && 'intervalMs' in simple
          ? { label: base.draft!.label, intervalMs: simple.intervalMs }
          : simple && 'weekly' in simple
            ? { label: base.draft!.label, intervalMs: 86_400_000, weekly: simple.weekly }
            : { label: base.draft!.label, intervalMs: base.draft!.intervalMs, times };
        const draft: ScheduleDraft = focus ? { ...timing, focus } : timing;
        merged = { ...base, ...reset, id: incoming.id, draft, reason, createdAt: incoming.createdAt };
      }
    }
    // Two timing updates: the newer is a correction and replaces the older,
    // keeping a focus the older one asked for when the newer names none.
    if (merged.draft && !merged.draft.focus && prev.draft?.focus) merged = { ...merged, draft: { ...merged.draft, focus: prev.draft.focus } };
  }
  return pending.map((p, j) => (j === i ? merged : p));
}

/** Fold a list of pending requests the same way, oldest first (requests filed
 *  before merging existed). */
export function foldScheduleRequests(pending: ScheduleRequest[], missions: ScheduledMission[]): ScheduleRequest[] {
  return pending.reduce<ScheduleRequest[]>((acc, r) => fileScheduleRequest(acc, r, missions), []);
}

/** A schedule's timing in words, for messages: "every 2h", "weekdays at 08:00". */
export function whenWords(m: { intervalMs: number; weekly?: unknown; times?: unknown }): string {
  const times = normalizeTimes(m.times);
  if (times) return formatTimes(times);
  if (normalizeWeekly(m.weekly)) return formatWeekly(m.weekly);
  return `every ${formatEvery(m.intervalMs)}`;
}

/** What a request would do, in a sentence for Michael or the agent. */
export function requestSummary(req: ScheduleRequest, missions: ScheduledMission[]): string {
  const target = missions.find((m) => m.id === req.missionId);
  const label = target?.label ?? req.draft?.label ?? 'a schedule';
  const focusWords = (f?: string) => (f ? `, focus: "${f}"` : '');
  if (req.op === 'add' && req.draft) return `add "${req.draft.label}", ${whenWords(req.draft)}${focusWords(req.draft.focus)}`;
  if (req.op === 'update' && req.draft) {
    const rename = target && req.draft.label !== target.label ? ` and rename it "${req.draft.label}"` : '';
    const refocus = req.draft.focus && req.draft.focus !== target?.focus ? focusWords(req.draft.focus) : '';
    if (refocus && !req.draft.whenGiven && !rename) return `set the focus of "${label}" to "${req.draft.focus}"`;
    return `change "${label}" from ${target ? whenWords(target) : 'its current times'} to ${whenWords(req.draft)}${rename}${refocus}`;
  }
  return `${req.op} "${label}"`;
}

/** Has the target changed (or gone) since the agent asked? Adds never go stale. */
export function requestIsStale(req: ScheduleRequest, missions: ScheduledMission[]): boolean {
  if (req.op === 'add') return false;
  const target = missions.find((m) => m.id === req.missionId);
  return !target || missionFingerprint(target) !== req.snapshot;
}

/** Apply an approved request to the current list. Refuses a stale one. With
 *  `now`, an add, a resume or new times set `scheduledSince` (upsertMission). */
export function applyScheduleRequest(
  req: ScheduleRequest, missions: ScheduledMission[], newId: string, now?: number
): { ok: true; missions: ScheduledMission[]; missionId: string } | { ok: false; error: string } {
  if (requestIsStale(req, missions)) return { ok: false, error: 'stale' };
  if (req.op === 'add' && req.draft) {
    const m: ScheduledMission = {
      id: newId, label: req.draft.label, intervalMs: Math.min(req.draft.intervalMs, MAX_INTERVAL_MS),
      ...(req.draft.weekly ? { weekly: req.draft.weekly } : {}),
      ...(req.draft.times ? { times: req.draft.times } : {}),
      ...(req.draft.focus ? { focus: req.draft.focus } : {}),
      to: req.agentId, body: '', enabled: true, createdBy: req.agentId
    };
    return { ok: true, missions: [...missions, now === undefined ? m : withSince(m, now)], missionId: newId };
  }
  const id = req.missionId ?? '';
  if (req.op === 'delete') return { ok: true, missions: deleteMission(missions, id), missionId: id };
  if (req.op === 'pause' || req.op === 'resume') {
    const next = setMissionEnabled(missions, id, req.op === 'resume', now);
    return next ? { ok: true, missions: next, missionId: id } : { ok: false, error: 'stale' };
  }
  if (req.op === 'update' && req.draft) {
    const target = missions.find((m) => m.id === id);
    if (!target) return { ok: false, error: 'stale' };
    const updated: ScheduledMission = { ...target, label: req.draft.label, intervalMs: req.draft.intervalMs };
    if (req.draft.focus) updated.focus = req.draft.focus;
    if (req.draft.weekly) updated.weekly = req.draft.weekly; else delete updated.weekly;
    if (req.draft.times) updated.times = req.draft.times; else delete updated.times;
    if (now !== undefined && timingKey(updated) !== timingKey(target)) updated.scheduledSince = now;
    return { ok: true, missions: missions.map((m) => (m.id === id ? updated : m)), missionId: id };
  }
  return { ok: false, error: 'invalid' };
}
