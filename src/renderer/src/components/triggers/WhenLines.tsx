import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IntervalPicker, MiniButton, WeeklyPicker, Hint, inputStyle } from './ui';
import { WEEKDAY_INITIALS, WEEKDAY_LABELS, formatMinute, normalizeWeekly } from '@shared/weeklySchedule';
import { capEveryLines, cappedLine, clashingDays, daysTakenFor, normalizeTimes, simpleTimes, MAX_LINES, type ScheduleLine } from '@shared/scheduleTimes';
import type { ScheduledMission } from '@shared/missions';

/**
 * The "when" of a schedule as one or more lines (owner, 2026-09-27: one job
 * "every 2 hours on weekdays and 2 pm on weekends"). Each line is "every N,
 * on these days, optionally only between two times" or "on these days at a
 * time"; the job runs at whichever line comes due first (scheduleTimes.ts).
 */
export type LineDraft =
  | { kind: 'every'; everyMs: number; days: number[]; window: { from: number; to: number } | null }
  | { kind: 'at'; days: number[]; minute: number };

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A schedule's stored timing as lines to edit. */
export function linesFromMission(m: Pick<ScheduledMission, 'intervalMs' | 'weekly' | 'times'>): LineDraft[] {
  const times = normalizeTimes(m.times);
  if (times) {
    return times.map((l) => (l.kind === 'at'
      ? { kind: 'at', days: l.days, minute: l.minute }
      : { kind: 'every', everyMs: l.everyMs, days: l.days ?? ALL_DAYS, window: l.from !== undefined && l.to !== undefined ? { from: l.from, to: l.to } : null }));
  }
  const w = normalizeWeekly(m.weekly);
  if (w) return [{ kind: 'at', days: w.days, minute: w.minute }];
  return [{ kind: 'every', everyMs: m.intervalMs > 0 ? m.intervalMs : HOUR, days: ALL_DAYS, window: null }];
}

/** One plain "every" line keeps the long range (up to 24 days); anything more
 *  specific is at most a day. */
export function isPlainEvery(lines: LineDraft[]): boolean {
  return lines.length === 1 && lines[0].kind === 'every' && lines[0].days.length === 7 && !lines[0].window;
}

function toLine(d: LineDraft): unknown {
  if (d.kind === 'at') return { kind: 'at', days: d.days, minute: d.minute };
  return {
    kind: 'every', everyMs: d.everyMs,
    ...(d.days.length < 7 ? { days: d.days } : {}),
    ...(d.window ? { from: d.window.from, to: d.window.to } : {})
  };
}

/** The stored fields for these lines: `intervalMs` or `weekly` when one line
 *  says it, else `times`. Null when a line is unusable (no days, a window that
 *  ends before it starts). `weekly` and `times` are always present as keys, so
 *  a save clears whichever the schedule no longer uses. */
export function fieldsFromLines(lines: LineDraft[], keepIntervalMs: number):
  { intervalMs: number; weekly: { days: number[]; minute: number } | undefined; times: ScheduleLine[] | undefined } | null {
  if (isPlainEvery(lines) && lines[0].kind === 'every') return { intervalMs: lines[0].everyMs, weekly: undefined, times: undefined };
  const times = normalizeTimes(lines.map(toLine));
  if (!times) return null;
  const simple = simpleTimes(times);
  if (simple && 'weekly' in simple) return { intervalMs: keepIntervalMs, weekly: simple.weekly, times: undefined };
  if (simple) return { intervalMs: simple.intervalMs, weekly: undefined, times: undefined };
  return { intervalMs: keepIntervalMs, weekly: undefined, times };
}

/** Same timing? For a row's dirty check. */
export function sameLines(a: LineDraft[], b: LineDraft[]): boolean {
  return JSON.stringify(a.map(toLine)) === JSON.stringify(b.map(toLine));
}

