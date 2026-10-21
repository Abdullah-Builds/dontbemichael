/**
 * Pulse: the office's performance and cost, as pictures (docs/designs/team-performance.md,
 * approved mockups pulse-final.html and pulse-v3.html). Top to bottom:
 * recommendations, what got done (one grid of every tile with something to
 * say, then a row of quiet chips), then team at work (owner, 2026-10-15,
 * proposal 3; 2026-10-19, docs/designs/pulse-smart-view.md). Fields first; each
 * explanation sits behind an (i). Advice is amber, savings green, coral never:
 * Ask me stays the only thing that needs the owner.
 *
 *   Pulse ─ pulse:snapshot(period, compare) (on open, on a period or Compare
 *           change, on pulse:updated, and at each local midnight)
 *         ─ Apply ─ pulse:apply ─► schedule (main) | model (this store) ─► "Applied." + Undo
 *         ─ Not now ─ pulse:dismiss
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PulseView as PulseData } from '@shared/pulseView';
import type { Advice } from '@shared/teamAdvice';
import type { LearnedNote } from '@shared/teamLearning';
import { dayKey, teamAtWork, PERIODS, type Outcome, type Period, type WorkChip, type WorkKind } from '@shared/teamPerformance';
import { keptSafe, REFUSAL_GATES, type KeptSafe, type RefusalGate } from '@shared/pulseSafety';
import { pulseTiles, type PulseTile } from '@shared/pulseTiles';
import { heldCause, notesPreview, HELD_TO_MEMORY, type HeldRow } from '@shared/heldRecord';
import { changesInContext, showAsMarks, withHidden, wordChanges, type ChangePart, type CheckedList, type CheckedRow } from '@shared/checkedRecord';
import { OFFICE_OPEN_SUBJECT } from '@shared/officeOpen';
import { useStore } from '@/store/store';
import { useAppTheme } from '@/design/theme';
import { family } from '@/scene/studio/theme';
import { departmentOf, roleOf } from '@/scene/studio/layout';
import { useMissions } from '../triggers/ScheduleList';
import { Toggle } from '../triggers/ui';
import { AgentAvatar } from '../AgentAvatar';
import { InfoTip } from '../InfoTip';
import { PixelButton } from '../PixelButton';
import { Icon, type IconName } from '../Icon';
import { useDialog } from '@/shell/useDialog';
import { godNameNow } from '@/i18n';
import { useBackdropClose } from '@/hooks/useBackdropClose';
import { getNeedsYouFeed, shownQuestions } from '@/shell/useNeedsYou';
import { FOUNDATION_QUESTIONS, foundationAsk, isFoundationsDoc, type FoundationId, type FoundationsJobRow, type FoundationsMember } from '@shared/foundations';
import { ADVICE_WINDOW_MS, EARLY_SCALE, REOPEN_MIN } from '@shared/teamAdvice';

const LS_PERIOD = 'cth.pulsePeriod';
const LS_COMPARE = 'cth.pulseCompare';
const KIND_ICON: Record<WorkKind, IconName> = { email: 'mail', sent: 'send', task: 'check', check: 'clock' };
/** A quiet tile's chip: its short name and icon (pulse-smart-view.md 5A). Spent never folds. */
const QUIET_ICON: Record<PulseTile, IconName> = { email: 'mail', sent: 'send', task: 'check', check: 'clock', toInternet: 'shield', webAnswers: 'search', held: 'pause', rules: 'lock', learned: 'book', questions: 'help', spent: 'ledger', yourTime: 'bell' };

/** The team average mark: a dashed line drawn as a gradient. */
const AVG_DASH = 'repeating-linear-gradient(to bottom, var(--cth-ink-3) 0 3px, transparent 3px 6px)';
const money = (v: number): string => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
const dollars = (v: number): string => `$${Math.round(v)}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** Days before advice starts (the advice window). */
const ADVICE_DAYS = Math.round(ADVICE_WINDOW_MS / 86_400_000);
/** Reopened cards an early line names: the reopen rule's minimum, at early evidence. */
const EARLY_REOPENS = Math.ceil(REOPEN_MIN * EARLY_SCALE);

/** Open a foundation question's waiting card in Needs you, else the document
 *  in company knowledge (office-foundations.md, design D5). */
function openFoundation(ids: readonly FoundationId[]): void {
  // Only a card Needs you shows (not one put off with Not now or answered another way).
  const feed = getNeedsYouFeed();
  const task = feed.tasks.find((t) => shownQuestions(t, feed.foundations).some((e) => ids.includes(foundationAsk(e) as FoundationId)));
  if (task) { useStore.getState().openNeedsYou({ taskId: task.id }); return; }
  // No card waiting: the document itself, read only, else where it is listed.
  const settings = (): void => { window.dispatchEvent(new CustomEvent('cth:open-settings', { detail: { section: 'Memory & Knowledge' } })); };
  void window.cth.kgList()
    .then((docs) => {
      const doc = docs.find(isFoundationsDoc);
      if (!doc || !window.cth.kgOpen) { settings(); return; }
      return window.cth.kgOpen(doc.id).then((r) => { if (!r?.ok) settings(); });
    })
    .catch(settings);
}

/** The small ring beside a foundations count: decorative, the text says it. */
function FoundationRing({ answered, total, size = 12 }: { answered: number; total: number; size?: number }) {
  const share = total ? (answered / total) * 100 : 0;
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', flex: 'none', background: `conic-gradient(var(--cth-indigo) 0 ${share}%, var(--cth-line-2) ${share}% 100%)` }} />;
}

/** The Company foundations strip (design D3 to D5, D7): the jobs whose work
 *  hit an empty question, the most hit first; each opens its questions. */
function FoundationsStrip({ jobs }: { jobs: FoundationsJobRow[] }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--cth-ink-3)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>{t('pulse.foundations.label')}<InfoTip text={t('pulse.foundations.tip')} /></span>
      {jobs.map((j) => {
        const job = t(`foundations.job.${j.job}`);
        return (
          <button key={j.job} type="button" className="cth-foundation-pill" onClick={() => openFoundation(j.waiting)}
            aria-label={t('pulse.foundations.jobAria', { job, answered: j.answered, total: j.total })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: 'var(--cth-r-pill)', border: 'none', background: 'var(--cth-neutral-soft)', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink)' }}>
            {job}
            <b style={{ ...mono, fontWeight: 600 }}>{j.answered}/{j.total}</b>
            <span aria-hidden="true" style={{ width: 42, height: 5, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-line-2)', overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${j.total ? (j.answered / j.total) * 100 : 0}%`, background: 'var(--cth-indigo)' }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Member detail's Foundations box (design D14): the count, the missing
 *  questions the work hit (each opens its card), how many more no work needed,
 *  and, once the evidence exists, kept as is without and with the answers. */
