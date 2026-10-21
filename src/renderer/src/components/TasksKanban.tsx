import { askTitle, askedAgo } from './askHeadline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { InfoTip } from './InfoTip';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { AgentAvatar } from './AgentAvatar';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { useRtl } from '@/i18n/useDirection';
import { useDialog } from '@/shell/useDialog';
import { useBackdropClose } from '@/hooks/useBackdropClose';

export { openQuestion, openQuestions, waitsOnHuman, parseTasks, type HiveTask, type HumanQA } from './hiveTasks';
import { refreshNeedsYou, updateNeedsYouTasks, useNeedsYou } from '@/shell/useNeedsYou';
import { resultHeadline, waitsOnHuman, type HiveTask, type TaskStatus, nextAtLabel, filterActive, taskMatches, byNext, nextGroup, type NextGroup } from './hiveTasks';
import { FileText, useAskFileChecks } from './FileChip';
import { blockedWithNothingAsked, michaelCardState, type WorkHours } from '@shared/ownerRequests';
import { askAsText, isAnswered, isWithdrawn, readAskShape } from '@shared/askMeRouting';

type Status = TaskStatus;


// Design v2 (branding/DESIGN.md 7.20): each column's key dot and chip colors.
const COLUMNS: { key: Status; labelKey: string; accent: string; soft: string; text: string }[] = [
  { key: 'todo',    labelKey: 'kanban.colTodo',    accent: 'var(--cth-ink-4)',      soft: 'var(--cth-neutral-soft)', text: 'var(--cth-ink-2)' },
  { key: 'doing',   labelKey: 'kanban.colDoing',   accent: 'var(--cth-blue)',       soft: 'var(--cth-blue-soft)',    text: 'var(--cth-blue-text)' },
  // Held on someone outside the office or a teammate (owner, 2026-10-03: Doing
  // showed people as busy while they waited on a customer).
  { key: 'waiting', labelKey: 'kanban.colWaiting', accent: 'var(--cth-amber)',      soft: 'var(--cth-amber-soft)',   text: 'var(--cth-amber-text)' },
  { key: 'blocked', labelKey: 'kanban.colBlocked', accent: 'var(--cth-coral-base)', soft: 'var(--cth-coral-soft)',   text: 'var(--cth-coral-text)' },
  { key: 'done',    labelKey: 'kanban.colDone',    accent: 'var(--cth-green)',      soft: 'var(--cth-green-soft)',   text: 'var(--cth-green-text)' }
];
// What an empty column says. Each column has its own line instead of one
// generic "Nothing here", so an empty Blocked reads as good news and an empty
// To do points the owner at what to do next. While a search or a team member
// filter is on, an empty column means no match, not no work, so it says that.
const EMPTY_KEYS: Record<Status, string> = {
  todo: 'kanban.emptyTodo',
  doing: 'kanban.emptyDoing',
  waiting: 'kanban.emptyWaiting',
  blocked: 'kanban.emptyBlocked',
  done: 'kanban.emptyDone'
};
/** How many done cards show before "N more" (DESIGN.md 7.20). */
const DONE_SHOWN = 5;

// The office's working days and hours, from its pack, for "hasn't moved this"
// (one working day, card-lifecycle.md section 3). Read once; Mon to Fri until then.
interface OfficeTime { days: string[]; work?: WorkHours }
let officeTime: Promise<OfficeTime> | null = null;
function loadOfficeTime(): Promise<OfficeTime> {
  if (!officeTime) {
    officeTime = Promise.all([window.cth.packsList(), window.cth.getConfig()])
      .then(([res, config]) => {
        const type = (config as { businessType?: string }).businessType;
        const pack = res.packs.find((p) => p.pack.businessType === type)?.pack ?? res.core;
        return { days: pack?.officeHours?.days ?? [], work: pack?.officeHours?.work };
      })
      .catch(() => { officeTime = null; return { days: [] }; });
  }
  return officeTime;
}

/** A card's open owner request as the Tasks view shows it. */
interface WithGod { state: 'with' | 'stalled'; hours: number }


