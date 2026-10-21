import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PixelButton } from '../PixelButton';
import { useStore } from '@/store/store';
import { useHarnessConfig } from '@/hooks/useHarnessConfig';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { isComposingKey } from '@shared/imeGuard';
import {
  Disclosure, Field, Hint, MiniButton, SchedulePicker, Toggle, fmtInterval, inputStyle, textareaStyle,
  weeklyDraft, weeklyIsUsable, type WeeklyDraft
} from './ui';
import { formatTimes, normalizeTimes, type WhenWords } from '@shared/scheduleTimes';
import { WhenLines, fieldsFromLines, linesFromMission, sameLines, type LineDraft } from './WhenLines';
import { cannotCheckEmail, cleanFocus, FOCUS_MAX, GOD_ALIAS, missionsFor, nextRunAt, ownerOf, OWNER, runNowOutcome, type ScheduledMission } from '@shared/missions';
import { effectiveWorkStyle } from '@shared/michaelWorkStyle';
import { remainingStarterMissions, starterSuggestionsFor, type StarterSuggestion } from '@shared/starterJobs';
import type { OfficePack } from '@shared/officePack';
import { gmailConnectorOn } from '@shared/claudeConnectors';
import { useRtl } from '@/i18n/useDirection';
import i18n from '@/i18n';

/**
 * SCHEDULES, per agent (docs/designs/per-agent-schedules.md).
 *
 * A schedule belongs to the agent that runs it, so there is no "goes to"
 * picker: a schedule added on Pam's tab is Pam's. Two modes share one row:
 *
 * - `agent`: that agent's own schedules, editable. Lives in the On a schedule
 *   section of every agent's Capabilities tab, Michael's included.
 * - `office`: everyone's schedules that are on, read only plain rows grouped
 *   by agent, on Michael's Office schedule tab. Edits happen on each agent's
 *   Capabilities tab (owner, 2026-09-26).
 *
 * Each change is one operation on one schedule (upsert, delete, setEnabled), and
 * the row waits for main's answer: on a failure it goes back to what is saved
 * and says so, because a toggle that looks off while the job still runs is the
 * worst kind of wrong (design 7A).
 *
 * An agent never changes a schedule itself. It asks, and the owner decides in
 * ASK ME (owner, 2026-09-25); an approved change shows here as "added by Pam".
 */

/* ─────────────────────────── the shared list ─────────────────────────── */

let subscribed = false;
function refreshMissions(): void {
  window.cth.listMissions()
    .then((list) => useStore.getState().setMissions(list, 'ready'))
    .catch(() => useStore.getState().setMissions(useStore.getState().missions, 'error'));
}

/** Every schedule in the office, kept current from main. One subscription for
 *  the whole app, started by the first view that needs it. */
export function useMissions(): { missions: ScheduledMission[]; status: 'loading' | 'ready' | 'error'; retry: () => void } {
  const missions = useStore((s) => s.missions);
  const status = useStore((s) => s.missionsStatus);
  useEffect(() => {
    if (subscribed) return;
    subscribed = true;
    refreshMissions();
    // Refresh when the scheduler stamps a run or any view changes a schedule.
    window.cth.onMissionsUpdated(refreshMissions);
  }, []);
  return { missions, status, retry: () => { useStore.setState({ missionsStatus: 'loading' }); refreshMissions(); } };
}

/** The god agent's id on the floor, for ownership (schedules say 'god'). */
export function useGodId(): string {
  return useStore((s) => s.agents.find((a) => a.isGod)?.id) ?? GOD_ALIAS;
}

/** One save at a time: `busy` while it runs, `failed` if it didn't land (7A).
 *  `after` runs only on success. Shared by a row, the add form and ASK ME. */
export function useSaveOp(): {
  busy: boolean; failed: boolean; setFailed: (v: boolean) => void;
  run: (op: () => Promise<{ ok: boolean }>, after?: () => void) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (op: () => Promise<{ ok: boolean }>, after?: () => void) => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await op();
      if (!res.ok) { setFailed(true); return; }
      after?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, setFailed, run };
}

/** Who a focus area is checked for (FA3): the agent's name, its Work style and
 *  its other jobs' focus areas. */
interface FocusOwner {
  /** The agent, so the check reads its Sending setting (send-on-approval.md). */
  agentId?: string;
  name: string;
  workStyle: string;
  /** Every job the agent has, to check against all but the one being saved. */
  jobs: ScheduledMission[];
}

