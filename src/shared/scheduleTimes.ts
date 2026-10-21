/**
 * SEVERAL "WHEN" LINES FOR ONE JOB (owner, 2026-09-27: "a way to manually
 * create a schedule ... with just one job which will run every 2 hours on
 * weekdays and 2 pm on weekends").
 *
 * A schedule used to have exactly one timing rule: every N (all day, every
 * day) or some days at one time. `times` holds any number of lines, and the job
 * runs at whichever line comes due first:
 *
 *   { kind: 'every', everyMs: 2h, days: [1..5], from: 08:00, to: 18:00 }
 *     → 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 on weekdays
 *   { kind: 'at', days: [0, 6], minute: 14:00 }
 *     → 14:00 on Saturday and Sunday
 *
 * An "every" line here is counted on the clock from its start time (from, or
 * midnight), not from the last run, so its slots are the same every day and a
 * restart can't shift them. A missed slot is caught up once, within
 * WEEKLY_CATCHUP_MS, never as a backlog: the same rule weekly schedules follow.
 *
 * Everything is LOCAL time, built from calendar fields (see weeklySchedule.ts
 * for why). Pure and import-light, so tests load it directly.
 */
import { WEEKDAY_LABELS, WEEKLY_CATCHUP_MS, formatMinute, normalizeWeekly } from './weeklySchedule';

export type ScheduleLine =
  | {
      kind: 'every';
      /** 1 minute to 24 hours. */
      everyMs: number;
      /** Days it runs, 0 = Sunday. Absent means every day. */
      days?: number[];
      /** Minutes since midnight the slots start and end, both inclusive.
       *  Absent means the whole day. */
      from?: number;
      to?: number;
    }
  | { kind: 'at'; days: number[]; minute: number };

export const MAX_LINES = 8;
const MINUTE = 60_000;
const DAY = 86_400_000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function normDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const days = [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return days.length ? days : null;
}
const isMinute = (m: unknown): m is number => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 1439;

/** One line made canonical, or null when it isn't usable. */
export function normalizeLine(raw: unknown): ScheduleLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'at') {
    const w = normalizeWeekly({ days: o.days, minute: o.minute });
    return w ? { kind: 'at', days: w.days, minute: w.minute } : null;
  }
  if (o.kind !== 'every') return null;
  const everyMs = o.everyMs;
  if (typeof everyMs !== 'number' || !Number.isFinite(everyMs) || everyMs < MINUTE || everyMs > DAY || everyMs % MINUTE !== 0) return null;
  const line: ScheduleLine = { kind: 'every', everyMs };
  if (o.days !== undefined) {
    const days = normDays(o.days);
    if (!days) return null;
    if (days.length < 7) line.days = days;
  }
  if (o.from !== undefined || o.to !== undefined) {
    if (!isMinute(o.from) || !isMinute(o.to) || o.from > o.to) return null;
    if (!(o.from === 0 && o.to === 1439)) { line.from = o.from; line.to = o.to; }
  }
  return line;
}

/** The days a line runs on. */
export function lineDays(line: { kind: 'every' | 'at'; days?: number[] }): number[] {
  return line.days && line.days.length ? line.days : line.kind === 'every' ? [0, 1, 2, 3, 4, 5, 6] : [];
}

/**
 * Days claimed twice (owner, 2026-09-27: a weekend day ticked on "every 2h"
 * while another line runs weekends at 2 PM "should not be allowed"). A day an
 * "every" line runs on belongs to that line alone, because it already sets the
 * rhythm for the day; several "on days" lines may share a day (08:00 and 14:00
 * on weekdays). Returns the clashing days, sorted.
 */
export function clashingDays(lines: Array<{ kind: 'every' | 'at'; days?: number[] }>): number[] {
  const clash = new Set<number>();
  lines.forEach((a, i) => {
    if (a.kind !== 'every') return;
    const mine = lineDays(a);
    lines.forEach((b, j) => {
      if (i === j) return;
      for (const d of lineDays(b)) if (mine.includes(d)) clash.add(d);
    });
  });
  return [...clash].sort((x, y) => x - y);
}