/**
 * Task kanban over hive/tasks.json — a READ surface. Reads the shared 5 s task feed; cards
 * carry just the title and open the app-wide detail overlay on click. The god
 * is the ledger's writer: new work enters via the dispatch box (mailed to the
 * god), never by the human inserting cards the orchestrator never heard about.
 */
export function TasksKanban() {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const agents = useStore((s) => s.agents);
  // The shared task read (shell/useNeedsYou.ts, eng R4): the same snapshot the
  // Needs you pill and board show, so a blocked card here always matches them.
  const { tasks, ownerRequests } = useNeedsYou();
  // A card whose owner answer Michael has not closed is his work, shown like
  // any team member's (D3): "With Michael", then "hasn't moved this" after one
  // working day. It never goes back to Ask me; the owner owes nothing.
  const [office, setOffice] = useState<OfficeTime>({ days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  useEffect(() => {
    let alive = true;
    void loadOfficeTime().then((o) => { if (alive && o.days.length) setOffice(o); });
    return () => { alive = false; };
  }, []);
  const now = Date.now();
  // A card can hold several open requests (oldest first): it is timed from
  // the oldest, the one waiting longest.
  const withGod = new Map<string, WithGod>();
  for (const r of ownerRequests) {
    if (withGod.has(r.taskId)) continue;
    withGod.set(r.taskId, {
      state: michaelCardState(r.createdAt, now, office.days, office.work),
      hours: Math.max(0, Math.floor((now - Date.parse(r.createdAt)) / 3_600_000))
    });
  }
  // Blocked with nothing asked (card-lifecycle.md section 7): waiting on nobody.
  // Michael sees the same list every turn; the owner sees it here.
  const stuck = new Set(blockedWithNothingAsked(tasks, ownerRequests).map((c) => c.id));
  // Detail view: cards show just the title — clicking one opens the full
  // breakdown as an APP-WIDE overlay over the office floor (see
  // TaskDetailOverlay) — the content grows (contracts, deps, human Q&A), so it
  // gets the big stage instead of the narrow side panel.
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const refresh = refreshNeedsYou;

  // Dismiss: the owner ends a card they no longer want worked. It closes as
  // Done by the owner's decision, never deleted (card-lifecycle.md D2), and
  // Michael is told. Main patches the named card on its latest ledger, so a
  // card added since this renderer's last poll cannot be lost.
  const dismissTask = useCallback(async (id: string) => {
    updateNeedsYouTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'done', closedBy: 'owner' } : t))); // optimistic
    try {
      const result = await window.cth.hiveCloseTask(id);
      if (!result.ok) void refresh();
    } catch { /* keep last good; the next poll re-syncs from disk */ }
  }, [refresh]);

  const restorableAgents = useStore((s) => s.restorableAgents);
  /** Resolve an assignee id to a display name — falls back to the restorable
   *  roster so a done card keeps its author's name even after that worker's
   *  terminal is gone, then to the raw id. */
  const nameFor = useCallback((id?: string): string | undefined =>
    id
      ? (id === 'god'
        ? godName
        : (agents.find((a) => a.id === id)?.name
          ?? restorableAgents.find((a) => a.id === id)?.name
          ?? id))
      : undefined, [agents, restorableAgents, godName]);

  const [showAllDone, setShowAllDone] = useState(false);
  // A render a minute, so the time groups move with the clock (Today becomes
  // Overdue, Tomorrow becomes Today); `now` above is read on each render.
  const [, setTick] = useState(0);
  useEffect(() => { const tick = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(tick); }, []);
  // Search and one team member (issue 158). While either is set every match
  // shows, Done included, and the counts are of the matches.
  const [query, setQuery] = useState('');
  const [member, setMember] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const filter = { query, assignee: member, nameFor };
  const filtering = filterActive(filter);
  const shown = filtering ? tasks.filter((x) => taskMatches(x, filter)) : tasks;
  const isFiltered = filtering || Boolean(status);
  const visibleColumns = status ? COLUMNS.filter((c) => c.key === status) : COLUMNS;
  const members = [...new Set(tasks.map((x) => x.assignee).filter((a): a is string => !!a))]
    .map((id) => ({ id, name: nameFor(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', padding: '18px 24px 0' }}>
      {/* Header (DESIGN.md 7.20): the board's counts, and why there is no add
          button: new work goes through Michael, who writes the ledger. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--cth-ink)' }}>{t('floorView.tasks')}</h1>
        <InfoTip text={t('floorView.tasksIntro')} />
        {COLUMNS.map((col) => {
          const isSelected = status === col.key;
          return (
            <button
              key={col.key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setStatus((curr) => curr === col.key ? '' : col.key)}
              title={t(col.labelKey)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999,
                background: col.key === 'blocked' || col.key === 'done' ? col.soft : 'var(--cth-card)',
                boxShadow: isSelected
                  ? `inset 0 0 0 2px ${col.accent}`
                  : (col.key === 'blocked' || col.key === 'done' ? 'none' : 'inset 0 0 0 1px var(--cth-line)'),
                fontSize: 11.5, fontWeight: isSelected ? 600 : 500, color: col.key === 'blocked' || col.key === 'done' ? col.text : 'var(--cth-ink-2)',
                border: 'none', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)'
              }}
            >
              <i style={{ width: 6, height: 6, borderRadius: 2, background: col.accent, display: 'block' }} />
              {t(col.labelKey)}
              <b style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 600 }}>{shown.filter((x) => x.status === col.key).length}</b>
            </button>
          );
        })}
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--cth-ink-3)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {t('kanban.newWorkHint', { godName })}
        </span>
      </div>

      {/* Find a card: search and one team member (issue 158). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('kanban.search')}
          aria-label={t('kanban.search')}
          className="cth-input"
          style={{
            borderRadius: 'var(--cth-r-md)', flex: '0 1 260px', minWidth: 140, height: 30, padding: '0 10px',
            background: 'var(--cth-card)', color: 'var(--cth-ink)', border: 'none', outline: 'none',
            fontFamily: 'var(--cth-font-ui)', fontSize: 12.5
          }}
        />
        <select
          value={member}
          onChange={(e) => setMember(e.target.value)}
          aria-label={t('kanban.member')}
          style={{
            borderRadius: 'var(--cth-r-md)', height: 30, padding: '0 8px', maxWidth: 220,
            background: 'var(--cth-card)', color: 'var(--cth-ink)', border: 'none',
            boxShadow: 'inset 0 0 0 1px var(--cth-line-input)', fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, cursor: 'pointer'
          }}
        >
          <option value="">{t('kanban.everyone')}</option>
          <option value="unassigned">{t('kanban.unassigned')}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {isFiltered && (
          <>
            <button type="button" onClick={() => { setQuery(''); setMember(''); setStatus(''); }} style={{
              minHeight: 28, padding: '0 8px', border: 'none', borderRadius: 'var(--cth-r-md)', background: 'transparent', cursor: 'pointer',
              fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-2)'
            }}>{t('common.clear')}</button>
            <span style={{ marginInlineStart: 'auto', fontSize: 11.5, color: 'var(--cth-ink-3)', fontFamily: 'var(--cth-font-ui)' }}>
              {t('kanban.showingFiltered', { count: (status ? shown.filter((x) => x.status === status) : shown).length, total: tasks.length })}
            </span>
          </>
        )}
      </div>

      {/* Columns */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
        {visibleColumns.map((col) => {
          const all = shown.filter((x) => x.status === col.key);
          // Done reads newest first, folded or not (it is kept in creation order).
          // A filter shows every match, so an old Done card can be found. Every
          // open column reads earliest Next first (owner, 2026-10-17).
          const cards = col.key === 'done' ? (showAllDone || filtering ? [...all].reverse() : all.slice(-DONE_SHOWN).reverse()) : byNext(all);
          return (
            <div key={col.key} style={{
              flex: status ? '0 0 360px' : '1 1 0', minWidth: 200, maxWidth: status ? 480 : undefined, display: 'flex', flexDirection: 'column', borderRadius: 'var(--cth-r-xl)',
              background: col.key === 'blocked' ? 'var(--cth-coral-soft)' : 'color-mix(in srgb, var(--cth-floor) 55%, transparent)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '12px 14px 8px', fontSize: 13, fontWeight: 600, color: col.key === 'blocked' ? col.text : 'var(--cth-ink)' }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: col.accent, display: 'block' }} />
                {t(col.labelKey)}
                <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11.5, fontWeight: 500, color: 'var(--cth-ink-3)' }}>{all.length}</span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 10px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {all.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-3)', textAlign: 'center', padding: '10px 0' }}>
                    {isFiltered ? t('kanban.noMatchingTasks') : t(EMPTY_KEYS[col.key], { godName })}
                  </div>
                )}
                {(() => { const dated = cards.some((c) => nextGroup(c.nextAt, now) !== 'none'); return cards.map((x, i) => {
                  // Open lanes are cut into time groups, each with its heading
                  // (owner, 2026-10-17); Done is not.
                  // A lane with no dated card shows no headings: a lone "No date" says nothing.
                  const group = col.key === 'done' || !dated ? null : nextGroup(x.nextAt, now);
                  const heading = group && (i === 0 || group !== nextGroup(cards[i - 1].nextAt, now))
                    ? <GroupHeading key={`g-${group}`} group={group} first={i === 0} /> : null;
                  return [heading, (
                  <TaskCard
                    key={x.id}
                    task={x}
                    accent={col.accent}
                    done={col.key === 'done'}
                    assigneeName={nameFor(x.assignee)}
                    withGod={col.key === 'done' ? undefined : withGod.get(x.id)}
                    nothingAsked={stuck.has(x.id)}
                    godName={godName}
                    onOpen={() => openTaskDetail(x.id)}
                    onDismiss={() => dismissTask(x.id)}
                  />
                  )];
                }); })()}
                {col.key === 'done' && !filtering && all.length > DONE_SHOWN && (
                  <button onClick={() => setShowAllDone((v) => !v)} style={{
                    alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, color: 'var(--cth-ink-3)'
                  }}>{showAllDone ? t('kanban.showFewer') : t('kanban.more', { count: all.length - DONE_SHOWN })}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A time group's heading in an open lane: 11.5 px 600 `ink-3`, Overdue in
 *  `coral-text` (DESIGN.md 7.20). */
function GroupHeading({ group, first }: { group: NextGroup; first: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="heading" aria-level={3} data-next-group={group} style={{
      margin: first ? '2px 2px -4px' : '6px 2px -4px', fontSize: 11.5, fontWeight: 600,
      color: group === 'overdue' ? 'var(--cth-coral-text)' : 'var(--cth-ink-3)'
    }}>{t(`kanban.group.${group}`)}</div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Deliberately minimal — a colored status edge, the task id, the title, a
// whisper of an assignee. Everything else (the full contract, deps, controls)
// lives in the detail view a click away: a kanban card can carry little more
// than a title.

function TaskCard({ task, done, assigneeName, withGod, nothingAsked, godName, onOpen, onDismiss }: {
  task: HiveTask;
  accent: string;
  done?: boolean;
  assigneeName?: string;
  withGod?: WithGod;
  nothingAsked?: boolean;
  godName: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [hover, setHover] = useState(false);
  const next = nextAtLabel(task.nextAt, i18n.language);
  return (
    <div style={{ position: 'relative', display: 'flex' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        onClick={onOpen}
        title={t('kanban.openTaskDetails')}
        style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, padding: '11px 12px',
          border: 'none', cursor: 'pointer', textAlign: 'start', borderRadius: 'var(--cth-r-lg)',
          background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)',
          fontFamily: 'var(--cth-font-ui)'
        }}
      >
        {/* The id the god writes into tasks.json: cards are referred to by id in
            dispatches and messages, so it is readable without opening the card. */}
        <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10.5, color: 'var(--cth-ink-3)', paddingInlineEnd: 22 }}>#{task.id.replace(/^#/, '')}</span>
        <span style={{
          fontSize: 12.5, fontWeight: 600, lineHeight: '17px', letterSpacing: '-0.01em', color: done ? 'var(--cth-ink-2)' : 'var(--cth-ink)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>{askTitle(task.title)}</span>
        {assigneeName && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--cth-ink-3)' }}>
            <AgentAvatar id={task.assignee} name={assigneeName} size={17} />
            {assigneeName}
          </span>
        )}
        {/* When its one off next step is due, in the owner's local time (house rule 8). */}
        {!done && next && (
          <span data-next-at style={{ fontSize: 11, fontWeight: 500, color: 'var(--cth-ink-2)' }}>{t('kanban.nextAt', { when: next })}</span>
        )}
        {/* What came of it, first line of Michael's result (issue 51); a card
            the owner closed says so below instead. */}
        {done && task.closedBy !== 'owner' && resultHeadline(task.result) && (
          <span data-result title={resultHeadline(task.result)} style={{
            fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-3)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>
            <span aria-hidden style={{ color: 'var(--cth-green-text)', fontWeight: 600, marginInlineEnd: 4 }}>✓</span>
            {resultHeadline(task.result)}
          </span>
        )}
        {task.status === 'waiting' && (
          <span data-waiting-on title={t('kanban.waitingOnTitle', { godName })} style={{
            alignSelf: 'flex-start', maxWidth: '100%', display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999,
            fontSize: 10.5, fontWeight: 600, background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{task.waitingOn ? t('kanban.waitingOn', { who: task.waitingOn }) : t('kanban.waitingOnUnknown')}</span>
        )}
        {done && task.closedBy === 'owner' && (
          <span data-closed-by="owner" title={task.closedReason || undefined} style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--cth-ink-3)' }}>
            {t('kanban.closedByOwner')}
          </span>
        )}
        {nothingAsked && (
          <span data-nothing-asked title={t('kanban.nothingAskedTitle', { godName })} style={{
            alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999,
            fontSize: 10.5, fontWeight: 600, background: 'var(--cth-amber-soft)', color: 'var(--cth-amber-text)'
          }}>{t('kanban.nothingAsked')}</span>
        )}
        {withGod && (
          <span data-with-god={withGod.state} title={t('kanban.withGodTitle', { godName })} style={{
            alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', borderRadius: 999,
            fontSize: 10.5, fontWeight: 600,
            background: withGod.state === 'stalled' ? 'var(--cth-amber-soft)' : 'var(--cth-blue-soft)',
            color: withGod.state === 'stalled' ? 'var(--cth-amber-text)' : 'var(--cth-blue-text)'
          }}>
            {withGod.state === 'stalled'
              ? t('kanban.godStalled', { godName })
              : t('kanban.withGod', { godName, age: withGod.hours < 1 ? t('kanban.ageUnderHour') : withGod.hours < 48 ? t('kanban.ageHours', { count: withGod.hours }) : t('kanban.ageDays', { count: Math.floor(withGod.hours / 24) }) })}
          </span>
        )}
      </button>
      {waitsOnHuman(task) && (
        <span title={t('kanban.needsYouTitle')} style={{
          position: 'absolute', top: 9, insetInlineEnd: 10, width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)', fontSize: 11, fontWeight: 700, pointerEvents: 'none'
        }}>?</span>
      )}
      {done && !waitsOnHuman(task) && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 10, insetInlineEnd: 11, color: 'var(--cth-green)', pointerEvents: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </span>
      )}
      {/* Dismiss: a sibling button (not nested) so it never opens the card. */}
      {hover && !waitsOnHuman(task) && !done && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          title={t('kanban.dismissTitle', { godName })}
          aria-label={t('kanban.dismissAria')}
          style={{
            position: 'absolute', top: 7, insetInlineEnd: 7, width: 20, height: 20, padding: 0, borderRadius: 6,
            display: 'grid', placeItems: 'center', border: 'none', cursor: 'pointer', background: 'var(--cth-neutral-soft)',
            color: 'var(--cth-ink-3)', fontSize: 11
          }}
        >✕</button>
      )}
    </div>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────────
// The full breakdown of one task: status, assignee, priority, the complete
// description (the god writes 4-part dispatch contracts in there — preserved
// line by line), dependencies resolved to their titles, the human Q&A trail,
// and the move/assign controls that used to crowd every card. Rendered as an
// APP-WIDE overlay (over the office floor) — this content grows, so it gets
// the big stage instead of the narrow side panel. Exported for App's
// TaskDetailOverlay; opened via the store's openTaskDetail from anywhere.

export function TaskDetail({ task, all, assigneeName, onMove, onReopen, onAssign, onClose }: {
  task: HiveTask;
  all: HiveTask[];
  assigneeName?: string;
  onMove: (s: Status) => void;
  /** Out of Done, into To do, with the owner's reason (card-lifecycle.md 10). */
  onReopen: (reason: string) => void;
  onAssign: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [reopening, setReopening] = useState(false);
  const [why, setWhy] = useState('');
  const next = nextAtLabel(task.nextAt, i18n.language);
  const rtl = useRtl();
  const detailGodName = useResolvedGodName();
  // Every file the Q&A trail names, checked in one go rather than per question.
  const qaAssignee = typeof task.assignee === 'string' ? task.assignee : undefined;
  // Each question as the card shows it, options and parts included, so a file
  // named in an option gets its chip checked too (ask-me-options.md).
  const qaShown = useMemo(() => task.humanQA?.map((e) => ({ ...e, q: askAsText(e.q, readAskShape(e)) })), [task.humanQA]);
  const qaFiles = useAskFileChecks(qaShown, qaAssignee);
  const col = COLUMNS.find((c) => c.key === task.status) ?? COLUMNS[0];
  // Belt + suspenders: parseTasks normalizes these, but the ledger is a
  // hand-written file — never trust a card's shape at the point of use.
  const deps = (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is HiveTask => !!t);
  const created = new Date(task.createdAt);
  // The shared dialog behavior (DESIGN.md 7.21, 7.23, 12): Esc closes it but
  // never from a field such as the status select, focus stays inside and
  // goes back where it was; the backdrop closes on a full click.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialog(dialogRef, onClose);
  const backdrop = useBackdropClose(onClose);
  const label = (text: string) => (
    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--cth-ink-3)', marginBottom: 5 }}>{text}</div>
  );
  return (
    <div
      {...backdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 280,
        background: 'color-mix(in srgb, var(--cth-bg) 60%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
      }}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={askTitle(task.title)} style={{
        width: 560, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)'
      }}>
        {/* Header: the id and close on one row, the title under them at full
            width (owner, 2026-10-01: side by side, a long id squeezed the title). */}
        <div style={{ padding: '16px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span title={task.id} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 6, background: 'var(--cth-neutral-soft)', fontFamily: 'var(--cth-font-mono)', fontSize: 11.5, fontWeight: 600, color: 'var(--cth-ink-2)' }}>#{task.id.replace(/^#/, '')}</span>
          <button onClick={onClose} aria-label={t('common.close')} style={{ marginInlineStart: 'auto', flexShrink: 0, width: 30, height: 30, borderRadius: 'var(--cth-r-md)', border: 'none', cursor: 'pointer', background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', color: 'var(--cth-ink-2)', display: 'grid', placeItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 16, fontWeight: 600, lineHeight: '22px', letterSpacing: '-0.02em', color: 'var(--cth-ink)' }}>{askTitle(task.title)}</div>
        </div>
        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflowY: 'auto', borderTop: '1px solid var(--cth-line)' }}>
          {/* Facts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', justifyContent: 'space-between', gap: 12, paddingTop: 14 }}>
            <div>{label(t('kanban.status'))}
              <select value={task.status} onChange={(e) => {
                const next = e.target.value as Status;
                // A Done card leaves Done only into To do, with a reason.
                if (task.status === 'done' && next !== 'done') { setReopening(true); return; }
                onMove(next);
              }} style={{
                height: 30, padding: '0 8px', borderRadius: 'var(--cth-r-md)', border: 'none', cursor: 'pointer',
                background: col.soft, color: col.text, boxShadow: 'inset 0 0 0 1px var(--cth-line-input)',
                fontFamily: 'var(--cth-font-ui)', fontSize: 12.5, fontWeight: 600
              }}>
                {/* Blocked means a question waits on Ask me, and Waiting names who the
                    card waits on, so only Michael sets them; a card in one shows it as
                    its current state (ship 2026-10-03). */}
                {COLUMNS.filter((c) => ((c.key !== 'blocked' && c.key !== 'waiting') || task.status === c.key) && !(task.status === 'done' && c.key === 'doing')).map((c) => (
                  <option key={c.key} value={c.key} disabled={c.key === 'blocked' || c.key === 'waiting'}>{t(c.labelKey)}</option>
                ))}
              </select>
              {task.status === 'waiting' && (
                <div data-waiting-on style={{ marginTop: 4, fontSize: 11, color: 'var(--cth-amber-text)' }}>
                  {task.waitingOn ? t('kanban.waitingOn', { who: task.waitingOn }) : t('kanban.waitingOnUnknown')}
                  <InfoTip text={t('kanban.waitingOnTitle', { godName: detailGodName })} />
                </div>
              )}
              {task.status === 'done' && task.closedBy === 'owner' && (
                <div data-closed-by="owner" style={{ marginTop: 4, fontSize: 11, color: 'var(--cth-ink-3)' }}>
                  {t('kanban.closedByOwner')}{task.closedReason ? <InfoTip text={task.closedReason} /> : null}
                </div>
              )}
            </div>
            <div>{label(t('kanban.assignee'))}
              {assigneeName
                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px 0 4px', borderRadius: 999, background: 'var(--cth-neutral-soft)', fontSize: 12.5, fontWeight: 600, color: 'var(--cth-ink-2)' }}>
                    <AgentAvatar id={task.assignee} name={assigneeName} size={22} />
                    {assigneeName}
                  </span>
                : <span style={{ fontSize: 12.5, color: 'var(--cth-ink-3)' }}>{t('kanban.unassigned')}</span>}
            </div>
            <div>{label(t('kanban.priorityLabel'))}<PriorityDots level={Math.max(1, Math.min(5, task.priority))} /></div>
            <div>{label(t('kanban.created'))}
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-2)' }}>
                {isNaN(created.getTime()) ? '' : created.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          </div>

          {/* What came of a Done card, in Michael's words, first (issue 51):
              never checked or invented, and nothing when he wrote none. */}
          {task.status === 'done' && task.result && (
            <div data-result>{label(t('kanban.result'))}
              <div dir={rtl ? 'auto' : undefined} style={{
                padding: '10px 12px', borderRadius: 'var(--cth-r-lg)', background: 'var(--cth-green-soft)',
                boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-green) 30%, transparent)',
                fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)'
              }}>
                <FileText source={task.result} who={{ assignee: qaAssignee }} />
              </div>
            </div>
          )}

          {/* Out of Done only into To do, with a reason (card-lifecycle.md 10): its own
              row, so the four facts above keep their place. */}
          {task.status === 'done' && reopening && (
            <div data-reopen style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea className="cth-input" autoFocus rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t('kanban.reopenWhy')} aria-label={t('kanban.reopenWhy')} style={{
                resize: 'vertical', padding: '6px 8px', border: 'none', outline: 'none',
                background: 'var(--cth-card)', color: 'var(--cth-ink)', fontFamily: 'var(--cth-font-ui)', fontSize: 12.5
              }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <PixelButton variant="primary" size="sm" disabled={!why.trim()} onClick={() => { onReopen(why.trim()); setReopening(false); setWhy(''); }}>{t('kanban.reopen')}</PixelButton>
                <PixelButton variant="secondary" size="sm" onClick={() => { setReopening(false); setWhy(''); }}>{t('common.cancel')}</PixelButton>
              </div>
            </div>
          )}

          {/* What the card is for, when a request gave it one. No running notes:
              an agent's activity lives in its conversation and the office log
              (owner, 2026-10-11). */}
          {task.description?.trim() && (
            <div>{label(t('kanban.description'))}
              <div style={{ fontSize: 12.5, lineHeight: '19px', color: 'var(--cth-ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dir={rtl ? 'auto' : undefined}>
                {task.description.trim()}
              </div>
            </div>
          )}
          {task.status !== 'done' && next && (
            <div data-next-at style={{ fontSize: 12.5, color: 'var(--cth-ink)' }}>{t('kanban.nextAt', { when: next })}</div>
          )}

          {/* The owner Q&A trail: every decision documented on the card, newest
              first like Ask me (owner, 2026-10-12), each with when it was asked.
              The key stays the entry's place in the ledger, so a new ask does not
              shift the others. Agents write tasks.json, so check the time's type. */}
          {(task.humanQA?.length ?? 0) > 0 && (
            <div>{label(t('kanban.humanQA'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {task.humanQA!.map((e, i) => [e, i] as const).reverse().map(([e, i]) => {
                  const open = !isAnswered(e) && !isWithdrawn(e);
                  const ago = askedAgo(typeof e.askedAt === 'string' ? e.askedAt : undefined, Date.now(), i18n.language, t('askMe.justNow'));
                  return (
                    <div key={i} style={{
                      padding: '10px 12px', borderRadius: 'var(--cth-r-lg)',
                      background: open ? 'var(--cth-coral-soft)' : 'var(--cth-card-2)',
                      boxShadow: `inset 0 0 0 1px ${open ? 'color-mix(in srgb, var(--cth-coral-base) 30%, transparent)' : 'var(--cth-line)'}`,
                      fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{t('kanban.question')}</span>
                        {ago && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{ago}</span>}
                        {open && <span style={{ marginInlineStart: 'auto', padding: '1px 8px', borderRadius: 999, background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)', fontSize: 10.5, fontWeight: 600 }}>{t('kanban.awaitingAnswer')}</span>}
                      </div>
                      {/* With its options or questions, which no longer sit in the text (ask-me-options.md). */}
                      <FileText source={qaShown?.[i]?.q ?? e.q} who={{ raisedBy: e.raisedBy, assignee: qaAssignee }} checks={qaFiles[e.raisedBy ?? ''] ?? {}} />
                      {isAnswered(e) ? (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--cth-line)' }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--cth-green-text)', marginBottom: 2 }}>{t('kanban.answer')}</div>
                          <MarkdownPreview source={e.a ?? ''} variant="card" />
                        </div>
                      ) : isWithdrawn(e) ? (
                        // Closing the card withdrew it: said in the owner's language. Michael's
                        // own reason is his text, isolated so its direction cannot reorder the line.
                        <div dir={rtl ? 'auto' : undefined} style={{ marginTop: 6, fontSize: 12, color: 'var(--cth-ink-3)' }}>
                          {e.dismissedBy === 'card-closed'
                            ? t('kanban.askWithdrawnCardClosed')
                            : e.dismissedBy === 'member-deleted'
                            ? t('kanban.askWithdrawnMemberDeleted')
                            : e.dismissedReason?.trim()
                              ? t('kanban.askWithdrawnBecause', { reason: `\u2068${e.dismissedReason.trim()}\u2069` })
                              : t('kanban.askWithdrawn')}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dependencies, resolved to titles */}
          {deps.length > 0 && (
            <div>{label(t('kanban.dependsOn'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {deps.map((d) => {
                  const dc = COLUMNS.find((c) => c.key === d.status) ?? COLUMNS[0];
                  return (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--cth-r-md)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', fontSize: 12.5, color: 'var(--cth-ink-2)' }}>
                      <i style={{ width: 7, height: 7, borderRadius: 2, background: dc.accent, display: 'block', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-3)' }}>#{d.id.replace(/^#/, '')}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--cth-ink)' }}>{d.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        {/* Footer: hand it to Michael, or close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--cth-line)' }}>
          <PixelButton variant="secondary" size="md" onClick={onAssign}>{t('kanban.assign')}</PixelButton>
          <span style={{ fontSize: 11.5, color: 'var(--cth-ink-3)' }}>{t('kanban.assignHint', { godName: detailGodName })}</span>
          <span style={{ flex: 1 }} />
          <PixelButton variant="secondary" size="md" onClick={onClose}>
            {t('common.close')}
            <kbd style={{ marginInlineStart: 4, padding: '0 5px', borderRadius: 4, boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-3)' }}>Esc</kbd>
          </PixelButton>
        </div>
      </div>
    </div>
  );
}

function PriorityDots({ level }: { level: number }) {
  const { t } = useTranslation();
  // 1 = lowest, 5 = highest (DESIGN.md 7.21): five dots, filled in ink.
  return (
    <span title={t('kanban.priority', { level })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 30 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: i <= level ? 'var(--cth-ink)' : 'var(--cth-line-2)' }} />
      ))}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', outline: 'none', boxSizing: 'border-box'
};

const selectStyle: React.CSSProperties = {
  padding: '3px 6px', background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-ui)',
  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 10, fontWeight: 600, color: 'var(--cth-ink-500)'
};