export function WhenLines({ lines, onChange: emit }: { lines: LineDraft[]; onChange: (lines: LineDraft[]) => void }) {
  const { t } = useTranslation();
  // Leaving the plain shape (a second line, a window, fewer days) shortens a
  // long "every" to a day, the most a line in that shape can run. The line it
  // shortened says so until the next edit.
  const [cappedAt, setCappedAt] = useState(-1);
  const onChange = (next: LineDraft[]) => {
    const kept = isPlainEvery(next) ? next : capEveryLines(next);
    setCappedAt(cappedLine(next, kept));
    emit(kept);
  };
  const set = (i: number, next: LineDraft) => onChange(lines.map((l, j) => (j === i ? next : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  const plain = isPlainEvery(lines);
  // A day an "every" line runs on belongs to it alone (owner, 2026-09-27), so
  // each line's picker greys out the days another line holds.
  const taken = (i: number) => daysTakenFor(lines, i);
  const clash = clashingDays(lines);
  /** Days no "every" line holds, for a new line to start on. */
  const freeDays = (days: number[]) => {
    const everyDays = new Set(lines.filter((l) => l.kind === 'every').flatMap((l) => l.days));
    return days.filter((d) => !everyDays.has(d));
  };
  const tab = (active: boolean): CSSProperties => ({
    padding: '3px 10px 2px', border: 'none', cursor: 'pointer',
    background: active ? 'var(--cth-cream-100)' : 'transparent',
    boxShadow: active ? 'inset 0 0 0 1.5px var(--cth-indigo)' : 'inset 0 0 0 1px var(--cth-ink-100)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 11,
    color: active ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)'
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((line, i) => (
        <div
          key={i}
          role="group"
          aria-label={t('triggersUi.timeN', { n: i + 1 })}
          style={lines.length > 1 ? { padding: 6, boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', display: 'flex', flexDirection: 'column', gap: 6 } : { display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button type="button" style={tab(line.kind === 'every')} onClick={() => {
              if (line.kind === 'every') return;
              // An "every" line can't take a day another line runs on.
              const others = new Set(lines.filter((_, j) => j !== i).flatMap((l) => l.days));
              set(i, { kind: 'every', everyMs: 2 * HOUR, days: line.days.filter((d) => !others.has(d)), window: null });
            }}>{t('triggersUi.every')}</button>
            <button type="button" style={tab(line.kind === 'at')} onClick={() => {
              if (line.kind === 'at') return;
              const blocked = new Set(taken(i));
              const days = (line.days.length === 7 ? [1, 2, 3, 4, 5] : line.days).filter((d) => !blocked.has(d));
              set(i, { kind: 'at', days, minute: 9 * 60 });
            }}>{t('triggersUi.onDays')}</button>
            <span style={{ flex: 1 }} />
            {lines.length > 1 && <MiniButton onClick={() => remove(i)}>{t('triggersUi.removeTime')}</MiniButton>}
          </div>
          {line.kind === 'at'
            ? <WeeklyPicker value={{ days: line.days, minute: line.minute }} taken={taken(i)} onChange={(w) => set(i, { kind: 'at', days: w.days, minute: w.minute })} />
            : <EveryLine line={line} longRange={plain} taken={taken(i)} onChange={(next) => set(i, next)} />}
          {cappedAt === i && <Hint>{t('triggersUi.everyCapped')}</Hint>}
        </div>
      ))}
      {lines.length < MAX_LINES && (
        <div>
          {/* A new line starts on the weekend, or whichever days no "every"
              line holds yet. */}
          <MiniButton onClick={() => {
            const weekend = freeDays([0, 6]);
            if (weekend.length || freeDays(ALL_DAYS).length) {
              onChange([...lines, { kind: 'at', days: weekend.length ? weekend : freeDays(ALL_DAYS), minute: 14 * 60 }]);
              return;
            }
            // Every day is held by one "every" line (the usual start): the new
            // line takes the weekend from it, so both can be seen and changed.
            const holder = lines.findIndex((l) => l.kind === 'every' && l.days.length === 7);
            if (holder < 0) { onChange([...lines, { kind: 'at', days: [], minute: 14 * 60 }]); return; }
            const moved = lines.map((l, j) => (j === holder ? { ...l, days: [1, 2, 3, 4, 5] } : l));
            onChange([...moved, { kind: 'at', days: [0, 6], minute: 14 * 60 }]);
          }}>{t('triggersUi.addTime')}</MiniButton>
        </div>
      )}
      {clash.length > 0 && (
        <Hint>{t('triggersUi.daysClash', { days: clash.map((d) => WEEKDAY_LABELS[d]).join(', ') })}</Hint>
      )}
    </div>
  );
}

function EveryLine({ line, longRange, taken, onChange }: {
  line: Extract<LineDraft, { kind: 'every' }>; longRange: boolean; taken: number[]; onChange: (l: LineDraft) => void;
}) {
  const { t } = useTranslation();
  const toggleDay = (d: number) => {
    if (taken.includes(d) && !line.days.includes(d)) return;
    onChange({ ...line, days: line.days.includes(d) ? line.days.filter((x) => x !== d) : [...line.days, d].sort((a, b) => a - b) });
  };
  const time = (value: number, apply: (m: number) => void) => (
    <input
      type="time"
      value={formatMinute(value)}
      onChange={(e) => {
        const [h, m] = e.target.value.split(':').map(Number);
        if (Number.isFinite(h) && Number.isFinite(m)) apply(h * 60 + m);
      }}
      style={{ ...inputStyle, width: 108, padding: '3px 6px' }}
    />
  );
  const badWindow = !!line.window && line.window.from > line.window.to;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <IntervalPicker
        value={line.everyMs}
        maxMs={longRange ? undefined : DAY}
        onChange={(ms) => onChange({ ...line, everyMs: longRange ? ms : Math.min(ms, DAY) })}
      />
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {WEEKDAY_INITIALS.map((initial, d) => {
          const on = line.days.includes(d);
          const blocked = !on && taken.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              disabled={blocked}
              title={blocked ? t('triggersUi.dayTaken', { day: WEEKDAY_LABELS[d] }) : WEEKDAY_LABELS[d]}
              aria-pressed={on}
              style={{
                borderRadius: 'var(--cth-r-md)',
                width: 26, height: 24, border: 'none', cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.4 : 1,
                background: on ? 'var(--cth-mint)' : 'var(--cth-cream-200)',
                boxShadow: on ? 'inset 0 0 0 1.5px var(--cth-indigo)' : 'inset 0 0 0 1px var(--cth-ink-100)',
                fontFamily: 'var(--cth-font-ui)', fontSize: 11,
                color: on ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)'
              }}
            >{initial}</button>
          );
        })}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--cth-ink-700)' }}>
        <input
          type="checkbox"
          checked={!!line.window}
          onChange={(e) => onChange({ ...line, window: e.target.checked ? { from: 8 * 60, to: 18 * 60 } : null })}
        />
        {t('triggersUi.onlyBetween')}
        {line.window && <>
          {time(line.window.from, (m) => onChange({ ...line, window: { from: m, to: line.window!.to } }))}
          <span>{t('triggersUi.and')}</span>
          {time(line.window.to, (m) => onChange({ ...line, window: { from: line.window!.from, to: m } }))}
        </>}
      </label>
      {line.days.length === 0 && <Hint>{t('triggersUi.pickDayHint')}</Hint>}
      {badWindow && <Hint>{t('triggersUi.windowHint')}</Hint>}
    </div>
  );
}