/** The days line `i` can't take because another line holds them. */
export function daysTakenFor(lines: Array<{ kind: 'every' | 'at'; days?: number[] }>, i: number): number[] {
  const me = lines[i];
  const taken = new Set<number>();
  lines.forEach((other, j) => {
    if (j === i) return;
    if (me.kind === 'every' || other.kind === 'every') for (const d of lineDays(other)) taken.add(d);
  });
  return [...taken].sort((x, y) => x - y);
}

/** Every "every" line no longer than a day. A lone plain "every" line may run
 *  days apart (it is stored as `intervalMs`), but once it shares the schedule,
 *  gets a window or loses a day, normalizeLine takes at most a day. Without
 *  this, adding a line to "every 3d" left a schedule that could not be saved
 *  and showed no reason why. */
export function capEveryLines<L extends { kind: 'every' | 'at'; everyMs?: number }>(lines: L[]): L[] {
  return lines.map((l) => (l.kind === 'every' && (l.everyMs ?? 0) > DAY ? { ...l, everyMs: DAY } : l));
}

/** The line capEveryLines shortened, or -1, so the owner can be told under it. */
export function cappedLine(before: { kind: 'every' | 'at'; everyMs?: number }[], after: { kind: 'every' | 'at'; everyMs?: number }[]): number {
  return before.findIndex((l, i) => l.everyMs !== after[i]?.everyMs);
}

/** Every line made canonical, or null when there are none, any is unusable
 *  (a schedule with one bad line would run on a clock nobody set), or two
 *  lines claim a day an "every" line runs on. */
export function normalizeTimes(raw: unknown): ScheduleLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const out: ScheduleLine[] = [];
  for (const r of raw) {
    const line = normalizeLine(r);
    if (!line) return null;
    out.push(line);
  }
  return clashingDays(out).length ? null : out;
}

/** True when `times` says no more than the old single-rule fields can: one
 *  plain "every" line (all days, all day) or one "at" line. Those are stored
 *  as `intervalMs` or `weekly`, so older builds and older rows read the same. */
export function simpleTimes(times: ScheduleLine[]): { intervalMs: number } | { weekly: { days: number[]; minute: number } } | null {
  if (times.length !== 1) return null;
  const [l] = times;
  if (l.kind === 'at') return { weekly: { days: l.days, minute: l.minute } };
  return !l.days && l.from === undefined ? { intervalMs: l.everyMs } : null;
}

/** Local instant for `minute` on the day `offset` days from `base`. */
function slotAt(base: Date, offset: number, minute: number): number {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, Math.floor(minute / 60), minute % 60, 0, 0).getTime();
}