function FoundationsBox({ f }: { f: FoundationsMember }) {
  const { t } = useTranslation();
  const short = (id: FoundationId): string => t(`foundations.short.${id}`, { defaultValue: FOUNDATION_QUESTIONS[id].short });
  return (
    <div style={{ background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', padding: '9px 11px', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={label}>{t('pulse.foundations.label')}<InfoTip text={t('pulse.foundations.tip')} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FoundationRing answered={f.answered} total={f.total} size={14} />
        <span style={{ ...mono, fontSize: 15, fontWeight: 600 }}>{t('pulse.foundations.of', { answered: f.answered, total: f.total })}</span>
      </div>
      {f.missing.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {f.missing.map((id) => (
            <button key={id} type="button" className="cth-foundation-pill" onClick={() => openFoundation([id])} aria-label={t('pulse.foundations.openQuestion', { what: short(id) })}
              style={{ height: 24, padding: '0 10px', borderRadius: 'var(--cth-r-pill)', border: 'none', background: 'var(--cth-indigo-soft)', color: 'var(--cth-indigo-text)', fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
              {short(id)}
            </button>
          ))}
        </div>
      )}
      {f.more > 0 && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t(f.missing.length ? 'pulse.foundations.more' : 'pulse.foundations.notNeeded', { count: f.more })}</div>}
      {f.proof && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          <div style={{ ...label, gap: 4 }}>{t('pulse.keptAsIs')}<InfoTip text={t('pulse.foundations.proofLine')} /></div>
          {([['without', f.proof.without, 'var(--cth-ink-4)'], ['with', f.proof.with, 'var(--cth-green)']] as const).map(([k, v, color]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) 40px', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--cth-ink-2)' }}>
              <span>{t(`pulse.foundations.${k}`, { what: short(f.proof!.question) })}</span>
              <span aria-hidden="true" style={{ height: 6, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${v * 100}%`, background: color }} /></span>
              <span style={{ ...mono, textAlign: 'end' }}>{pct(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function duration(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return t('pulse.minutes', { m });
  const h = Math.floor(m / 60);
  return t('pulse.hoursMinutes', { h, m: m % 60 });
}
function every(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return ms % 3_600_000 === 0 ? t('pulse.hoursShort', { h: ms / 3_600_000 }) : t('pulse.minutesShort', { m: Math.round(ms / 60_000) });
}

/** Layout by the stage's width (design D14). */
type Layout = 'wide' | 'mid' | 'narrow';
function useLayout(ref: React.RefObject<HTMLElement | null>): Layout {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0]?.contentRect.width ?? 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w >= 1100 ? 'wide' : w >= 760 ? 'mid' : 'narrow';
}

const card: CSSProperties = { background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-md)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cth-ink-3)', display: 'flex', gap: 6, alignItems: 'center' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)' };

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', gap: 6, alignItems: 'center' }}>
        {title}{tip && <InfoTip text={tip} />}
      </h2>
      {children}
    </section>
  );
}

/** A bar of who did it, members of one department in its acc, m then d shades (D13). */
function WhoBar({ by, colorOf, nameOf, height = 10, aria }: { by: Array<{ agentId: string; count: number }>; colorOf: (id: string, nth: number) => string; nameOf: (id: string) => string; height?: number; aria: string }) {
  const total = by.reduce((s, b) => s + b.count, 0) || 1;
  const seen = new Map<string, number>();
  const shades = by.map((b) => {
    const dept = colorOf(b.agentId, -1);
    const n = seen.get(dept) ?? 0;
    seen.set(dept, n + 1);
    return colorOf(b.agentId, n);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="img" aria-label={aria} style={{ display: 'flex', height, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', gap: 2 }}>
        {by.map((b, i) => <i key={b.agentId} style={{ display: 'block', width: `${(b.count / total) * 100}%`, background: shades[i] }} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--cth-ink-2)' }} aria-hidden>
        {by.map((b, i) => (
          <span key={b.agentId} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <b style={{ width: 8, height: 8, borderRadius: '50%', background: shades[i], display: 'inline-block' }} />
            {nameOf(b.agentId)} <span style={mono}>{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PulseView() {
  const { t, i18n } = useTranslation();
  const agents = useStore((s) => s.agents);
  const updateAgent = useStore((s) => s.updateAgent);
  const openAgentProfile = useStore((s) => s.openAgentProfile);
  const dark = useAppTheme() === 'dark';
  const { missions } = useMissions();
  const host = useRef<HTMLDivElement | null>(null);
  const layout = useLayout(host);
  const [period, setPeriod] = useState<Period>(() => {
    try { const v = window.localStorage.getItem(LS_PERIOD); return PERIODS.includes(v as Period) ? (v as Period) : 'this-week'; } catch { return 'this-week'; }
  });
  // The owner's choice, kept even while a period cannot compare yet (design D4).
  const [compare, setCompare] = useState<boolean>(() => { try { return window.localStorage.getItem(LS_COMPARE) === '1'; } catch { return false; } });
  const [data, setData] = useState<PulseData | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  // The held tile's list (owner, 2026-10-16).
  const [heldOpen, setHeldOpen] = useState(false);
  // The new notes behind Learning's number (owner, 2026-10-18).
  const [learnedOpen, setLearnedOpen] = useState(false);
  // Quiet tiles opened from their chips, and the folded quiet members, until the
  // period changes; leaving Pulse unmounts the view (pulse-smart-view.md 2A, 1C).
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [quietRowsOpen, setQuietRowsOpen] = useState(false);
  const [focusTile, setFocusTile] = useState<string | null>(null);
  // The tiles the last render showed, so a tile or chip that moves fades in (3A).
  const shownBefore = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => { setOpened(new Set()); setQuietRowsOpen(false); }, [period]);
  // An opened chip's tile takes focus once it is in the grid (6A).
  useEffect(() => {
    if (!focusTile) return;
    document.getElementById(`pulse-tile-${focusTile}`)?.focus();
    setFocusTile(null);
  }, [focusTile]);
  // The questions and answers lists (owner, 2026-10-16).
  const [checkedOpen, setCheckedOpen] = useState<'in' | 'out' | null>(null);
  const [applied, setApplied] = useState<Array<{ advice: Advice; appliedId: number; text: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async () => {
    try { setData(await window.cth.pulseSnapshot(period, compare)); setFailed(false); } catch { setFailed(true); }
  }, [period, compare]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.cth.onPulseUpdated(() => { void load(); }), [load]);
  // A new day, week or month starts at local midnight, and a quiet office sends
  // no update then, so Pulse reloads itself rather than show yesterday as Today.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = (): void => {
      const next = new Date(); next.setHours(24, 0, 1, 0);
      timer = setTimeout(() => { void load(); arm(); }, next.getTime() - Date.now());
    };
    arm();
    return () => clearTimeout(timer);
  }, [load]);

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const colorOf = useCallback((id: string, nth: number): string => {
    const a = byId.get(id);
    const f = family(a ? departmentOf(a) : 'team', dark);
    if (nth < 0) return a ? departmentOf(a) : 'team';
    return [f.acc, f.m, f.d][nth % 3];
  }, [byId, dark]);
  const fmtShort = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const fmtSpan = (from: string, to: string): string => (from === to ? fmtDay(from) : t('pulse.daySpan', { from: fmtShort(from), to: fmtShort(to) }));
  const listNames = (names: string[]): string => { try { return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names); } catch { return names.join(', '); } };
  const fmtDay = (day: string | number): string => new Date(typeof day === 'number' ? day : `${day}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const jobOf = (id?: string): string => missions.find((m) => m.id === id)?.label ?? '';

  const adviceText = (a: Advice): { title: string; evidence: string } => {
    const name = nameOf(a.agentId);
    const job = jobOf(a.missionId);
    const e = a.evidence;
    switch (a.kind) {
      case 'run-less': return { title: t('pulse.advice.runLess', { name, job }), evidence: t('pulse.advice.runLessWhy', { nothing: e.nothing, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'run-more': return { title: t('pulse.advice.runMore', { name, job }), evidence: t('pulse.advice.runMoreWhy', { didWork: e.didWork, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'cheaper-model': return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: t('pulse.advice.cheaperWhy', { kept: e.kept, decisions: e.decisions }) };
      default: return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: e.reopens && e.reopens >= 3 ? t('pulse.advice.reopenedWhy', { reopens: e.reopens }) : t('pulse.advice.strongerWhy', { kept: e.kept, decisions: e.decisions }) };
    }
  };

  // An early line states what a rule sees so far and names no model (eng D2).
  const earlyText = (a: Advice): string => {
    const name = nameOf(a.agentId);
    const e = a.evidence;
    switch (a.kind) {
      case 'run-less': return t('pulse.early.runLess', { name, job: jobOf(a.missionId), nothing: e.nothing, runs: e.runs });
      case 'run-more': return t('pulse.early.runMore', { name, job: jobOf(a.missionId), didWork: e.didWork, runs: e.runs });
      case 'cheaper-model': return t('pulse.early.kept', { name, kept: e.kept, decisions: e.decisions });
      default: return e.reopens && e.reopens >= EARLY_REOPENS ? t('pulse.early.reopened', { name, reopens: e.reopens }) : t('pulse.early.keptFew', { name, kept: e.kept ?? 0, decisions: e.decisions });
    }
  };

  const apply = async (a: Advice): Promise<void> => {
    if (a.change.kind === 'editor') { openAgentProfile(a.agentId); return; }
    if (busy) return;
    setBusy(a.id);
    try {
      const r = await window.cth.pulseApply(a.id, a.change);
      if (!r.ok) { setNotice(t(r.error === 'stale' ? 'pulse.staleApply' : 'pulse.applyFailed')); await load(); return; }
      let appliedId = r.kind === 'schedule' ? r.appliedId : 0;
      let text = '';
      if (r.kind === 'schedule' && a.change.kind === 'interval') text = t('pulse.appliedSchedule', { name: nameOf(a.agentId), job: jobOf(a.missionId), to: every(a.change.toMs, t) });
      if (r.kind === 'model') {
        updateAgent(r.agentId, { model: r.to });
        appliedId = await window.cth.pulseModelApplied(a.id, r.agentId, r.from, r.to);
        text = t('pulse.appliedModel', { name: nameOf(r.agentId), model: a.change.kind === 'model' ? a.change.toLabel : r.to });
      }
      setApplied((list) => [...list, { advice: a, appliedId, text }]);
      setNotice(text);
      await load();
    } finally { setBusy(null); }
  };
  const undo = async (item: { advice: Advice; appliedId: number }): Promise<void> => {
    const r = await window.cth.pulseUndo(item.appliedId);
    if (!r.ok) { setNotice(t('pulse.staleUndo')); return; }
    if (r.kind === 'model') updateAgent(r.agentId, { model: r.to ?? undefined });
    setApplied((list) => list.filter((x) => x.appliedId !== item.appliedId));
    setNotice(t('pulse.undone'));
    await load();
  };
  const notNow = async (a: Advice): Promise<void> => { await window.cth.pulseDismiss(a.id); await load(); };

  const view = data;
  const cols = layout === 'wide' ? 4 : layout === 'mid' ? 2 : 1;
  const sugCols = layout === 'wide' ? 3 : layout === 'mid' ? 2 : 1;
  const grid = (n: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 12 });

  let body: ReactNode;
  let shownNow: ReadonlySet<string> | null = null;
  if (failed || (view && !view.available)) {
    body = (
      <div style={{ ...card, padding: 26, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t('pulse.unavailable')}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.unavailableHint')}</div>
        <PixelButton variant="secondary" size="sm" style={{ marginTop: 6 }} onClick={() => { void load(); }}>{t('pulse.tryAgain')}</PixelButton>
      </div>
    );
  } else if (!view) {
    body = null;
  } else {
    const s = view.snapshot;
    const godId = s.michael?.agentId;
    const shownAdvice = view.advice.filter((a) => !applied.some((x) => x.advice.id === a.id));
    // A snapshot from a main process older than this view (before a restart) has neither.
    const safe = view.keptSafe ?? keptSafe([]);
    const toNet = safe.toInternet.pass + safe.toInternet.clean + safe.toInternet.stop;
    const answers = safe.webAnswers.pass + safe.webAnswers.clean;
    // Only the gates this view can name: a count from another build is left out.
    const rules = (Object.entries(safe.rules) as Array<[RefusalGate, number]>).filter(([g, n]) => REFUSAL_GATES.includes(g) && n > 0);
    const rulesTotal = rules.reduce((n, [, x]) => n + x, 0);
    // A snapshot from a main process older than this view (before a restart) has no period figures.
    const learn = view.learning?.period ? view.learning : { period: { added: { you: 0, job: 0, michael: 0 }, asks: 0, turns: 0, per100: null }, previous: null, notes: 0, procedures: 0, knows: {} };
    const tight: CSSProperties = { ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 };
    // Learning follows the period (owner, 2026-10-15).
    const cur = learn.period;
    const rate = cur.per100;
    const curAdded = cur.added.you + cur.added.job + cur.added.michael;
    // Compare (owner, 2026-10-16): with the switch on and the period ready, every
    // tile shows two bars, the span before and this one (D6), named for the
    // period (D5); spoken with their exact days. Null when off or not ready.
    const pv = view.compare?.snapshot ?? null;
    const pk = view.compare?.keptSafe ?? null;
    const pl = pv ? learn.previous : null;
    const pairLabels = [t(`pulse.compareBefore.${s.period}`), t(`pulse.periods.${s.period}`)];
    const pairSpoken = pv ? [`${pairLabels[0]}, ${fmtSpan(pv.from, pv.to)}`, `${pairLabels[1]}, ${fmtSpan(s.from, s.to < dayKey(Date.now()) ? s.to : dayKey(Date.now()))}`] : pairLabels;
    const pair = (before: number | null, now: number | null, aria: string, color = 'var(--cth-ink-2)', format?: (v: number) => string): ReactNode => (
      <WeekBars before labels={pairLabels} spoken={pairSpoken} series={[{ values: [before, now], color }]} aria={aria} format={format} />
    );
    const toNetOf = (k: KeptSafe): number => k.toInternet.pass + k.toInternet.clean + k.toInternet.stop;
    const rulesOf = (k: KeptSafe): number => (Object.entries(k.rules) as Array<[RefusalGate, number]>).filter(([g, n]) => REFUSAL_GATES.includes(g) && n > 0).reduce((n, [, x]) => n + x, 0);
    const gaps = [...new Set([...(pv?.gapDays ?? []), ...s.gapDays])];
    // Team at work: everyone on the team now, Michael included, busiest first.
    const rows = s.members.filter((m) => byId.has(m.agentId))
      .map((m) => ({ ...m, busyMs: m.busyMs ?? 0, turns: m.turns ?? 0, dayBusy: m.dayBusy ?? [] }))
      .sort((a, b) => b.busyMs - a.busyMs);
    const work = teamAtWork(rows);
    const maxBusy = Math.max(1, ...rows.map((m) => m.busyMs));
    const workGrid: CSSProperties = { display: 'grid', alignItems: 'center', gap: 14, gridTemplateColumns: layout === 'wide' ? '190px minmax(0, 1fr) 66px 86px' : layout === 'mid' ? '170px minmax(0, 1fr) 66px 76px' : 'minmax(0, 1fr) minmax(0, 1fr) 60px 70px' };
    // On a plan or an API key the dollars are a real cost; otherwise a pay per use value.
    const costWord = view.plan || view.billing === 'apiKey' ? 'pulse.work.cost' : 'pulse.work.value';
    // Emails sent names how many went out approved without edits, only once any were sent (owner, 2026-10-19).
    const outcomeLabel = (o: Outcome): string => t(o.kind === 'sent' && o.total === 0 ? 'pulse.outcome.sentNone' : `pulse.outcome.${o.kind}`, { sub: o.sub ?? 0 });
    const outcomeAria = (o: Outcome): string => `${outcomeLabel(o)}: ${o.by.map((b) => `${nameOf(b.agentId)} ${b.count}`).join(', ')}`;
    // Saved by your changes shows only once a change was applied (owner, 2026-10-15).
    const savedShown = view.saved.state !== 'none';
    const noAdvice = shownAdvice.length === 0 && applied.length === 0;
    // A main process older than this view sends no early lines.
    const early = view.early ?? [];
    // The Company foundations strip (office-foundations.md); none from an older main.
    const foundationJobs = view.foundations?.jobs ?? [];
    // Which of the 14 days before advice this is, counted from the first live day.
    const learnDay = view.liveSince ? Math.min(ADVICE_DAYS, Math.max(1, Math.round((new Date(`${dayKey(Date.now())}T12:00:00`).getTime() - new Date(`${view.liveSince}T12:00:00`).getTime()) / 86_400_000) + 1)) : 1;
    // What shows and what folds (owner, 2026-10-19; pulse-smart-view.md, eng D2):
    // one grid in today's order, then a chip for each quiet tile.
    const tilesNow = pulseTiles({ snapshot: s, keptSafe: safe, learning: cur }, pv && pk ? { snapshot: pv, keptSafe: pk, learning: pl } : null, opened);
    shownNow = new Set(tilesNow.shown);
    // A tile that just joined the grid, or a chip that just joined the row, fades in (3A).
    const fresh = (id: string, inGrid: boolean): boolean => shownBefore.current !== null && shownBefore.current.has(id) !== inGrid;
    const periodWord = t(`pulse.quiet.period.${s.period}`);
    const outcomeTile = (o: Outcome): ReactNode => (
                <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div aria-hidden style={{ width: 30, height: 30, borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: 'var(--cth-ink-2)' }}><Icon name={KIND_ICON[o.kind]} size={1.125} /></div>
                <div style={{ ...mono, fontSize: 28, fontWeight: 600, lineHeight: '30px' }}>{o.total.toLocaleString(i18n.language)}</div>
                <div style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{outcomeLabel(o)}</div>
                {pv ? pair(pv.outcomes.find((x) => x.kind === o.kind)?.total ?? 0, o.total, outcomeLabel(o))
                  : o.kind === 'check'
                  ? <WhoBar by={[{ agentId: '__work', count: o.sub ?? 0 }, { agentId: '__none', count: o.total - (o.sub ?? 0) }]} colorOf={(id) => (id === '__work' ? 'var(--cth-ink-2)' : 'var(--cth-line-2)')} nameOf={(id) => t(id === '__work' ? 'pulse.foundWork' : 'pulse.nothingToDo')} aria={outcomeLabel(o)} />
                  : <WhoBar by={o.by} colorOf={colorOf} nameOf={nameOf} aria={outcomeAria(o)} />}
              </div>
    );
    const oTile = (k: WorkKind): ReactNode => { const o = s.outcomes.find((x) => x.kind === k); return o ? outcomeTile(o) : null; };
    // Each tile keeps its own build wherever it shows (eng R3).
    const tile: Record<PulseTile, ReactNode> = {
      email: oTile('email'),
      sent: oTile('sent'),
      task: oTile('task'),
      check: oTile('check'),
      toInternet: <StatTile icon="shield" value={toNet} trend={pk && pair(toNetOf(pk), toNet, t('pulse.safe.toInternet'))} tip={t('pulse.safe.toInternetTip')} text={t('pulse.safe.toInternet')}
              parts={[{ n: safe.toInternet.pass, name: t('pulse.safe.sentAsWritten'), color: 'var(--cth-ink-2)' }, { n: safe.toInternet.clean, name: t('pulse.safe.privateOut'), color: 'var(--cth-green)' }, { n: safe.toInternet.stop, name: t('pulse.safe.stopped'), color: 'var(--cth-amber)' }]}
              open={toNet > 0 ? { label: t('pulse.checked.q.open'), onClick: () => setCheckedOpen('in') } : undefined} />,
      webAnswers: <StatTile icon="search" value={safe.webAnswers.clean} of={answers} trend={pk && pair(pk.webAnswers.clean, safe.webAnswers.clean, t('pulse.safe.answersCleaned'), 'var(--cth-green)')} tip={t('pulse.safe.answersTip')} text={t('pulse.safe.answersCleaned')}
              parts={[{ n: safe.webAnswers.clean, name: t('pulse.safe.cleaned'), color: 'var(--cth-green)' }, { n: safe.webAnswers.pass, name: t('pulse.safe.nothingToRemove'), color: 'var(--cth-ink-4)' }, { n: safe.webAnswers.flagged, name: t('pulse.safe.flagged'), color: 'var(--cth-amber)' }]}
              open={answers > 0 ? { label: t('pulse.checked.a.open'), onClick: () => setCheckedOpen('out') } : undefined} />,
      held: <StatTile icon="pause" value={safe.held} trend={pk && pair(pk.held, safe.held, t('pulse.safe.held'), 'var(--cth-amber)')} tip={t('pulse.safe.heldTip')} text={t('pulse.safe.held')} amber={safe.held > 0}
              open={safe.held > 0 ? { label: t('pulse.held.open'), onClick: () => setHeldOpen(true) } : undefined} />,
      rules: <StatTile icon="lock" value={rulesTotal} trend={pk && pair(rulesOf(pk), rulesTotal, t('pulse.safe.rules'))} tip={t('pulse.safe.rulesTip')} text={t('pulse.safe.rules')}
              parts={[...rules].sort((a, b) => b[1] - a[1]).map(([g, n], i) => ({ n, name: t(`pulse.safe.gate.${g}`), color: ['var(--cth-ink-2)', 'var(--cth-ink-3)', 'var(--cth-ink-4)', 'var(--cth-line-2)'][Math.min(i, 3)] }))} />,
      learned: (
          <div style={tight}>
            <TileTitle icon="book" title={t('pulse.learning.learned')} sub={t(`pulse.learning.sub.${s.period}`)} tip={t('pulse.learning.tip')} />
            <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{curAdded.toLocaleString(i18n.language)}</div>
            {pl && <WeekBars before labels={pairLabels} spoken={pairSpoken} series={[{ values: [pl.added.you, cur.added.you], color: 'var(--cth-green)' }, { values: [pl.added.job, cur.added.job], color: 'var(--cth-ink-4)' }, { values: [pl.added.michael, cur.added.michael], color: 'var(--cth-indigo)' }]} aria={t(`pulse.learning.sub.${s.period}`)} />}
            {!pl && curAdded > 0 && <Stack parts={[{ n: cur.added.you, color: 'var(--cth-green)' }, { n: cur.added.job, color: 'var(--cth-ink-4)' }, { n: cur.added.michael, color: 'var(--cth-indigo)' }]} aria={`${t('pulse.learning.fromYou')} ${cur.added.you}, ${t('pulse.learning.onJob')} ${cur.added.job}, ${t('pulse.learning.fromMichael')} ${cur.added.michael}`} />}
            {curAdded > 0 && <Legend items={[[t('pulse.learning.fromYou'), 'var(--cth-green)', cur.added.you], [t('pulse.learning.onJob'), 'var(--cth-ink-4)', cur.added.job], [t('pulse.learning.fromMichael'), 'var(--cth-indigo)', cur.added.michael]]} />}
            {curAdded > 0 && <button type="button" onClick={() => setLearnedOpen(true)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--cth-indigo-text)' }}>{t('pulse.learning.open')}</button>}
            <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.learning.inAll', { notes: learn.notes.toLocaleString(i18n.language), procedures: learn.procedures })}</div>
          </div>
      ),
      questions: (
          <div style={tight}>
            <TileTitle icon="help" title={t('pulse.learning.questions')} sub={t('pulse.learning.questionsSub')} />
            <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{rate !== null ? rate.toFixed(1) : '…'}</div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-2)', lineHeight: '15px' }}>
              {rate === null ? t('pulse.learning.tooFewRate') : t('pulse.learning.counts', { asks: cur.asks, turns: cur.turns.toLocaleString(i18n.language) })}
            </div>
            {/* A span under 20 requests draws no bar and reads "…" (eng O2). */}
            {pl && (pl.per100 !== null || rate !== null) && pair(pl.per100, rate, t('pulse.learning.questionsSub'), 'var(--cth-ink-2)', (v) => v.toFixed(1))}
            {/* The earlier bar's "…" says why (pulse compare v2). */}
            {pl && pl.per100 === null && rate !== null && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.learning.tooFewBefore', { before: pairLabels[0] })}</div>}
          </div>
      ),
      // One total (owner, 2026-10-15): who spent what is Team at work's job.
      // Plan use sits at the foot of the same tile, as a bar, so the tile
      // is filled top to bottom like its neighbours.
      spent: (
          <div style={{ ...tight, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={label}>
                {t('pulse.whereMoneyWent')}
                <InfoTip text={view.plan ? t('pulse.plan.tip', { monthly: dollars(view.plan.monthly), payPerUse: money(view.plan.payPerUse) }) : t('pulse.valueTip')} />
              </div>
              <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{money(s.totalUsd)}</div>
              <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>
                {view.plan
                  ? t('pulse.plan.ofPlan', { plan: view.plan.label ?? t('pulse.plan.yourPlan'), monthly: dollars(view.plan.monthly) })
                  : t(view.billing === 'apiKey' ? 'pulse.spentApiKey' : 'pulse.plan.noPrice')}
              </div>
            </div>
            {pv && pair(pv.totalUsd, s.totalUsd, t('pulse.whereMoneyWent'), 'var(--cth-ink-2)', (v) => `$${Math.round(v)}`)}
            {view.headroom && (
              <div role="img" aria-label={t('pulse.planAria', { pct: Math.round(view.headroom.usedPct) })} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={label}>{t('pulse.planUse')}<InfoTip text={t('pulse.planTip')} /></span>
                  <span style={{ ...mono, fontSize: 12, fontWeight: 600, marginInlineStart: 'auto' }}>{Math.round(view.headroom.usedPct)}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.min(100, view.headroom.usedPct)}%`, background: view.headroom.runsOutAt ? 'var(--cth-amber)' : 'var(--cth-ink-2)', borderRadius: 'var(--cth-r-pill)' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 10.5, color: 'var(--cth-ink-3)' }}>
                  {t('pulse.resets', { day: fmtDay(view.headroom.resetsAt) })}
                  {view.headroom.runsOutAt && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--cth-amber-text)', background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-pill)', padding: '1px 6px' }}>{t('pulse.runsOut', { day: fmtDay(view.headroom.runsOutAt) })}</span>}
                </div>
              </div>
            )}
          </div>
      ),
      // Your time and while you were away: both about you, one tile; the
      // number at the top, what it means at the foot.
      yourTime: (
          <div style={{ ...tight, flexDirection: 'row', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={label}>{t('pulse.yourTime')}<InfoTip text={t('pulse.yourTimeTip')} /></div>
                <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{s.yourTime.asks}</div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{s.yourTime.medianWaitMs !== null ? t('pulse.questionsAnswered', { time: duration(s.yourTime.medianWaitMs, t) }) : t('pulse.questions')}</div>
              </div>
              {pv && pair(pv.yourTime.asks, s.yourTime.asks, t('pulse.yourTime'))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0, paddingInlineStart: 14, boxShadow: 'inset 1px 0 0 var(--cth-line)', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={label}>{t('pulse.whileAway')}<InfoTip text={t('pulse.awayTip')} /></div>
                <div style={{ ...mono, fontSize: 24, fontWeight: 600, lineHeight: '26px' }}>{s.awayShare === null ? '0%' : pct(s.awayShare)}</div>
              </div>
              {pv ? pair(pv.awayShare, s.awayShare, t('pulse.whileAway'), 'var(--cth-ink-2)', pct)
                : <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{t('pulse.awayLine')}</div>}
            </div>
          </div>
      )
    };
    // One member's row; it opens their week.
    const memberRow = (m: (typeof rows)[number]): ReactNode => {
      const chip = work.chips[m.agentId];
      const quiet = chip?.kind === 'quiet';
      const color = m.agentId === godId ? 'var(--cth-indigo)' : colorOf(m.agentId, 0);
      const role = m.agentId === godId ? t('pulse.officeManager') : byId.get(m.agentId) ? roleOf(byId.get(m.agentId)!) : '';
      const fm = view.foundations?.members[m.agentId];
      return (
        <div key={m.agentId} role="listitem"><button type="button" onClick={() => setDetail(m.agentId)}
          aria-label={fm && fm.answered < fm.total
            ? t('pulse.work.rowAriaFoundations', { row: t('pulse.work.rowAria', { name: nameOf(m.agentId), time: duration(m.busyMs, t), value: money(m.usd) }), foundations: t('pulse.foundations.count', { answered: fm.answered, total: fm.total }) })
            : t('pulse.work.rowAria', { name: nameOf(m.agentId), time: duration(m.busyMs, t), value: money(m.usd) })}
          style={{ ...workGrid, width: '100%', minHeight: 44, border: 'none', borderTop: '1px solid var(--cth-line)', background: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)', padding: 0 }}>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, opacity: quiet ? 0.7 : 1 }}>
            <span style={{ borderRadius: '50%', boxShadow: `0 0 0 1.5px ${color}`, display: 'inline-flex', flex: 'none' }}><AgentAvatar id={m.agentId} name={nameOf(m.agentId)} size={24} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(m.agentId)}</span>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</span>
              {/* The foundations count under the role (D6); gone once all are answered (D9). */}
              {fm && fm.answered < fm.total && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 11, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap' }}>
                  <FoundationRing answered={fm.answered} total={fm.total} />{t('pulse.foundations.count', { answered: fm.answered, total: fm.total })}
                </span>
              )}
            </span>
          </span>
          <span style={{ position: 'relative', height: 14, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)' }}>
            <i style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${(m.busyMs / maxBusy) * 100}%`, background: color, borderRadius: 'var(--cth-r-pill)' }} />
            <b style={{ position: 'absolute', top: -6, bottom: -6, width: 1.5, insetInlineStart: `${(work.avgMs / maxBusy) * 100}%`, background: AVG_DASH }} />
            {chip && <span style={{ position: 'absolute', insetInlineEnd: 0, top: -3 }}><WorkChipView chip={chip} /></span>}
          </span>
          <span style={{ ...mono, fontSize: 13, fontWeight: 600, opacity: quiet ? 0.7 : 1 }}>{duration(m.busyMs, t)}</span>
          <span style={{ ...mono, fontSize: 13, fontWeight: 600, textAlign: 'end' }}>{money(m.usd)}</span>
        </button></div>
      );
    };
    const busyRows = rows.filter((m) => m.busyMs > 0);
    const idleRows = rows.filter((m) => m.busyMs <= 0);
    body = (
      <>
        {gaps.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--cth-ink-2)', background: 'var(--cth-neutral-soft)', borderRadius: 'var(--cth-r-lg)', padding: '8px 11px' }}>
            <Icon name="info" /> {t('pulse.gapNotice', { days: gaps.map(fmtDay).join(', ') })}
          </div>
        )}

        {/* Before any advice: one short line, the why behind the (i) (1D). */}
        <Section title={t('pulse.recommendations')} tip={noAdvice && view.adviceFrom ? t('pulse.adviceStarts', { day: fmtDay(view.adviceFrom), since: fmtDay(view.liveSince ?? Date.now()) }) : t('pulse.recommendationsTip')}>
          {/* Before advice: what the advice rules see so far (owner, 2026-10-19),
              as insight cards under a lit header (design A): the Early look pill,
              the bold line and the countdown to advice; one card per pattern,
              never anything to apply. */}
          {noAdvice && early.length > 0 ? (
            <div style={{ ...card, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', background: 'linear-gradient(90deg, var(--cth-indigo-soft), transparent 70%)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 9px', borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-indigo-soft)', color: 'var(--cth-indigo-text)', fontSize: 11, fontWeight: 600 }}>
                  <Icon name="sparkle" size={0.75} />{t('pulse.early.pill')}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cth-ink)' }}>{t('pulse.early.title')}</span>
                <span style={{ flex: 1 }} />
                {view.adviceFrom && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap' }}>
                    {t('pulse.early.dayOf', { n: learnDay, days: ADVICE_DAYS })}
                    <span aria-hidden="true" style={{ width: 120, height: 6, borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}>
                      <i style={{ display: 'block', height: '100%', width: `${(learnDay / ADVICE_DAYS) * 100}%`, background: 'var(--cth-indigo)', borderRadius: 'var(--cth-r-pill)' }} />
                    </span>
                    {t('pulse.adviceFrom', { day: fmtDay(view.adviceFrom) })}
                  </span>
                )}
              </div>
              {/* Company foundations, under the Early look header while it shows (D3). */}
              {foundationJobs.length > 0 && <div style={{ padding: '6px 16px 4px' }}><FoundationsStrip jobs={foundationJobs} /></div>}
              <div style={{ ...grid(sugCols), padding: '4px 16px 16px' }}>
                {early.map((a) => <EarlyCard key={a.id} a={a} name={nameOf(a.agentId)} sub={a.missionId ? jobOf(a.missionId) : (byId.get(a.agentId) ? roleOf(byId.get(a.agentId)!) : '')} text={earlyText(a)} />)}
                {early.length < sugCols && (
                  <div style={{ border: '1px dashed var(--cth-line-2)', borderRadius: 'var(--cth-r-lg)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 14, fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)' }}>{t('pulse.early.more')}</div>
                )}
              </div>
            </div>
          ) : foundationJobs.length > 0 && <div style={{ ...card, padding: '12px 16px', marginBottom: 10 }}><FoundationsStrip jobs={foundationJobs} /></div>}
          {!(noAdvice && early.length > 0) && noAdvice && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)', lineHeight: '17px' }}>{view.adviceFrom ? t('pulse.adviceFrom', { day: fmtDay(view.adviceFrom) }) : t('pulse.nothingToChange')}</div>}
          {(!noAdvice || savedShown) && <div style={grid(sugCols)}>
            {applied.map((x) => (
              <div key={`a-${x.appliedId}`} style={{ background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-green) 35%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t('pulse.applied')} {x.text}</div>
                <div><PixelButton variant="secondary" size="sm" onClick={() => { void undo(x); }}>{t('pulse.undo')}</PixelButton></div>
              </div>
            ))}
            {shownAdvice.slice(0, Math.max(0, 3 - applied.length)).map((a) => {
              const txt = adviceText(a);
              return (
                <div key={a.id} style={{ background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AgentAvatar id={a.agentId} name={nameOf(a.agentId)} size={22} />
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>{txt.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cth-amber-text)', lineHeight: '17px' }}>{txt.evidence}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <PixelButton size="sm" disabled={busy === a.id} onClick={() => { void apply(a); }}>
                      {a.change.kind === 'editor' ? t('pulse.openSchedules') : t('pulse.apply')}
                    </PixelButton>
                    <PixelButton variant="secondary" size="sm" onClick={() => { void notNow(a); }}>{t('pulse.notNow')}</PixelButton>
                    {a.savesPerWeek !== null && a.savesPerWeek > 0 && (
                      <span style={{ marginInlineStart: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--cth-green-text)', background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-pill)', padding: '2px 8px' }}>
                        {t('pulse.savesAbout', { usd: money(a.savesPerWeek) })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {savedShown && <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
              <div style={label}>{t('pulse.savedByChanges')}<InfoTip text={t('pulse.savedTip')} /></div>
              {view.saved.state === 'measuring' && <><div style={{ fontSize: 22, fontWeight: 600 }}>{t('pulse.measuring')}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.firstResult', { day: fmtDay(view.saved.firstAt) })}</div></>}
              {view.saved.state === 'measured' && <><div style={{ ...mono, fontSize: 22, fontWeight: 600, color: view.saved.usd >= 0 ? 'var(--cth-green-text)' : 'var(--cth-ink)' }}>{view.saved.usd < 0 ? '−' : ''}{money(Math.abs(view.saved.usd))}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t(view.saved.usd < 0 ? 'pulse.costMore' : 'pulse.since', { day: fmtDay(view.saved.since) })}</div></>}
            </div>}
          </div>}
        </Section>

        <Section title={t('pulse.whatGotDone')}>
          <div style={grid(cols)}>
            {tilesNow.shown.map((id) => (
              <div key={id} id={`pulse-tile-${id}`} tabIndex={-1} role="group" aria-label={t(`pulse.quiet.name.${id}`)} className={fresh(id, true) ? 'cth-tile-in' : undefined} style={{ display: 'grid', borderRadius: 'var(--cth-r-xl)' }}>
                {tile[id]}
              </div>
            ))}
          </div>
          {/* Quiet chips (5A): one wrapping row, in the grid's order; a chip opens its tile. */}
          {tilesNow.quiet.length > 0 && (
            <div role="group" aria-label={t('pulse.quiet.row')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {tilesNow.quiet.map((id) => {
                const name = t(`pulse.quiet.name.${id}`);
                return (
                  <button key={id} type="button" className={`cth-quiet-chip${fresh(id, false) ? ' cth-tile-in' : ''}`}
                    aria-label={t('pulse.quiet.chipAria', { name, period: periodWord })}
                    onClick={() => { setOpened((o) => new Set(o).add(id)); setFocusTile(id); setNotice(t('pulse.quiet.opened', { name, period: periodWord })); }}>
                    <Icon name={QUIET_ICON[id]} size={0.875} />
                    <span className="cth-quiet-chip-name">{name}</span>
                    <span className="cth-quiet-chip-n">{(0).toLocaleString(i18n.language)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={t('pulse.work.title')} tip={t('pulse.work.tip')}>
          <div style={{ ...card, padding: '12px 16px 10px' }}>
            {work.totalMs <= 0
              ? <div style={{ fontSize: 13, color: 'var(--cth-ink-2)', lineHeight: '19px' }}>{t(`pulse.work.nobody.${s.period}`)}</div>
              : <div style={{ fontSize: 13, color: 'var(--cth-ink-2)', lineHeight: '19px' }}>
                {work.topTwo && <b style={{ color: 'var(--cth-ink)' }}>{t('pulse.work.headTop', { a: nameOf(work.topTwo.ids[0]), b: nameOf(work.topTwo.ids[1]), pct: pct(work.topTwo.share) })}</b>}
                {work.quiet.length > 0 && <> {t(work.quiet.length === 1 ? 'pulse.work.headQuietOne' : 'pulse.work.headQuiet', { names: listNames(work.quiet.map(nameOf)) })}</>}
                {work.costliest && <> {t('pulse.work.headCostly', { name: nameOf(work.costliest.agentId), usd: money(work.costliest.usd), time: duration(work.costliest.busyMs, t) })}</>}
              </div>}
            {rows.length > 0 && (
              <div role="list" aria-label={t('pulse.work.title')} style={{ marginTop: 6 }}>
                {(busyRows.length > 0 || quietRowsOpen) && (
                <div aria-hidden style={{ ...workGrid, height: 26 }}>
                  <span style={label}>{t('pulse.work.member')}</span>
                  <span style={label}>{t('pulse.work.time')}</span>
                  <span style={label}>{t('pulse.work.hours')}</span>
                  <span style={{ ...label, justifyContent: 'flex-end' }}>{t(costWord)}</span>
                </div>
                )}
                {busyRows.map(memberRow)}
                {/* Members with no working time fold into one row (1C). */}
                {idleRows.length > 0 && (
                  <div role="listitem">
                    <button type="button" aria-expanded={quietRowsOpen} onClick={() => setQuietRowsOpen((v) => !v)}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%', minHeight: 36, border: 'none', borderTop: busyRows.length > 0 ? '1px solid var(--cth-line)' : 'none', background: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-3)', padding: 0 }}>
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
                        style={{ transition: 'transform var(--cth-dur-fast) var(--cth-ease)', transform: quietRowsOpen ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
                      {t(busyRows.length > 0 ? (idleRows.length === 1 ? 'pulse.work.quietMoreOne' : 'pulse.work.quietMore') : (idleRows.length === 1 ? 'pulse.work.quietAllOne' : 'pulse.work.quietAll'), { n: idleRows.length })}
                    </button>
                  </div>
                )}
                {quietRowsOpen && idleRows.map(memberRow)}
              </div>
            )}
            {work.totalMs > 0 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--cth-ink-3)', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--cth-line)' }}>
                <span><span style={{ display: 'inline-block', width: 1.5, height: 12, background: AVG_DASH, marginInlineEnd: 5, verticalAlign: 'middle' }} />{t('pulse.work.average', { time: duration(work.avgMs, t) })}</span>
                <span>{t(view.plan ? 'pulse.work.planLegend' : view.billing === 'apiKey' ? 'pulse.work.valueSpent' : 'pulse.work.valueLegend')}</span>
                <span style={{ marginInlineStart: 'auto' }}>{t('pulse.work.open')}</span>
              </div>
            )}
          </div>
        </Section>
      </>
    );
  }

  // Remember what this render showed, so the next one can fade in what moved (3A).
  useEffect(() => { shownBefore.current = shownNow; });

  const notReady = view?.compareFrom ? t('pulse.compareNotReady', { period: t(`pulse.periods.${period}`), day: fmtDay(view.compareFrom) }) : t('pulse.tooFew');
  return (
    <div ref={host} role="region" aria-label={t('floorView.pulse')} style={{ flex: 1, overflow: 'auto', padding: '22px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{t('floorView.pulse')}</h1>
        <select
          aria-label={t('pulse.period')}
          value={period}
          onChange={(e) => { const v = e.target.value as Period; setPeriod(v); try { window.localStorage.setItem(LS_PERIOD, v); } catch { /* per-Mac nicety */ } }}
          className="cth-input"
          style={{ height: 30, fontSize: 12, borderRadius: 'var(--cth-r-md)' }}
        >
          {PERIODS.map((p) => <option key={p} value={p}>{t(`pulse.periods.${p}`)}</option>)}
        </select>
        {/* Compare (owner, 2026-10-16): the app's switch, reading "Compare" (D6, D7);
            not ready, it keeps the owner's position, greyed, and says why (D4). */}
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Toggle
            on={compare}
            onClick={() => { const v = !compare; setCompare(v); try { window.localStorage.setItem(LS_COMPARE, v ? '1' : '0'); } catch { /* per-Mac nicety */ } }}
            onLabel={t('pulse.compare')}
            offLabel={t('pulse.compare')}
            label={t(`pulse.compareWith.${period}`)}
            unavailable={!!view?.available && !view.compareReady}
            reason={notReady}
          />
          <InfoTip text={view?.available && !view.compareReady ? notReady : t('pulse.compareTip')} />
        </span>
        <span style={{ flex: 1 }} />
        {view?.collectingSince && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.collectingSince', { day: fmtDay(view.collectingSince) })}</span>}
      </div>
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{notice}</div>
      {body}
      {detail && view && <MemberDetail id={detail} data={view} name={nameOf(detail)} onClose={() => setDetail(null)} money={money} />}
      {checkedOpen && view && (() => {
        const k = view.keptSafe ?? keptSafe([]);
        const counts = checkedOpen === 'in'
          ? { total: k.toInternet.pass + k.toInternet.clean + k.toInternet.stop, changed: k.toInternet.clean, stopped: k.toInternet.stop, flagged: 0 }
          : { total: k.webAnswers.pass + k.webAnswers.clean, changed: k.webAnswers.clean, stopped: 0, flagged: k.webAnswers.flagged };
        return <CheckedDetail way={checkedOpen} from={view.snapshot.from} to={view.snapshot.to} period={t(`pulse.periods.${period}`)} research={nameOf('research')} counts={counts}
          heldCount={checkedOpen === 'in' ? k.heldIn : k.heldOut} onClose={() => setCheckedOpen(null)} onOpenHeld={() => { setCheckedOpen(null); setHeldOpen(true); }} />;
      })()}
      {heldOpen && view && <HeldDetail from={view.snapshot.from} to={view.snapshot.to} count={(view.keptSafe ?? keptSafe([])).held} onClose={() => setHeldOpen(false)} />}
      {learnedOpen && view && <LearnedDetail from={view.snapshot.from} to={view.snapshot.to} nameOf={nameOf} onClose={() => setLearnedOpen(false)} />}
    </div>
  );
}

/** One early pattern (design A, owner 2026-10-19): who and which job, the
 *  count large with what it is of, a bar of the two sides, and what it means.
 *  The full sentence is its spoken label; nothing here applies a change. */
function EarlyCard({ a, name, sub, text }: { a: Advice; name: string; sub: string; text: string }) {
  const { t, i18n } = useTranslation();
  const e = a.evidence;
  const n = (v: number | undefined): string => (v ?? 0).toLocaleString(i18n.language);
  const shown = a.kind === 'run-less'
    ? { big: e.nothing, of: t('pulse.early.ofRuns', { n: n(e.runs) }), cap: t('pulse.early.capNothing'), split: [e.nothing ?? 0, (e.runs ?? 0) - (e.nothing ?? 0)] as const, first: 'var(--cth-ink-4)', second: 'var(--cth-green)' }
    : a.kind === 'run-more'
    ? { big: e.didWork, of: t('pulse.early.ofRuns', { n: n(e.runs) }), cap: t('pulse.early.capWork'), split: [e.didWork ?? 0, (e.runs ?? 0) - (e.didWork ?? 0)] as const, first: 'var(--cth-green)', second: 'var(--cth-ink-4)' }
    : a.kind === 'stronger-model' && (e.reopens ?? 0) >= EARLY_REOPENS
    ? { big: e.reopens, of: '', cap: t('pulse.early.capReopened'), split: null, first: '', second: '' }
    : { big: e.kept ?? 0, of: t('pulse.early.of', { n: n(e.decisions) }), cap: t('pulse.early.capKept'), split: [e.kept ?? 0, (e.decisions ?? 0) - (e.kept ?? 0)] as const, first: 'var(--cth-green)', second: 'var(--cth-ink-4)' };
  return (
    <div role="group" aria-label={text} style={{ background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div aria-hidden style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <AgentAvatar id={a.agentId} name={name} size={28} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
          {sub && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
        </div>
      </div>
      <div aria-hidden style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 26, fontWeight: 600, lineHeight: '28px' }}>
        {n(shown.big)}{shown.of && <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 400, color: 'var(--cth-ink-3)', marginInlineStart: 6 }}>{shown.of}</span>}
      </div>
      {shown.split && (
        <div aria-hidden style={{ display: 'flex', height: 8, gap: 2, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', background: 'var(--cth-neutral-soft)' }}>
          {shown.split[0] > 0 && <i style={{ display: 'block', flex: shown.split[0], background: shown.first }} />}
          {shown.split[1] > 0 && <i style={{ display: 'block', flex: shown.split[1], background: shown.second }} />}
        </div>
      )}
      <div aria-hidden style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{shown.cap}</div>
    </div>
  );
}

/** A Kept safe tile: an icon, a number, what it counts, and its parts
 *  (proposal 3). The parts show only once one is above zero: a legend of
 *  zeros says nothing the number does not (owner, 2026-10-18). */
function StatTile({ icon, value, of, text, parts, amber, tip, trend, open }: { icon: IconName; value: number; of?: number; text: string; parts?: Array<{ n: number; name: string; color: string }>; amber?: boolean; tip?: string; trend?: ReactNode; open?: { label: string; onClick: () => void } }) {
  const { t, i18n } = useTranslation();
  const all = parts ?? [];
  const shown = all.some((p) => p.n > 0) ? all.filter((p) => p.n > 0 || all.length <= 3) : [];
  return (
    <div style={{ ...(amber ? { background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)' } : card), padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div aria-hidden style={{ width: 30, height: 30, borderRadius: 'var(--cth-r-md)', background: amber ? 'var(--cth-card)' : 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: amber ? 'var(--cth-amber-text)' : 'var(--cth-ink-2)' }}><Icon name={icon} size={1.125} /></div>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 28, fontWeight: 600, lineHeight: '30px' }}>{value.toLocaleString(i18n.language)}{of !== undefined && <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 400, color: 'var(--cth-ink-3)', marginInlineStart: 6 }}>{t('pulse.safe.of', { n: of })}</span>}</div>
      <div style={{ fontSize: 12, color: 'var(--cth-ink-2)', lineHeight: '17px' }}>{text}{tip && <> <InfoTip text={tip} /></>}</div>
      {open && <button type="button" onClick={open.onClick} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: amber ? 'var(--cth-amber-text)' : 'var(--cth-indigo-text)' }}>{open.label}</button>}
      {trend ? trend : <>
        {shown.length > 0 && shown.some((p) => p.n > 0) && <Stack parts={shown} aria={shown.map((p) => `${p.name} ${p.n}`).join(', ')} />}
        {shown.length > 0 && <Legend items={shown.map((p) => [p.name, p.color, p.n])} />}
      </>}
    </div>
  );
}

function Stack({ parts, aria }: { parts: Array<{ n: number; color: string }>; aria: string }) {
  return (
    <div role="img" aria-label={aria} style={{ display: 'flex', height: 8, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', gap: 2, background: 'var(--cth-neutral-soft)' }}>
      {parts.filter((p) => p.n > 0).map((p, i) => <i key={i} style={{ display: 'block', flex: p.n, background: p.color }} />)}
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string, number?]> }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 11, color: 'var(--cth-ink-3)' }}>
      {items.map(([name, color, n]) => (
        <span key={name} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <b style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'inline-block' }} />
          {name}{n !== undefined && <span style={{ fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-2)' }}>{n}</span>}
        </span>
      ))}
    </div>
  );
}

function TileTitle({ icon, title, sub, tip }: { icon: IconName; title: string; sub: string; tip?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <div aria-hidden style={{ width: 26, height: 26, borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: 'var(--cth-ink-2)', flex: 'none' }}><Icon name={icon} size={1} /></div>
      <div>
        <div style={label}>{title}{tip && <InfoTip text={tip} />}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{sub}</div>
      </div>
    </div>
  );
}

/** Small bars, stacked when there is more than one series, the total above
 *  each and its name below (owner, 2026-10-15). With `before`, the first bar is
 *  the span before Compare sets against this one (owner, 2026-10-16): muted,
 *  with a 1 px ink-3 outline so its edge reaches 3 to 1 (design D8). A missing
 *  value draws no bar and reads "…" (eng O2). `spoken` names each bar for
 *  screen readers, with its exact days. */
function WeekBars({ labels, series, aria, format = (v) => String(v), before = false, spoken }: { labels: string[]; series: Array<{ values: Array<number | null>; color: string }>; aria: string; format?: (v: number) => string; before?: boolean; spoken?: string[] }) {
  const totals = labels.map((_, i) => (series.some((x) => x.values[i] !== null && x.values[i] !== undefined) ? series.reduce((sum, x) => sum + (x.values[i] ?? 0), 0) : null));
  const max = Math.max(1, ...totals.filter((v): v is number => v !== null));
  const said = spoken ?? labels;
  return (
    <div role="img" aria-label={`${aria}: ${said.map((l, i) => `${l} ${totals[i] === null ? '…' : format(totals[i]!)}`).join(', ')}`} style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end' }}>
      {labels.map((l, i) => {
        const earlier = before && i === 0;
        const total = totals[i];
        return (
          <div key={`${l}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: earlier ? 'var(--cth-ink-3)' : 'var(--cth-ink-2)' }}>{total === null ? '…' : format(total)}</span>
            {total !== null && (
              <div style={{ width: '70%', maxWidth: 28, height: Math.max(2, (total / max) * 34), display: 'flex', flexDirection: 'column-reverse', borderRadius: 3, overflow: 'hidden', background: 'var(--cth-neutral-soft)', ...(earlier ? { outline: '1px solid var(--cth-ink-3)', outlineOffset: -1 } : {}) }}>
                {series.map((x, k) => <i key={k} style={{ display: 'block', flex: x.values[i] ?? 0, background: earlier && x.color === 'var(--cth-ink-2)' ? 'var(--cth-ink-4)' : x.color, opacity: earlier && x.color !== 'var(--cth-ink-2)' ? 0.45 : 1 }} />)}
              </div>
            )}
            <span style={{ fontSize: 10, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap' }}>{l}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The frame Pulse's lists share (eng Section 2, design DD5, DD15): the held
 *  list's dialog, reading, and a read that failed with Try again. */
function useListRows<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; failed: boolean; retry: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    load().then((r) => { if (live) setData(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, failed, retry: () => setTick((n) => n + 1) };
}

function ListFrame({ icon, title, count, failed, reading, onRetry, onClose, children }: { icon: IconName; title: string; count?: ReactNode; failed: boolean; reading: boolean; onRetry: () => void; onClose: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(ref, onClose);
  const backdrop = useBackdropClose(onClose);
  return (
    <div {...backdrop} style={{ position: 'fixed', inset: 0, background: 'var(--cth-backdrop)', zIndex: 300, display: 'grid', placeItems: 'start center', paddingTop: 80 }}>
      <div ref={ref} role="dialog" aria-modal aria-label={title} style={{ width: 600, maxWidth: 'calc(100% - 32px)', maxHeight: 'calc(100vh - 140px)', overflow: 'auto', ...card, borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Icon name={icon} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ marginInlineStart: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cth-ink-3)' }}><Icon name="x" /></button>
        </div>
        {failed ? (
          <div role="alert" style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>
            {t('pulse.list.failed')}{' '}
            <button type="button" onClick={onRetry} style={{ border: 'none', background: 'none', padding: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--cth-indigo-text)' }}>{t('pulse.list.retry')}</button>
          </div>
        ) : reading ? <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.held.reading')}</div> : <>{count}{children}</>}
      </div>
    </div>
  );
}

const rowBox: CSSProperties = { background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 };
const whenOf = (lang: string) => (at: number): string => new Date(at).toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const spanMs = (from: string, to: string): [number, number] => [new Date(`${from}T00:00:00`).getTime(), new Date(`${to}T23:59:59.999`).getTime()];

/** What the held tile counted, one row per held message: when, which way,
 *  who to whom, its subject and opening, why the check could not run, and who
 *  was told (owner, 2026-10-16). Read from the owner's private record. */
function HeldDetail({ from, to, count, onClose }: { from: string; to: string; count: number; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [fromMs, toMs] = spanMs(from, to);
  const { data: rows, failed, retry } = useListRows<HeldRow[]>(() => window.cth.pulseHeld(fromMs, toMs).then((r) => (Array.isArray(r) ? r : [])), [from, to]);
  const when = whenOf(i18n.language);
  // Each row in the owner's words (owner, 2026-10-16: the first list "made no
  // sense"): what was held, why in one sentence, and what happens next. The
  // check's own report sits behind an (i).
  const say = (r: HeldRow): { head: string; what: string; why: string; next: string } => {
    const research = r.way === 'in' ? r.toName ?? r.to : r.fromName ?? r.from;
    const from = r.fromName ?? r.from;
    const to = r.toName ?? r.to;
    const notes = r.to === HELD_TO_MEMORY;
    const officeOpen = r.way === 'in' && r.from === 'human' && r.subject === OFFICE_OPEN_SUBJECT;
    const kind = notes ? 'notes' : officeOpen ? 'officeOpen' : r.way === 'out' ? (r.told === 'recipient' ? 'answerToMichael' : 'answer')
      : r.from === 'human' ? 'you' : r.from === 'system' ? 'app' : r.told === 'sender' ? 'michael' : 'member';
    const head = t(`pulse.held.head.${kind}`, { research, from, to });
    // Notes show the notes themselves (an older row kept the index page, which
    // reads as no notes); the app's own reminder has nothing to read.
    const what = notes ? notesPreview(r.opening) || t('pulse.held.notesEmpty', { research })
      : officeOpen ? '' : [r.subject ? `“${r.subject}”` : '', r.opening].filter(Boolean).join(' ');
    return { head, what, why: t(`pulse.held.why.${heldCause(r)}`), next: t(`pulse.held.next.${kind}`, { research, from, to }) };
  };
  const earlier = rows ? Math.max(0, count - rows.length) : 0;
  return (
    <ListFrame icon="pause" title={t('pulse.held.title')} failed={failed} reading={!rows} onRetry={retry} onClose={onClose}>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(rows ?? []).map((r, i) => {
          const x = say(r);
          return (
            <div key={`${r.at}-${i}`} role="listitem" style={{ ...rowBox, gap: 4 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>{x.head}</span>
                <span style={{ fontSize: 11, color: 'var(--cth-ink-3)', marginInlineStart: 'auto', whiteSpace: 'nowrap' }}>{when(r.at)}</span>
              </div>
              {x.what && <div dir="auto" style={{ fontSize: 12, color: 'var(--cth-ink-2)', lineHeight: '17px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.what}</div>}
              <div style={{ fontSize: 12, color: 'var(--cth-amber-text)', lineHeight: '17px' }}>
                {x.why}{r.error && <> <InfoTip text={t('pulse.held.why.detail', { error: r.error })} /></>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--cth-ink-3)', lineHeight: '17px' }}>{x.next}</div>
            </div>
          );
        })}
        {earlier > 0 && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.held.earlier', { count: earlier })}</div>}
      </div>
    </ListFrame>
  );
}

/** The new notes Learning counted (owner, 2026-10-18), grouped as its legend,
 *  newest first: the note, then who and which day. A note deleted since says so.
 *  Read on open, by the same rule as the number. */
function LearnedDetail({ from, to, nameOf, onClose }: { from: string; to: string; nameOf: (id: string) => string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { data: rows, failed, retry } = useListRows<LearnedNote[]>(() => window.cth.pulseLearned(from, to).then((r) => (Array.isArray(r) ? r : [])), [from, to]);
  const groups: Array<[LearnedNote['from'], string, string]> = [['you', t('pulse.learning.fromYou'), 'var(--cth-green)'], ['job', t('pulse.learning.onJob'), 'var(--cth-ink-4)'], ['michael', t('pulse.learning.fromMichael'), 'var(--cth-indigo)']];
  const day = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <ListFrame icon="book" title={t('pulse.learning.learned')} failed={failed} reading={!rows} onRetry={retry} onClose={onClose}>
      {rows && rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.learning.none')}</div>}
      {groups.map(([key, label, color]) => {
        const mine = (rows ?? []).filter((r) => r.from === key);
        if (!mine.length) return null;
        return (
          <section key={key} aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />{label}<span style={{ ...mono, fontWeight: 400, color: 'var(--cth-ink-3)' }}>{mine.length}</span>
            </div>
            <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mine.map((r) => (
                <div key={`${r.agentId}-${r.id}-${r.at ?? r.day}`} role="listitem" style={{ ...rowBox, gap: 3 }}>
                  {r.text !== null
                    ? <div dir="auto" style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink)', overflowWrap: 'anywhere' }}>{r.text}</div>
                    : <div style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)' }}>{t('pulse.learning.removed')}</div>}
                  <div style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-3)' }}>{t('pulse.learning.who', { name: nameOf(r.agentId), day: day(r.day) })}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </ListFrame>
  );
}

/** The marks for one changed text (design DD1, DD6, DD7, DD13): struck words
 *  grey with a line through, the other side's words on soft green, hidden
 *  characters as a counted marker; screen readers hear which is which. */
function Marked({ parts, context }: { parts: ChangePart[]; context?: boolean }) {
  const { t } = useTranslation();
  const list: Array<ChangePart | null> = context ? changesInContext(parts) : parts;
  const show = (text: string) => withHidden(text).map((x, k) => (typeof x === 'string' ? x
    : <span key={k} style={{ fontSize: 11, color: 'var(--cth-ink-3)', background: 'var(--cth-neutral-soft)', borderRadius: 3, padding: '0 3px' }}>{t('pulse.checked.hidden', { count: x.hidden })}</span>));
  return (
    <>
      {list.map((p, k) => p === null ? <span key={k} aria-hidden>{'…'}</span>
        : p.op === 'same' ? <span key={k}>{show(p.text)}</span>
        : p.op === 'del' ? <del key={k} style={{ background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-3)', textDecorationThickness: 1, borderRadius: 3, padding: '0 2px' }}><span style={srOnly}>{t('pulse.checked.srOut')} </span>{show(p.text)}</del>
        : <ins key={k} style={{ background: 'var(--cth-green-soft)', color: 'var(--cth-green-text)', textDecoration: 'none', borderRadius: 3, padding: '0 2px' }}><span style={srOnly}>{t('pulse.checked.srIn')} </span>{show(p.text)}</ins>)}
    </>
  );
}
const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
const textStyle: CSSProperties = { fontSize: 12, color: 'var(--cth-ink-2)', lineHeight: '18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const capStyle: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--cth-ink-3)' };
const chip = (amber: boolean): CSSProperties => ({ fontSize: 11, fontWeight: 600, borderRadius: 'var(--cth-r-pill)', padding: '2px 8px', background: amber ? 'var(--cth-amber-soft)' : 'var(--cth-green-soft)', color: amber ? 'var(--cth-amber-text)' : 'var(--cth-green-text)' });
const linkBtn: CSSProperties = { alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--cth-ink-2)' };
const joinText = (x: CheckedRow['wrote']): string => [x.subject ? `“${x.subject}”` : '', x.body].filter(Boolean).join(' ');

/** The questions sent to the internet (way in) or Research's answers (way
 *  out), each as the check left it (owner, 2026-10-16; eng D1 to D5; design
 *  DD1 to DD15): changed, stopped and flagged first, the rest folded. */
function CheckedDetail({ way, from, to, period, research, counts, heldCount, onClose, onOpenHeld }: {
  way: 'in' | 'out'; from: string; to: string; period: string; research: string;
  counts: { total: number; changed: number; stopped: number; flagged: number }; heldCount: number;
  onClose: () => void; onOpenHeld: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [fromMs, toMs] = spanMs(from, to);
  const { data, failed, retry } = useListRows<CheckedList>(() => window.cth.pulseChecked(fromMs, toMs, way).then((r) => (r && Array.isArray(r.rows) ? r : { rows: [], since: null })), [from, to, way]);
  const [foldOpen, setFoldOpen] = useState(false);
  const [whole, setWhole] = useState<Set<number>>(new Set());
  const when = whenOf(i18n.language);
  const rows = data?.rows ?? [];
  // Each changed row's word comparison, once per list read, not on every
  // redraw (ship review 2026-10-17).
  const diffs = useMemo(() => new Map((data?.rows ?? []).filter((r) => r.sent).map((r) => [r, wordChanges(joinText(r.wrote), joinText(r.sent!))] as const)), [data]);
  const asWritten = (r: CheckedRow): boolean => r.outcome === 'pass' && !r.flagged;
  const top = rows.filter((r) => !asWritten(r));
  const rest = rows.filter(asWritten);
  const kindName = (id: string): string => t(`research.class.${id}.name`, { defaultValue: id });
  const head = (r: CheckedRow): string => {
    if (way === 'in') {
      const research = r.toName ?? r.to;
      const who = r.from === 'human' ? t('pulse.checked.q.who.you') : r.from === 'system' ? t('pulse.checked.q.who.app')
        : r.from === 'god' ? t('pulse.checked.q.who.michael') : t('pulse.checked.q.who.member', { from: r.fromName ?? r.from });
      // A question shown as two texts was mostly rewritten (checked lists v2).
      const rewritten = r.outcome === 'clean' && !!r.sent && !showAsMarks(diffs.get(r) ?? null);
      return t(`pulse.checked.q.head.${rewritten ? 'rewritten' : r.outcome}`, { who, research });
    }
    const research = r.fromName ?? r.from;
    const toName = ['god', 'michael', 'human'].includes(r.to) ? godNameNow() : r.toName ?? r.to;
    const k = r.outcome === 'clean' ? (r.flagged ? 'cleanFlagged' : 'clean') : r.flagged ? 'flagged' : 'pass';
    return t(`pulse.checked.a.head.${k}`, { research, to: toName });
  };
  const next = (r: CheckedRow): string => {
    if (way === 'in') {
      const from = r.fromName ?? r.from;
      const k = r.from === 'human' || r.from === 'system' ? 'owner' : r.from === 'god' ? 'michael' : 'member';
      return t(`pulse.checked.q.next.${r.outcome}.${k}`, { from, research: r.toName ?? r.to });
    }
    const toName = ['god', 'michael', 'human'].includes(r.to) ? godNameNow() : r.toName ?? r.to;
    return [r.outcome === 'clean' ? t('pulse.checked.a.next.clean', { to: toName }) : t('pulse.checked.a.next.pass', { to: toName }), r.flagged ? t('pulse.checked.a.next.flagged') : ''].filter(Boolean).join(' ');
  };
  const body = (r: CheckedRow, k: number): ReactNode => {
    if (!r.sent) return <div dir="auto" style={textStyle}>{joinText(r.wrote)}</div>;
    const parts = diffs.get(r) ?? null;
    if (!showAsMarks(parts)) {
      // Mostly rewritten, or too long to compare: the two texts (DD1).
      const sender = way === 'in' ? (r.fromName ?? (r.from === 'human' ? t('pulse.checked.q.who.you') : t('pulse.checked.q.who.app'))) : (r.fromName ?? r.from);
      const getter = way === 'in' ? (r.toName ?? r.to) : (['god', 'michael', 'human'].includes(r.to) ? godNameNow() : r.toName ?? r.to);
      return <>
        <div style={capStyle}>{t('pulse.checked.wrote', { name: sender })}</div>
        <div dir="auto" style={textStyle}>{joinText(r.wrote)}</div>
        <div style={capStyle}>{way === 'in' ? t('pulse.checked.got', { name: getter }) : t('pulse.checked.read', { name: getter })}</div>
        <div dir="auto" style={textStyle}>{joinText(r.sent)}</div>
      </>;
    }
    // A long text shows its changes with some text around them, whole on a click (DD6).
    const long = joinText(r.wrote).length > 600;
    const open = !long || whole.has(k);
    return <>
      {long && !open && <div style={capStyle}>{t('pulse.checked.removed')}</div>}
      <div dir="auto" style={textStyle}><Marked parts={parts} context={!open} /></div>
      {long && <button type="button" aria-expanded={open} onClick={() => setWhole((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} style={linkBtn}>
        {open ? t('pulse.checked.showLess') : t(way === 'in' ? 'pulse.checked.showWholeQuestion' : 'pulse.checked.showWholeAnswer', { n: joinText(r.wrote).length.toLocaleString(i18n.language) })}
      </button>}
    </>;
  };
  // Rows the count has but the list doesn't: before words were kept (DD4), or a write that failed.
  const earlier = data ? Math.max(0, counts.total - rows.length) : 0;
  const beforeKept = data !== null && (data.since === null || data.since > fromMs);
  // Which of those had a change or a stop, so the owner knows the one the
  // count names is among them (owner, 2026-10-16: "it says 1 was changed but
  // i cant see which message").
  const earlierChanged = Math.max(0, counts.changed - rows.filter((r) => r.outcome === 'clean').length);
  const earlierOther = way === 'in' ? Math.max(0, counts.stopped - rows.filter((r) => r.outcome === 'stop').length) : Math.max(0, counts.flagged - rows.filter((r) => r.flagged).length);
  const before = (): string => {
    // Nothing kept yet: from now on, never a date that reads like today's are kept.
    const first = data?.since == null ? t('pulse.checked.firstOpenNow', { count: earlier }) : t('pulse.checked.firstOpen', { date: when(data.since), count: earlier });
    const among = earlierChanged + earlierOther > 0 ? t(way === 'in' ? 'pulse.checked.q.among' : 'pulse.checked.a.among', { changed: earlierChanged, other: earlierOther }) : '';
    return [first, among].filter(Boolean).join(' ');
  };
  const count = way === 'in'
    ? t('pulse.checked.q.count', { period, count: counts.total, changed: counts.changed, stopped: counts.stopped, asWritten: Math.max(0, counts.total - counts.changed - counts.stopped) })
    : t('pulse.checked.a.count', { period, count: counts.total, cleaned: counts.changed, flagged: counts.flagged });
  return (
    <ListFrame icon={way === 'in' ? 'shield' : 'search'} title={way === 'in' ? t('pulse.checked.q.title') : t('pulse.checked.a.title', { research })} failed={failed} reading={!data} onRetry={retry} onClose={onClose}
      count={<div style={{ fontSize: 12, color: 'var(--cth-ink-2)', marginTop: -4 }}>{count} <InfoTip text={way === 'in' ? t('pulse.checked.q.marks', { research }) : t('pulse.checked.a.marks')} /></div>}>
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {top.map((r, k) => (
          <div key={`${r.at}-${k}`} role="listitem" style={rowBox}>
            <div style={{ display: 'flex', gap: '2px 10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>{head(r)}</span>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-3)', marginInlineStart: 'auto', whiteSpace: 'nowrap' }}>{when(r.at)}</span>
            </div>
            {body(r, k)}
            {r.cut && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.checked.cut')}</div>}
            {r.found && r.outcome === 'clean' && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.checked.found')}</div>}
            {(r.kinds?.length || r.flagged) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--cth-ink-3)' }}>
              {r.kinds?.length ? <>{r.outcome === 'stop' ? t('pulse.checked.needed') : t('pulse.checked.takenOut')} {r.kinds.map((id) => <span key={id} style={chip(r.outcome === 'stop')}>{kindName(id)}</span>)}</> : null}
              {r.flagged && <span style={chip(true)}>{t('pulse.safe.flagged')}</span>}
            </div>}
            <div style={{ fontSize: 12, color: 'var(--cth-ink-3)', lineHeight: '17px' }}>{next(r)}</div>
          </div>
        ))}
        {rest.length > 0 && <>
          <button type="button" aria-expanded={foldOpen} onClick={() => setFoldOpen((o) => !o)} style={{ ...linkBtn, fontWeight: 400 }}>
            {foldOpen ? '▾ ' : '▸ '}<b>{way === 'in' ? t('pulse.checked.q.fold', { count: rest.length }) : t('pulse.checked.a.fold', { count: rest.length })}</b>
          </button>
          {foldOpen && rest.map((r, k) => (
            <div key={`p-${r.at}-${k}`} role="listitem" style={{ fontSize: 12, color: 'var(--cth-ink-2)', padding: '7px 2px', boxShadow: 'inset 0 -1px 0 var(--cth-line)', display: 'flex', gap: 10 }}>
              <span dir="auto" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                <b>{way === 'in' ? (r.from === 'human' ? t('pulse.checked.q.who.you') : r.from === 'system' ? t('pulse.checked.q.who.app') : r.fromName ?? r.from) : (['god', 'michael', 'human'].includes(r.to) ? godNameNow() : r.toName ?? r.to)}:</b>{' '}
                {r.wrote.subject || r.wrote.body.split('\n')[0]}
              </span>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-3)', marginInlineStart: 'auto', whiteSpace: 'nowrap' }}>{when(r.at)}</span>
            </div>
          ))}
        </>}
        {earlier > 0 && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>
          {beforeKept ? before() : t('pulse.checked.earlier', { count: earlier })}
        </div>}
        {heldCount > 0 && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>
          {t('pulse.checked.held', { count: heldCount })}{' '}
          <button type="button" onClick={onOpenHeld} style={{ ...linkBtn, color: 'var(--cth-indigo-text)' }}>{t('pulse.checked.seeHeld')}</button>
        </div>}
      </div>
    </ListFrame>
  );
}

function WorkChipView({ chip }: { chip: WorkChip }) {
  const { t } = useTranslation();
  const base: CSSProperties = { fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--cth-r-pill)', padding: '2px 8px', whiteSpace: 'nowrap' };
  if (chip.kind === 'costly') return <span style={{ ...base, background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)' }}>{t('pulse.work.costly')}</span>;
  if (chip.kind === 'quiet') return <span style={{ ...base, background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-3)' }}>{t('pulse.work.quiet')}</span>;
  return <span style={{ ...base, background: 'var(--cth-card)', color: 'var(--cth-ink)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)' }}>{chip.kind === 'busiest' ? t('pulse.work.busiest') : t('pulse.work.times', { times: chip.times })}</span>;
}

function MemberDetail({ id, data, name, onClose, money }: { id: string; data: PulseData; name: string; onClose: () => void; money: (v: number) => string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(ref, onClose);
  const backdrop = useBackdropClose(onClose);
  const m = data.snapshot.members.find((x) => x.agentId === id);
  const trend = data.trend[id] ?? [0, 0, 0, 0];
  const max = Math.max(...trend, 0.0001);
  const fact = (lbl: string, v: string, d: string, tip?: string): ReactNode => (
    <div style={{ background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', padding: '9px 11px', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={label}>{lbl}{tip && <InfoTip text={tip} />}</div>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 15, fontWeight: 600 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{d}</div>
    </div>
  );
  return (
    <div {...backdrop} style={{ position: 'fixed', inset: 0, background: 'var(--cth-backdrop)', zIndex: 300, display: 'grid', placeItems: 'start center', paddingTop: 80 }}>
      <div ref={ref} role="dialog" aria-modal aria-label={name} style={{ width: 560, maxWidth: 'calc(100% - 32px)', ...card, borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <AgentAvatar id={id} name={name} size={30} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ marginInlineStart: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cth-ink-3)' }}><Icon name="x" /></button>
        </div>
        {m && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {fact(t(data.plan || data.billing === 'apiKey' ? 'pulse.work.cost' : 'pulse.value'), money(m.usd), t('pulse.shareOfOffice', { pct: Math.round(m.share * 100) }), t(data.plan ? 'pulse.plan.memberTip' : 'pulse.valueTip'))}
            {fact(t('pulse.perPiece'), m.costForWork.perPiece !== null ? `$${m.costForWork.perPiece.toFixed(2)}` : '…', m.costForWork.kind ? t(`pulse.per.${m.costForWork.kind}`) : t('pulse.tooFew'), t('pulse.perPieceTip'))}
            {fact(t('pulse.yourTime'), t('pulse.asksCount', { count: m.asks }), m.askWaitMs !== null ? t('pulse.waited', { time: duration(m.askWaitMs, t) }) : '', t('pulse.yourTimeTip'))}
            {fact(t('pulse.keptAsIs'), m.kept.share !== null ? `${Math.round(m.kept.share * 100)}%` : `${m.kept.kept}/${m.kept.decisions}`, t('pulse.keptLine', { kept: m.kept.kept, decisions: m.kept.decisions }), t('pulse.keptTip'))}
            {fact(t('pulse.speed'), m.speedMs !== null ? duration(m.speedMs, t) : '…', t('pulse.speedLine'), t('pulse.speedTip'))}
            {fact(t('pulse.whileAway'), m.awayShare !== null ? `${Math.round(m.awayShare * 100)}%` : '…', t('pulse.awayMine'), t('pulse.awayTip'))}
          </div>
        )}
        {(() => { const f = data.foundations?.members[id]; return f && (f.answered < f.total || f.proof) ? <FoundationsBox f={f} /> : null; })()}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>{t('pulse.fourWeeks')}</div>
          <div role="img" aria-label={trend.map((v) => money(v)).join(', ')} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 44 }}>
            {trend.map((v, i) => <div key={i} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, background: i === 3 ? 'var(--cth-ink-2)' : 'var(--cth-line-2)', borderRadius: '4px 4px 0 0' }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