/**
 * The focus area check on save (docs/designs/schedule-focus-areas.md, FA3). A
 * conflict is named and the owner fixes the text or saves anyway; a check that
 * can't run lets the save go ahead.
 */
function useFocusCheck(owner: FocusOwner): {
  checking: boolean; conflict: string | null; clear: () => void;
  /** True when the save may go ahead now. */
  check: (job: string, focus: string, missionId?: string) => Promise<boolean>;
} {
  const [checking, setChecking] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const check = async (job: string, focus: string, missionId?: string) => {
    if (conflict !== null) { setConflict(null); return true; } // "Save anyway"
    setChecking(true);
    try {
      const others = owner.jobs.filter((m) => m.id !== missionId && m.focus).map((m) => ({ job: m.label, focus: m.focus! }));
      const res = await window.cth.workStyleCheckFocus({ agentId: owner.agentId, name: owner.name, job, focus, workStyle: owner.workStyle, others });
      if (res.conflict) { setConflict(res.conflict); return false; }
      return true;
    } catch {
      return true;
    } finally {
      setChecking(false);
    }
  };
  return { checking, conflict, clear: () => setConflict(null), check };
}

/** The focus area field: required on new jobs (FA1), with the conflict, if
 *  any, named under it (FA3). */
function FocusField({ value, onChange, conflict, hint, autoFocus }: {
  value: string; onChange: (v: string) => void; conflict: string | null; hint?: string; autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const rtl = useRtl();
  return (
    <Field label={t('schedulesSection.focus')}>
      <textarea
        dir={rtl ? 'auto' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={FOCUS_MAX}
        autoFocus={autoFocus}
        placeholder={t('schedulesSection.focusPlaceholder')}
        aria-invalid={conflict ? true : undefined}
        style={textareaStyle}
      />
      {hint && <Hint>{hint}</Hint>}
      {conflict && <Line tone="error">{t('schedulesSection.focusConflict', { conflict })}</Line>}
    </Field>
  );
}

/** The loading line, or the load error with Try again, while nothing has loaded. */
function loadState(status: string, empty: boolean, errorText: string, retry: () => void, t: TFunction): ReactNode | null {
  if (!empty) return null;
  if (status === 'loading') return <Line>{t('schedulesSection.loading')}</Line>;
  if (status === 'error') {
    return (
      <div>
        <Line tone="error">{errorText}</Line>
        <PixelButton variant="secondary" size="sm" onClick={retry}>{t('schedulesSection.tryAgain')}</PixelButton>
      </div>
    );
  }
  return null;
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

const DEFAULT_INTERVAL_MS = 3_600_000;

/** Relative-time label ("now", "in 40 min", "2 hr. ago"), in the app language:
 *  `ms` is how long ago (positive) or how far ahead (negative). */
function relTime(ms: number, lang: string): string {
  const a = Math.abs(ms);
  const mins = Math.round(a / 60_000);
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    a < 45_000 ? [0, 'second'] : mins < 60 ? [mins, 'minute'] : mins < 1440 ? [Math.round(mins / 60), 'hour'] : [Math.round(mins / 1440), 'day'];
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(ms >= 0 ? -n : n, unit);
  } catch {
    return new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }).format(ms >= 0 ? -n : n, unit);
  }
}

/** formatTimes' words in the owner's language. Day names come from Intl, so
 *  every language gets them without a key per day. Sep 27 2026 is a Sunday. */
function whenWords(t: TFunction, lang: string): WhenWords {
  let weekday: Intl.DateTimeFormat;
  try { weekday = new Intl.DateTimeFormat(lang, { weekday: 'short' }); } catch { weekday = new Intl.DateTimeFormat('en', { weekday: 'short' }); }
  const sep = t('schedulesSection.whenSep');
  return {
    day: (d) => weekday.format(new Date(2026, 8, 27 + d)),
    everyDay: t('triggersUi.everyDay'),
    weekdays: t('triggersUi.weekdays'),
    weekends: t('schedulesSection.whenWeekends'),
    list: (items) => items.join(sep),
    and: (items) => (items.length > 1
      ? t('schedulesSection.whenAnd', { list: items.slice(0, -1).join(sep), last: items[items.length - 1] })
      : items[0]),
    at: (days, time) => t('schedulesSection.whenAt', { days, time }),
    every: (interval) => t('schedulesSection.everyInterval', { interval }),
    span: (from, to) => t('schedulesSection.whenSpan', { from, to })
  };
}

/** When a job runs, in words: the calendar, the interval ("every 4h", like an
 *  every line in formatTimes), or the heartbeat. */