/** The minutes of the day a line runs, when it runs that weekday at all. */
function minutesOn(line: ScheduleLine, weekday: number): number[] {
  if (line.kind === 'at') return line.days.includes(weekday) ? [line.minute] : [];
  if (line.days && !line.days.includes(weekday)) return [];
  const step = line.everyMs / MINUTE;
  const from = line.from ?? 0;
  const to = line.to ?? 1439;
  const out: number[] = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

/** Every slot on the day `offset` days from `now`, sorted. */
function slotsOnDay(times: ScheduleLine[], now: number, offset: number): number[] {
  const base = new Date(now);
  const weekday = new Date(slotAt(base, offset, 0)).getDay();
  const set = new Set<number>();
  for (const line of times) for (const m of minutesOn(line, weekday)) set.add(slotAt(base, offset, m));
  return [...set].sort((a, b) => a - b);
}

/** The first slot strictly after `now`, or null. Eight days is always enough. */
export function nextTimesFireMs(times: ScheduleLine[], now: number): number | null {
  for (let offset = 0; offset <= 8; offset++) {
    const hit = slotsOnDay(times, now, offset).find((t) => t > now);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The latest slot at or before `now`, or null. */
export function previousTimesFireMs(times: ScheduleLine[], now: number): number | null {
  for (let offset = 0; offset >= -8; offset--) {
    const slots = slotsOnDay(times, now, offset).filter((t) => t <= now);
    if (slots.length) return slots[slots.length - 1];
  }
  return null;
}

/** How long to wait before the next run: 0 for a slot missed within the catch
 *  up window and not run since, else the time to the next slot. Null when the
 *  lines never run. Same rule as weeklyDelayMs, so no backlog after a close. */
export function timesDelayMs(times: ScheduleLine[], now: number, lastFiredAt = 0): number | null {
  const prev = previousTimesFireMs(times, now);
  if (prev !== null && prev > lastFiredAt && now - prev <= WEEKLY_CATCHUP_MS) return 0;
  const next = nextTimesFireMs(times, now);
  return next === null ? null : Math.max(0, next - now);
}

/** "2h", "30m", "1d". */
export function formatEvery(ms: number): string {
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  return `${Math.round(ms / MINUTE)}m`;
}

/** The words a "when" line is built from. English by default, which is what
 *  Michael and the agents read; the schedule list passes the owner's language. */
export interface WhenWords {
  /** A day's short name, 0 = Sunday. */
  day: (d: number) => string;
  everyDay: string;
  weekdays: string;
  weekends: string;
  /** "Mon, Wed". */
  list: (items: string[]) => string;
  /** "08:00 and 14:00". */
  and: (items: string[]) => string;
  at: (days: string, time: string) => string;
  every: (interval: string) => string;
  span: (from: string, to: string) => string;
}

export const ENGLISH_WHEN: WhenWords = {
  day: (d) => WEEKDAY_LABELS[d],
  everyDay: 'every day',
  weekdays: 'weekdays',
  weekends: 'weekends',
  list: (items) => items.join(', '),
  and: (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]),
  at: (days, time) => `${days} at ${time}`,
  every: (interval) => `every ${interval}`,
  span: (from, to) => `${from} to ${to}`
};

function formatDays(days: number[], w: WhenWords): string {
  const key = days.join(',');
  if (key === ALL_DAYS.join(',')) return w.everyDay;
  if (key === '1,2,3,4,5') return w.weekdays;
  if (key === '0,6') return w.weekends;
  return w.list(days.map(w.day));
}

/** One line in words: "every 2h weekdays 08:00 to 18:00", "weekends at 14:00". */
export function formatLine(line: ScheduleLine, w: WhenWords = ENGLISH_WHEN): string {
  if (line.kind === 'at') return w.at(formatDays(line.days, w), formatMinute(line.minute));
  const parts = [w.every(formatEvery(line.everyMs))];
  if (line.days) parts.push(formatDays(line.days, w));
  if (line.from !== undefined && line.to !== undefined) parts.push(w.span(formatMinute(line.from), formatMinute(line.to)));
  return parts.join(' ');
}

/** All lines in words, joined: "every 2h weekdays 08:00 to 18:00, weekends at
 *  14:00". Times on the same days read as one: "weekdays at 08:00 and 14:00". */
export function formatTimes(times: ScheduleLine[], w: WhenWords = ENGLISH_WHEN): string {
  const parts: string[] = [];
  const atGroups = new Map<string, { days: number[]; minutes: number[]; index: number }>();
  for (const line of times) {
    if (line.kind === 'every') { parts.push(formatLine(line, w)); continue; }
    const key = line.days.join(',');
    const g = atGroups.get(key);
    if (g) { g.minutes.push(line.minute); continue; }
    atGroups.set(key, { days: line.days, minutes: [line.minute], index: parts.length });
    parts.push('');
  }
  for (const g of atGroups.values()) {
    const mins = [...new Set(g.minutes)].sort((a, b) => a - b).map(formatMinute);
    parts[g.index] = w.at(formatDays(g.days, w), w.and(mins));
  }
  return w.list(parts);
}