export function whenText(m: Pick<ScheduledMission, 'kind' | 'weekly' | 'intervalMs' | 'times'>, t: TFunction): string {
  if (m.kind === 'heartbeat') return t('schedulesSection.beat');
  const words = whenWords(t, i18n.language);
  const times = normalizeTimes(m.times);
  if (times) return formatTimes(times, words);
  const w = weeklyDraft(m.weekly);
  if (w) return formatTimes([{ kind: 'at', days: w.days, minute: w.minute }], words);
  const every = fmtInterval(m.intervalMs);
  return /^\d/.test(every) ? t('schedulesSection.everyInterval', { interval: every }) : every;
}

function Line({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{
      fontSize: 14, lineHeight: '20px', padding: '8px 0',
      color: tone === 'error' ? 'var(--cth-coral)' : 'var(--cth-ink-700)'
    }}>{tone === 'error' ? `! ${children}` : children}</div>
  );
}

/* ──────────────────────────────── one row ──────────────────────────────── */

type RunNowState = 'idle' | 'sending' | ReturnType<typeof runNowOutcome>;

interface RowProps {
  mission: ScheduledMission;
  /** Who a `createdBy` agent id is, for "added by Pam". */
  nameOf: (id: string) => string;
  /** Read only: plain text, no toggle, no editor and no link (the office
   *  schedule; owner, 2026-09-26). */
  readOnly?: boolean;
  ownerName: string;
  /** The agent's email is off, so a job that checks mail is refused each run. */
  noEmail?: boolean;
  /** For the focus area check on save; absent on read only rows. */
  focusOwner?: FocusOwner;
}

function ScheduleRow({ mission, nameOf, readOnly, ownerName, noEmail, focusOwner }: RowProps) {
  const { t, i18n } = useTranslation();
  const rtl = useRtl();
  const godName = useResolvedGodName();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(mission.label);
  const [intervalMs, setIntervalMs] = useState(mission.intervalMs);
  const [weekly, setWeekly] = useState<WeeklyDraft | null>(weeklyDraft(mission.weekly));
  const [lines, setLines] = useState<LineDraft[]>(() => linesFromMission(mission));
  const [body, setBody] = useState(mission.body);
  // An older job's prompt is offered as the starting text of its focus area (FA4).
  // Offering it is not a change: only a focus the owner edits is saved.
  const startFocus = () => mission.focus ?? (mission.kind === 'heartbeat' ? '' : mission.body.trim());
  const [focus, setFocus] = useState(startFocus);
  const [focusTouched, setFocusTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, failed, setFailed, run } = useSaveOp();
  const focusCheck = useFocusCheck(focusOwner ?? { name: ownerName, workStyle: '', jobs: [] });
  const [confirming, setConfirming] = useState(false);
  // Run now (docs/designs/schedule-run-now.md): its own state, so a failed run
  // never reads as a failed save.
  const [runState, setRunState] = useState<RunNowState>('idle');
  const deleteRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);

  // "Sent" and "ran a moment ago" are a moment's answer; the row's "fired"
  // line keeps the record. Left up, "less than a minute ago" goes stale.
  useEffect(() => {
    if (runState !== 'sent' && runState !== 'justRan') return;
    const timer = setTimeout(() => setRunState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [runState]);

  // Seed the draft when the row opens, never on every render, or the scheduler
  // stamping lastFiredAt mid-edit would wipe what you are typing.
  useEffect(() => {
    setRunState('idle');
    if (!open) return;
    setLabel(mission.label);
    setIntervalMs(mission.intervalMs);
    setWeekly(weeklyDraft(mission.weekly));
    setLines(linesFromMission(mission));
    setBody(mission.body);
    setFocus(startFocus());
    setFocusTouched(false);
    focusCheck.clear();
    setSaved(false);
    setConfirming(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const heartbeat = mission.kind === 'heartbeat';
  const legacy = heartbeat ? '' : mission.body.trim();
  const focusChanged = !heartbeat && (focusTouched || !!mission.focus) && (cleanFocus(focus) ?? '') !== (mission.focus ?? '');
  const storedWeekly = weeklyDraft(mission.weekly);
  const weeklyKey = (w: WeeklyDraft | null) => (w ? `${[...w.days].sort((a, b) => a - b).join(',')}@${w.minute}` : '');
  // A heartbeat keeps its single interval; every other schedule is edited as
  // "when" lines (WhenLines.tsx).
  const dirty = label !== mission.label || (heartbeat
    ? intervalMs !== mission.intervalMs || body !== mission.body || weeklyKey(weekly) !== weeklyKey(storedWeekly)
    : !sameLines(lines, linesFromMission(mission)) || focusChanged);
  const whenFields = heartbeat ? null : fieldsFromLines(lines, mission.intervalMs);
  const whenIsUsable = heartbeat ? (!weekly || weeklyIsUsable(weekly)) : whenFields !== null;

  const now = Date.now();
  const nextAt = nextRunAt(mission, now);
  // Nearly every job is the owner's own, so "added by you" said nothing on
  // every row (owner, 2026-10-01). Only a job a team member asked for names
  // them, and Michael when he approved it (owner, 2026-09-27).
  const creator = !mission.createdBy || mission.createdBy === OWNER ? ''
    : t('schedulesSection.addedBy', { name: nameOf(mission.createdBy) })
      + (mission.approvedBy === 'michael' && nameOf(mission.createdBy) !== godName
        ? `, ${t('schedulesSection.approvedBy', { name: godName })}` : '');
  // Beside the name: when it runs next, or that it is paused.
  const next = !mission.enabled ? t('schedulesSection.paused')
    : nextAt !== null ? t('schedulesSection.next', { time: relTime(now - nextAt, i18n.language) }) : '';
  const sub = [
    mission.enabled ? (mission.lastFiredAt ? t('schedulesSection.fired', { time: relTime(now - mission.lastFiredAt, i18n.language) }) : t('schedulesSection.notFired')) : null,
    creator
  ].filter(Boolean).join(', ');

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setLabel(trimmed);
    const nextFocus = heartbeat ? undefined : (focusChanged ? cleanFocus(focus) : mission.focus);
    if (nextFocus && focusChanged && !(await focusCheck.check(trimmed, nextFocus, mission.id))) return;
    // `weekly: undefined` is the switch back to interval mode; `times:
    // undefined` drops extra lines the schedule no longer has. A focus area
    // the owner saved replaces an older job's prompt (FA4), but only when the
    // focus holds all of it: a longer prompt, or one with line breaks, stays.
    const legacyBody = mission.body.trim();
    const keepBody = !nextFocus || /\n/.test(legacyBody) || cleanFocus(legacyBody) !== (legacyBody || undefined);
    void run(() => window.cth.upsertMission(heartbeat
      ? { ...mission, label: trimmed, intervalMs, body, weekly: weekly ?? undefined }
      : { ...mission, label: trimmed, ...(whenFields ?? {}), focus: nextFocus, body: keepBody ? mission.body : '' }
    ), () => { setSaved(true); setTimeout(() => setSaved(false), 1300); });
  };
  const toggle = () => { void run(() => window.cth.setMissionEnabled(mission.id, !mission.enabled)); };
  const remove = () => { void run(() => window.cth.deleteMission(mission.id)); };
  // A job only, never the heartbeat. Main answers with the saved job, so a row
  // with unsaved edits asks for a save first instead of running the old text.
  const canRunNow = !heartbeat && (mission.kind ?? 'dispatch') === 'dispatch';
  const runNow = async () => {
    setRunState('sending');
    try {
      setRunState(runNowOutcome(await window.cth.runMissionNow(mission.id)));
    } catch {
      setRunState('failed');
    }
  };
  const cancelDelete = () => { setConfirming(false); setTimeout(() => deleteRef.current?.focus(), 0); };

  const headerStyle = {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, textAlign: rtl ? 'right' : 'left',
    // Read only rows line up with the name above them; editable rows keep
    // room for the disclosure sign.
    padding: readOnly ? '8px 0' : '8px 4px', border: 'none', background: 'transparent'
  } as const;
  const headerBody = (
    <>
      {!readOnly && <Disclosure open={open} />}
      {/* Three quiet lines (owner, 2026-10-01): the name with its next run,
          when it runs, then who added it and when it last fired. A bold when
          chip beside or under the name crowded it and broke the status
          mid phrase. */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            flex: 1, minWidth: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 14, lineHeight: '20px', fontWeight: 500,
            color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{mission.label}</span>
          {next && <span style={{ flexShrink: 0, fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-700)' }}>{next}</span>}
        </span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>{whenText(mission, t)}</span>
        {sub && <span style={{ display: 'block', fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-500)' }}>{sub}</span>}
        {noEmail && <span data-no-email style={{ display: 'block', fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-amber-text)' }}>{t('schedulesSection.cannotCheckEmail', { name: ownerName })}</span>}
        {/* An older job without a focus area keeps running as before (FA4). */}
        {!readOnly && !heartbeat && (mission.kind ?? 'dispatch') === 'dispatch' && !mission.focus && (
          <span data-add-focus style={{ display: 'block', fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-amber-text)' }}>{t('schedulesSection.addFocus')}</span>
        )}
      </span>
    </>
  );
  const header = readOnly
    ? <div style={headerStyle}>{headerBody}</div>
    : (
      <button
        ref={headerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="cth-schedule-row"
        style={{ ...headerStyle, cursor: 'pointer' }}
      >{headerBody}</button>
    );

  return (
    <div style={{ boxShadow: 'inset 0 -1px 0 var(--cth-ink-100)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {header}
        {!readOnly && (
          <Toggle
            on={mission.enabled}
            onClick={toggle}
            disabled={busy}
            label={t('schedulesSection.runAria', { job: mission.label })}
          />
        )}
      </div>
      {mission.relay && <Hint>{t('schedulesSection.relayHint', { godName })}</Hint>}
      {failed && !open && <Line tone="error">{t('schedulesSection.saveFailed')}</Line>}

      {open && !readOnly && (
        <div
          style={{ borderRadius: 'var(--cth-r-md)', padding: '4px 8px 12px', background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || isComposingKey(e.nativeEvent)) return;
            e.stopPropagation();
            if (confirming) cancelDelete(); else { setOpen(false); headerRef.current?.focus(); }
          }}
        >
          <Field label={t('schedulesSection.label')}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, fontSize: 14, lineHeight: '20px' }} />
          </Field>
          <Field label={t('schedulesSection.when')}>
            {heartbeat
              ? <SchedulePicker intervalMs={intervalMs} weekly={null} onInterval={setIntervalMs} onWeekly={() => { /* interval only */ }} />
              : <WhenLines lines={lines} onChange={setLines} />}
            {heartbeat && <Hint>{t('schedulesSection.beatCeiling')}</Hint>}
          </Field>
          {heartbeat && (
            <Field label={t('schedulesSection.prompt')}>
              <textarea
                dir={rtl ? 'auto' : undefined}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder={t('schedulesSection.promptPlaceholder')}
                style={textareaStyle}
              />
            </Field>
          )}
          {!heartbeat && (
            <FocusField
              value={focus}
              onChange={(v) => { setFocus(v); setFocusTouched(true); focusCheck.clear(); }}
              conflict={focusCheck.conflict}
              hint={legacy && !mission.focus ? t('schedulesSection.focusFromOlder') : undefined}
            />
          )}
          {failed && <Line tone="error">{t('schedulesSection.saveFailed')}</Line>}
          {canRunNow && runState === 'failed' && !dirty && <Line tone="error">{t('schedulesSection.runNowFailed')}</Line>}
          {/* An unsaved edit is why Run now is off, so it outranks an earlier
              run's answer. */}
          {canRunNow && (dirty || runState === 'sent' || runState === 'justRan') && (
            <div role="status" style={{ fontSize: 14, lineHeight: '20px', padding: '8px 0', color: 'var(--cth-ink-700)' }}>
              {dirty ? t('schedulesSection.runNowSaveFirst')
                : runState === 'sent' ? t('schedulesSection.runNowSent', { name: ownerName })
                  : t('schedulesSection.runNowJustRan')}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            {confirming ? (
              <>
                <span style={{ fontSize: 14, color: 'var(--cth-ink-900)' }}>{t('schedulesSection.sure')}</span>
                <MiniButton tone="destructive" onClick={remove} disabled={busy} autoFocus>{t('schedulesSection.deleteIt')}</MiniButton>
                <MiniButton onClick={cancelDelete}>{t('schedulesSection.keep')}</MiniButton>
              </>
            ) : (
              <MiniButton tone="danger" onClick={() => setConfirming(true)} buttonRef={deleteRef}>{t('common.delete')}</MiniButton>
            )}
            <span style={{ flex: 1 }} />
            {canRunNow && (
              <MiniButton
                onClick={() => void runNow()}
                disabled={busy || runState === 'sending' || dirty}
                label={t('schedulesSection.runNowAria', { job: mission.label })}
              >
                {runState === 'sending' ? t('schedulesSection.runNowSending') : t('schedulesSection.runNow')}
              </MiniButton>
            )}
            {/* Closing drops unsaved edits: the draft is reseeded on the next open. */}
            <MiniButton onClick={() => { setOpen(false); headerRef.current?.focus(); }}>
              {dirty ? t('common.cancel') : t('common.close')}
            </MiniButton>
            <PixelButton variant="primary" size="sm" onClick={() => void save()} disabled={busy || focusCheck.checking || !dirty || !label.trim() || !whenIsUsable || (!!mission.focus && !cleanFocus(focus))}>
              {focusCheck.checking ? t('schedulesSection.checking')
                : focusCheck.conflict ? t('schedulesSection.saveAnyway')
                  : saved && !dirty ? t('schedulesSection.saved') : t('common.save')}
            </PixelButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── add form ─────────────────────────────── */

function AddSchedule({ to, ownerName, focusOwner }: { to: string; ownerName: string; focusOwner: FocusOwner }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [focus, setFocus] = useState('');
  const focusCheck = useFocusCheck(focusOwner);
  const firstLines = (): LineDraft[] => linesFromMission({ intervalMs: DEFAULT_INTERVAL_MS });
  const [lines, setLines] = useState<LineDraft[]>(firstLines);
  const { busy, failed, setFailed, run } = useSaveOp();
  const whenFields = fieldsFromLines(lines, DEFAULT_INTERVAL_MS);
  const whenIsUsable = whenFields !== null;
  const reset = () => { setAdding(false); setLabel(''); setFocus(''); focusCheck.clear(); setLines(firstLines()); setFailed(false); };

  const add = async () => {
    const cleanLabel = label.trim();
    const cleanedFocus = cleanFocus(focus);
    if (!cleanLabel || !whenIsUsable || !cleanedFocus) return;
    if (!whenFields) return;
    if (!(await focusCheck.check(cleanLabel, cleanedFocus))) return;
    await run(() => window.cth.upsertMission({
      id: `m_${Date.now().toString(36)}`,
      label: label.trim(),
      intervalMs: whenFields.intervalMs,
      ...(whenFields.weekly ? { weekly: whenFields.weekly } : {}),
      ...(whenFields.times ? { times: whenFields.times } : {}),
      to,
      body: '',
      focus: cleanedFocus,
      enabled: true,
      createdBy: OWNER
    }), reset);
  };

  if (!adding) {
    return (
      <div style={{ marginTop: 12 }}>
        <PixelButton variant="secondary" size="sm" onClick={() => setAdding(true)}>
          {t('schedulesSection.addFor', { name: ownerName })}
        </PixelButton>
      </div>
    );
  }
  return (
    <div style={{ borderRadius: 'var(--cth-r-md)', marginTop: 12, padding: '4px 8px 12px', background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
      <Field label={t('schedulesSection.label')}>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('schedulesSection.labelPlaceholder')}
          style={{ ...inputStyle, fontSize: 14, lineHeight: '20px' }}
        />
        <Hint>{t('schedulesSection.labelHint')}</Hint>
      </Field>
      <Field label={t('schedulesSection.when')}>
        <WhenLines lines={lines} onChange={setLines} />
      </Field>
      <FocusField value={focus} onChange={(v) => { setFocus(v); focusCheck.clear(); }} conflict={focusCheck.conflict} />
      {failed && <Line tone="error">{t('schedulesSection.saveFailed')}</Line>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <PixelButton variant="primary" size="sm" onClick={() => void add()} disabled={busy || focusCheck.checking || !label.trim() || !whenIsUsable || !cleanFocus(focus)}>
          {focusCheck.checking ? t('schedulesSection.checking') : focusCheck.conflict ? t('schedulesSection.saveAnyway') : t('common.add')}
        </PixelButton>
        <PixelButton variant="ghost" size="sm" onClick={reset}>{t('common.cancel')}</PixelButton>
      </div>
    </div>
  );
}

/* ───────────────────────────── the list modes ───────────────────────────── */

function useNameOf(): (id: string) => string {
  const agents = useStore((s) => s.agents);
  const godName = useResolvedGodName();
  const [registry, setRegistry] = useState<Record<string, { name: string }>>({});
  useEffect(() => {
    window.cth.hiveRegistry().then((r) => setRegistry(r.agents ?? {})).catch(() => { /* names fall back to ids */ });
  }, []);
  return (id: string) => {
    if (id === GOD_ALIAS) return godName;
    const live = agents.find((a) => a.id === id);
    if (live?.isGod) return godName;
    return live?.name ?? registry[id]?.name ?? id;
  };
}

/** One agent's own schedules, editable. `agentId` is its floor id. */
export function AgentSchedules({ agentId, agentName, businessType, sourceCard }: {
  agentId: string; agentName: string; businessType?: string; sourceCard?: string;
}) {
  const { t } = useTranslation();
  const { missions, status, retry } = useMissions();
  const godId = useGodId();
  const nameOf = useNameOf();
  const agents = useStore((s) => s.agents);
  const config = useHarnessConfig();
  const mine = useMemo(() => missionsFor(missions, agentId, godId), [missions, agentId, godId]);
  const isGod = agentId === godId;
  // Michael's schedules keep the 'god' alias the router understands.
  const to = isGod ? GOD_ALIAS : agentId;
  const [suggestionData, setSuggestionData] = useState<{ key: string; items: StarterSuggestion[] } | null>(null);
  const { busy: suggestionBusy, failed: suggestionFailed, run: saveSuggestion } = useSaveOp();
  const suggestionKey = `${agentId}:${businessType ?? ''}:${sourceCard ?? ''}`;
  const starterItems = suggestionData?.key === suggestionKey ? suggestionData.items : [];
  const suggestionSaving = useRef(false);
  const suggestions = isGod ? [] : remainingStarterMissions(
    starterItems, to, missions, godId, (i) => `suggestion_${agentId}_${i}`
  );

  useEffect(() => {
    let alive = true;
    setSuggestionData(null);
    if (status !== 'ready' || isGod) return;
    void window.cth.packsList()
      .then(({ packs, core }) => {
        const available = [...packs.map((p) => p.pack), core].filter((p): p is OfficePack => !!p);
        if (alive) setSuggestionData({
          key: suggestionKey,
          // Keep all definitions for recognizing existing starter jobs; the
          // remaining list is capped after excluding jobs already added.
          items: starterSuggestionsFor(available, businessType, agentId, sourceCard, Infinity)
        });
      })
      .catch(() => { /* The manual add button still works if packs cannot load. */ });
    return () => { alive = false; };
  }, [agentId, businessType, sourceCard, suggestionKey, status, isGod]);

  const addSuggestion = (suggestion: ScheduledMission): void => {
    if (suggestionSaving.current || suggestionBusy) return;
    // Recheck the current store: another view may have added a custom job or
    // this starter since the row was rendered.
    const mission = remainingStarterMissions(
      starterItems, to, useStore.getState().missions, godId,
      (i) => `m_${Date.now().toString(36)}_${agentId}_${i}`
    ).find((m) => m.label === suggestion.label);
    if (!mission) return;
    suggestionSaving.current = true;
    void saveSuggestion(() => window.cth.upsertMission(mission), () => {
      const current = useStore.getState();
      if (!current.missions.some((m) => m.id === mission.id)) {
        current.setMissions([...current.missions, mission], 'ready');
      }
      refreshMissions();
    }).finally(() => { suggestionSaving.current = false; });
  };

  const waiting = loadState(status, missions.length === 0, t('schedulesSection.loadError', { name: agentName }), retry, t);
  if (waiting) return waiting;

  const on = mine.filter((m) => m.enabled);
  const next = on.map((m) => nextRunAt(m, Date.now())).filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
  const ordered = [...mine].sort((a, b) => (nextRunAt(a, Date.now()) ?? Infinity) - (nextRunAt(b, Date.now()) ?? Infinity));

  // A focus area is checked against this agent's Work style and its other
  // jobs on save (FA3).
  const agent = agents.find((a) => a.id === agentId);
  const focusOwner: FocusOwner = { agentId, name: agentName, workStyle: agent ? effectiveWorkStyle(agent) : '', jobs: mine };

  return (
    <div>
      {mine.length === 0 ? (
        <Line>{t('schedulesSection.emptyAgent', { name: agentName })}</Line>
      ) : (
        <Line>
          {t(on.length === 1 ? 'schedulesSection.agentSummary' : 'schedulesSection.agentSummaryPlural', { name: agentName, count: on.length })}
          {next !== undefined && ` ${t('schedulesSection.nextAt', { time: new Date(next).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}`}
        </Line>
      )}
      <div style={{ boxShadow: mine.length ? 'inset 0 1px 0 var(--cth-ink-100)' : undefined }}>
        {ordered.map((m) => (
          <ScheduleRow
            key={m.id}
            mission={m}
            nameOf={nameOf}
            ownerName={agentName}
            noEmail={!!config && cannotCheckEmail(m, config.agentCapabilities?.[agentId]?.email, gmailConnectorOn(config, agentId))}
            focusOwner={focusOwner}
          />
        ))}
      </div>
      {suggestions.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
              padding: '8px 0', borderTop: '1px solid var(--cth-ink-100)'
            }}>
              <span style={{ flex: '1 1 200px', fontSize: 14, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
                {t('schedulesSection.suggestedJob', { title: suggestion.label, schedule: whenText(suggestion, t) })}
              </span>
              <PixelButton
                variant="secondary"
                size="sm"
                disabled={suggestionBusy}
                ariaLabel={t('schedulesSection.addSuggestedJob', { title: suggestion.label })}
                onClick={() => addSuggestion(suggestion)}
              >{t('common.add')}</PixelButton>
            </li>
          ))}
        </ul>
      )}
      {suggestionFailed && <Line tone="error">{t('schedulesSection.saveFailed')}</Line>}
      <AddSchedule to={to} ownerName={agentName} focusOwner={focusOwner} />
    </div>
  );
}

/** Every other agent's schedules, read only, grouped by agent. */
export function OfficeSchedules() {
  const { t } = useTranslation();
  const { missions, status, retry } = useMissions();
  const godId = useGodId();
  const nameOf = useNameOf();
  const agents = useStore((s) => s.agents);
  const config = useHarnessConfig();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    window.cth.hiveRegistry()
      .then((r) => setClosed(Object.fromEntries(Object.entries(r.agents ?? {}).map(([id, a]) => [id, !!a.closedByOwner]))))
      .catch(() => { /* no closed groups */ });
  }, [missions]);

  const waiting = loadState(status, missions.length === 0, t('schedulesSection.loadErrorOffice'), retry, t);
  if (waiting) return waiting;

  // Only jobs that are on (owner, 2026-09-26); paused ones live on each
  // agent's Capabilities tab. Grouped by owner, Michael included: his jobs are
  // edited on his Capabilities tab like everyone's. Roster order first, then
  // anyone off the floor.
  const others = missions.filter((m) => m.enabled);
  const owners = [...new Set(others.map((m) => ownerOf(m, godId)))];
  const rosterIndex = (id: string) => { const i = agents.findIndex((a) => a.id === id); return i < 0 ? Infinity : i; };
  owners.sort((a, b) => rosterIndex(a) - rosterIndex(b));
  if (owners.length === 0) return <Line>{t('schedulesSection.officeEmpty')}</Line>;

  return (
    <div>
      {owners.map((owner) => {
        const name = nameOf(owner);
        const isClosed = closed[owner];
        const rows = others
          .filter((m) => ownerOf(m, godId) === owner)
          .sort((a, b) => (nextRunAt(a, Date.now()) ?? Infinity) - (nextRunAt(b, Date.now()) ?? Infinity));
        return (
          <section key={owner} aria-label={name} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600, color: 'var(--cth-ink-900)' }}>
              {isClosed ? t('schedulesSection.closedGroup', { name }) : name}
            </div>
            {isClosed && <Hint>{t('schedulesSection.closedNote', { name })}</Hint>}
            <div style={{ boxShadow: 'inset 0 1px 0 var(--cth-ink-100)' }}>
              {rows.map((m) => (
                <ScheduleRow
                  key={m.id}
                  mission={m}
                  nameOf={nameOf}
                  ownerName={name}
                  noEmail={!!config && cannotCheckEmail(m, config.agentCapabilities?.[owner]?.email, gmailConnectorOn(config, owner))}
                  readOnly
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The close confirmation. When the agent has schedules running, it says they
 *  will pause (design 6A); otherwise it is the plain close question. */
export function closeConfirmText(agentId: string, name: string, t: TFunction): string {
  const count = schedulesOn(agentId);
  return count > 0
    ? t(count === 1 ? 'agentDetail.killConfirmSchedules' : 'agentDetail.killConfirmSchedulesPlural', { name, count })
    : t('agentDetail.killConfirm', { name });
}

/** The Danger zone's delete confirmation in Edit agent: final, and it names
 *  the schedules that pause, like the close. */
export function deleteConfirmText(agentId: string, name: string, t: TFunction): string {
  const count = schedulesOn(agentId);
  return count > 0
    ? t(count === 1 ? 'editAgent.deleteConfirmSchedules' : 'editAgent.deleteConfirmSchedulesPlural', { name, count })
    : t('editAgent.deleteConfirm', { name });
}

/** Their schedules that are on: the same ownership rule a close or a delete
 *  uses to pause them (pauseMissionsOf). */
function schedulesOn(agentId: string): number {
  const st = useStore.getState();
  const godId = st.agents.find((a) => a.isGod)?.id ?? GOD_ALIAS;
  const count = missionsFor(st.missions, agentId, godId).filter((m) => m.enabled).length;
  return count;
}
