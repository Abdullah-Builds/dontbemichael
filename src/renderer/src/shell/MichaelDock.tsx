import i18n from '@/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ownerWorkOrder, type DockItem, type DockQuestion, type DockReply, type OwnerDock, type OwnerQuestionStatus } from '@shared/ownerRequests';
import { useStore } from '@/store/store';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';
import { AgentAvatar } from '@/components/AgentAvatar';
import { InfoTip } from '@/components/InfoTip';
import { FileText } from '@/components/FileChip';
import { Icon } from '@/components/Icon';
import { dockKeys } from './dockKeys';
import { replyTargets } from './replyTargets';
import { WideButton } from './PanelChrome';
import { dockEscAction } from './wideCenter';
import { isComposingKey } from '@shared/imeGuard';
import { useDockScroll, type DockPlace } from './useDockScroll';

/**
 * Michael's conversation dock (docs/designs/michael-replies.md): it grows up
 * out of the "Talk to Michael" composer and holds only the owner's own
 * questions and Michael's replies to them. Each question carries one live
 * status line; Michael's bubbles carry only his words. It opens only on the
 * owner's action (send, the count, a notification, or focusing the composer
 * with replies unread), never by itself.
 */

const EMPTY: OwnerDock = { items: [], open: 0, unread: 0, waitingForYou: 0 };
const POLL_MS = 4000;
/** While the dock is closed or the window hidden: main's change event does the rest. */
const IDLE_POLL_MS = 60_000;
/** A Sent question not in Michael's queue after this long was never queued. */
const ORPHAN_AFTER_MS = 2 * 60_000;
/** Answered exchanges older than this fold under "Earlier" (22A). */
const RECENT_MS = 30 * 24 * 3_600_000;

/** The conversation, live: read on mount and on every change main announces;
 *  polled every few seconds only while the dock is open and the window shown
 *  (time based states such as Later than he said), else once a minute. */
export function useOwnerDock(active: boolean): { dock: OwnerDock; refresh: () => void } {
  const [dock, setDock] = useState<OwnerDock>(EMPTY);
  const reads = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++reads.current;
    void window.cth.ownerConversation?.()
      .then((d) => { if (mine === reads.current && d && Array.isArray(d.items)) setDock(d); })
      .catch(() => { /* keep the last value */ });
  }, []);
  useEffect(() => {
    refresh();
    const tick = (): void => { if (!document.hidden) refresh(); };
    const iv = setInterval(tick, active ? POLL_MS : IDLE_POLL_MS);
    const off = window.cth.onOwnerChanged?.(refresh);
    const onShow = (): void => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(iv); off?.(); document.removeEventListener('visibilitychange', onShow); };
  }, [refresh, active]);
  return { dock, refresh };
}

const STATUS_COLOR: Record<OwnerQuestionStatus, string> = {
  sent: 'var(--cth-ink-3)', 'has-it': 'var(--cth-blue-text)', waiting: 'var(--cth-ink-3)', late: 'var(--cth-amber-text)',
  'waiting-for-you': 'var(--cth-coral-text)', answered: 'var(--cth-green-text)', 'couldnt-finish': 'var(--cth-ink-2)',
  withdrawn: 'var(--cth-ink-3)', 'not-sent': 'var(--cth-ink-2)'
};

// Times and days in the app's language, not the system's.
const timeOf = (iso: string | number): string => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' });

function dayLabel(iso: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return t('dock.today');
  if (diff === 1) return t('dock.yesterday');
  return d.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** What the owner opened and where they were reading, kept by the composer
 *  so they survive the move between the bar and the center (eng review R1). */
export interface DockView {
  expanded: Record<string, true>;
  setExpanded: (f: (e: Record<string, true>) => Record<string, true>) => void;
  showEarlier: boolean;
  setShowEarlier: (on: boolean) => void;
  /** Where the list was last read (none while following the latest); the next mount opens on it. */
  anchor: React.MutableRefObject<DockPlace | null>;
}

export function MichaelDock({ dock, refresh, godId, onFillComposer, onReply, composerRef, wide = false, view }: {
  dock: OwnerDock;
  refresh: () => void;
  godId: string;
  onFillComposer: (text: string) => void;
  /** Answer Michael's question back (16A): the composer replies in that conversation. */
  onReply: (target: { inReplyTo: string; conversation: string; text: string }) => void;
  composerRef: React.RefObject<HTMLElement | null>;
  /** Drawn wide in the center with the message box under it (wide 1:1). */
  wide?: boolean;
  view: DockView;
}) {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const open = useStore((s) => s.dockOpen);
  const focus = useStore((s) => s.dockFocus);
  const navigation = useStore((s) => s.dockNavigation);
  const setDock = useStore((s) => s.setDock);
  const setDockWide = useStore((s) => s.setDockWide);
  const queue = useStore((s) => s.messageQueues[godId]);
  const draft = useStore((s) => s.drafts[godId] ?? '');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const { expanded, setExpanded, showEarlier, setShowEarlier, anchor } = view;
  const [announce, setAnnounce] = useState('');
  const prevStatus = useRef<Record<string, OwnerQuestionStatus>>({});
  const items = useMemo(() => visibleItems(dock.items, showEarlier), [dock.items, showEarlier]);
  // Keyed over the whole conversation, so "Earlier" never shifts which reply is open.
  const keyOf = useMemo(() => {
    const keys = dockKeys(dock.items);
    return new Map(dock.items.map((it, i) => [it, keys[i]]));
  }, [dock.items]);
  const rowOf = (it: DockItem) => ({ key: keyOf.get(it) ?? `${it.kind}:${it.id}`, kind: it.kind, notes: it.kind === 'michael' && !!it.notes });
  const rows = useMemo(() => items.map(rowOf), [items, keyOf]);
  const history = useMemo(() => dock.items.map(rowOf), [dock.items, keyOf]);
  const scroll = useDockScroll(listRef, contentRef, open, navigation, focus, rows, history, anchor);

  // A notification can name a question hidden by the 30 day view. Reveal it
  // before the scroll hook consumes its pending target.
  useLayoutEffect(() => {
    if (open && focus && !items.some((it) => it.id === focus) && dock.items.some((it) => it.id === focus)) setShowEarlier(true);
  }, [open, navigation, focus, items, dock.items, setShowEarlier]);

  // Tell main whether the dock is on screen, so a reply in view needs no notification.
  useEffect(() => {
    void window.cth.ownerDockVisible?.(open);
    return () => { void window.cth.ownerDockVisible?.(false); };
  }, [open]);

  // Replies seen in the open dock are read (2A); nothing is reported to Michael.
  useEffect(() => {
    if (!open || !document.hasFocus()) return;
    const ids = dock.items.filter((i): i is DockQuestion => i.kind === 'owner' && i.unread).map((i) => i.id);
    if (ids.length) void window.cth.ownerRead?.(ids).then(refresh);
  }, [open, dock, refresh]);

  // One polite announcement for news only: answered, couldn't finish, waiting for you (20A).
  useEffect(() => {
    if (scroll.show) setAnnounce('');
    for (const it of dock.items) {
      if (it.kind !== 'owner') continue;
      const was = prevStatus.current[it.id];
      if (was && was !== it.status && (it.status === 'answered' || it.status === 'couldnt-finish' || it.status === 'waiting-for-you')) {
        const reply = [...dock.items].reverse().find((r): r is DockReply => r.kind === 'michael' && r.replyTo === it.id && !r.notes);
        if (!scroll.show) setAnnounce(reply ? firstSentence(reply.text) : t(`dock.status.${it.status}`));
      }
      prevStatus.current[it.id] = it.status;
    }
  }, [dock, t, scroll.show]);

  // Closes on Esc with focus inside, or a click on the office floor while the
  // composer is empty (21A). Selecting a person or opening Needs you keeps it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || rootRef.current?.contains(target) || composerRef.current?.contains(target)) return;
      if (draft.trim()) return;
      if (!target.closest('.cth-studio') || target.closest('button, a, [role="button"], [tabindex]')) return;
      setDock(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, draft, setDock, composerRef]);

  const canReply = useMemo(() => replyTargets(dock.items), [dock.items]);
  const hasEarlier = items.length < dock.items.length;
  const queued = queue ?? [];
  // Position in Michael's queue: -1 once typed, 0 when next, N with N ahead.
  const ahead = (id: string): number => queued.findIndex((m) => m.ownerRequestId === id);
  // A question recorded but never queued (the app stopped between the two)
  // reads Not sent, with Try again, instead of Sent forever (Codex P2).
  const orphaned = useRef(new Set<string>());
  useEffect(() => {
    const now = Date.now();
    for (const it of dock.items) {
      if (it.kind !== 'owner' || it.status !== 'sent' || orphaned.current.has(it.id)) continue;
      if (queued.some((m) => m.ownerRequestId === it.id) || now - Date.parse(it.at) < ORPHAN_AFTER_MS) continue;
      orphaned.current.add(it.id);
      void window.cth.ownerNotSent(it.id).then(refresh).catch(() => {});
    }
  }, [dock, queued, refresh]);

  if (!open) return null;

  const close = () => { setDock(false); composerRef.current?.querySelector('textarea')?.focus(); };
  const cancel = async (q: DockQuestion) => {
    // Out of the queue first, so the drain can't type it while the withdraw is
    // on its way; put back if the withdraw did not take.
    const m = queued.find((x) => x.ownerRequestId === q.id);
    if (m) useStore.getState().removeQueuedMessage(godId, m.id);
    const res = await window.cth.ownerWithdraw(q.id).catch(() => ({ ok: false }));
    if (!res.ok && m) useStore.getState().enqueueMessage(godId, m.text, { instruction: m.instruction, ownerRequestId: q.id });
    refresh();
  };
  const retry = async (q: DockQuestion) => {
    const res = await window.cth.ownerRetry(q.id).catch(() => ({ ok: false }));
    if (res.ok) useStore.getState().enqueueMessage(godId, q.text, { instruction: ownerWorkOrder(q.id, q.text), ownerRequestId: q.id });
    refresh();
  };

  let lastDay = '';
  let prevQuestion: string | undefined;
  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={t('dock.label', { godName })}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Wide, Esc goes back to the side for now (6B, 7A); at the side it closes.
        const action = dockEscAction({ wide, inDock: true, composing: isComposingKey(e) });
        if (action === 'none') return;
        e.stopPropagation();
        if (action === 'side') useStore.getState().setDockSideForNow(true);
        else close();
      }}
      className={wide ? 'cth-dock-wide' : 'cth-dock'}
      style={wide ? dockWideStyle : dockStyle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', boxShadow: '0 1px 0 var(--cth-line)' }}>
        <AgentAvatar id={godId} name={godName} size={26} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink)' }}>{godName}</span>
        {dock.open > 0 && <span style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('dock.open', { count: dock.open })}</span>}
        <InfoTip text={t('dock.openInfo', { godName })} />
        {/* Open wide / Back to the side, the panels' button (3A); only it
            changes the remembered choice (7A). */}
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex' }}>
          <WideButton on={wide} onToggle={() => setDockWide(!wide)} />
        </span>
        <button onClick={close} aria-label={t('dock.close')} title={t('dock.close')} style={{ ...quietBtn, fontSize: 14, width: 32, height: 32, display: 'grid', placeItems: 'center', padding: 0 }}>✕</button>
      </div>
      <div ref={listRef} onScroll={scroll.onScroll} style={{
        flex: 1, minHeight: 0, overflowY: 'auto', overflowAnchor: 'none', scrollBehavior: 'auto',
        // Wide, the text is at most 720 px across, centered (wide panel WD8).
        padding: wide ? '18px max(16px, calc((100% - 720px) / 2))' : '12px 13px'
      }}>
        <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', gap: wide ? 14 : 10 }}>
        {dock.items.length === 0 && (
          <div style={{ padding: '14px 4px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <AgentAvatar id={godId} name={godName} size={26} />
            <div style={{ fontSize: 13, lineHeight: '19px', color: 'var(--cth-ink-2)', whiteSpace: 'pre-line' }}>{t('dock.empty')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {(['dock.example1', 'dock.example2'] as const).map((k) => (
                <button key={k} onClick={() => onFillComposer(t(k))} style={chipBtn}>{t(k)}</button>
              ))}
            </div>
          </div>
        )}
        {hasEarlier && (
          <button onClick={() => setShowEarlier(true)} style={{ ...quietBtn, alignSelf: 'center' }}>{t('dock.earlier')}</button>
        )}
        {items.map((it) => {
          const key = keyOf.get(it) ?? `${it.kind}:${it.id}`;
          const day = dayLabel(it.at, t);
          const divider = day !== lastDay ? <div key={`d-${key}`} style={{ textAlign: 'center', fontSize: 11, color: 'var(--cth-ink-3)' }}>{day}</div> : null;
          lastDay = day;
          if (it.kind === 'owner') {
            prevQuestion = it.id;
            return [divider, <OwnerBubble key={key} dataKey={key} q={it} wide={wide} ahead={ahead(it.id)} onCancel={() => void cancel(it)} onRetry={() => void retry(it)}
              onNudge={() => void window.cth.ownerNudge(it.id).then(refresh)} onAskAgain={() => onFillComposer(it.text)} />];
          }
          const quote = prevQuestion !== it.replyTo ? dock.items.find((q): q is DockQuestion => q.kind === 'owner' && q.id === it.replyTo) : undefined;
          prevQuestion = it.replyTo;
          const question = dock.items.find((q): q is DockQuestion => q.kind === 'owner' && q.id === it.replyTo);
          return [divider, <ReplyBubble key={key} dataKey={key} r={it} wide={wide} godId={godId} godName={godName} quote={quote}
            expanded={!!expanded[key]} onMore={() => { scroll.pauseForExpansion(); setExpanded((e) => ({ ...e, [key]: true })); }}
            onQuote={() => scroll.showQuestion(it.replyTo)}
            canReply={canReply.has(it)}
            onReply={() => question && onReply({ inReplyTo: it.id, conversation: question.conversation, text: firstSentence(it.text) })} />];
        })}
        </div>
      </div>
      <div style={{ flexShrink: 0, height: 'var(--cth-space-7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {scroll.show && <button type="button" data-dock-jump style={jumpBtn} onClick={(e) => {
          // The button unmounts once caught up. Return its focus to the composer, as close() does.
          const focused = document.activeElement === e.currentTarget;
          scroll.jumpToLatest();
          if (focused) composerRef.current?.querySelector('textarea')?.focus();
        }}>
          {scroll.replies ? t('dock.newReplies', { count: scroll.replies }) : t('dock.jumpToLatest')}
          <Icon name="arrow-right" style={{ transform: 'rotate(90deg)' }} />
        </button>}
      </div>
      <div aria-live="polite" aria-atomic="true" style={srOnly}>{scroll.show ? (scroll.replies ? t('dock.newReplies', { count: scroll.replies }) : t('dock.jumpToLatest')) : announce}</div>
    </div>
  );
}

function firstSentence(text: string): string {
  const one = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(one);
  return (m ? m[1] : one).slice(0, 160);
}

/** Open questions always; answered exchanges from the last 30 days unless "Earlier" (22A). */
function visibleItems(items: DockItem[], all: boolean): DockItem[] {
  if (all) return items;
  const cutoff = Date.now() - RECENT_MS;
  const keep = new Set<string>();
  for (const it of items) {
    if (it.kind !== 'owner') continue;
    const done = it.status === 'answered' || it.status === 'couldnt-finish' || it.status === 'withdrawn';
    if (!done || Date.parse(it.at) >= cutoff) keep.add(it.id);
  }
  return items.filter((it) => keep.has(it.kind === 'owner' ? it.id : it.replyTo));
}

function OwnerBubble({ dataKey, q, wide, ahead, onCancel, onRetry, onNudge, onAskAgain }: {
  dataKey: string; q: DockQuestion; wide: boolean; ahead: number; onCancel: () => void; onRetry: () => void; onNudge: () => void; onAskAgain: () => void;
}) {
  const { t } = useTranslation();
  const godName = useResolvedGodName();
  const label = statusWords(q, ahead, godName, t);
  return (
    <div data-q={q.id} data-k={dataKey} style={{ alignSelf: 'flex-end', maxWidth: wide ? 'min(84%, 560px)' : '84%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <div dir="auto" style={{
        background: 'var(--cth-neutral-soft)', borderRadius: 'var(--cth-r-lg)', borderEndEndRadius: 4,
        // Wide reads at t-read 14 / 22 (5A).
        padding: wide ? '9px 13px' : '8px 11px', fontSize: wide ? 14 : 12.5, lineHeight: wide ? '22px' : '18px', color: 'var(--cth-ink)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        opacity: q.status === 'withdrawn' ? 0.6 : 1
      }}>{q.text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: STATUS_COLOR[q.status], fontWeight: q.status === 'waiting-for-you' ? 600 : 400 }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        {label}
        {q.status === 'late' && <button onClick={onNudge} style={linkBtn}>{t('dock.nudge')}</button>}
        {q.status === 'couldnt-finish' && <button onClick={onAskAgain} style={linkBtn}>{t('dock.askAgain')}</button>}
        {q.status === 'not-sent' && <button onClick={onRetry} style={linkBtn}>{t('dock.tryAgain')}</button>}
        {q.status === 'sent' && ahead >= 0 && <button onClick={onCancel} style={linkBtn}>{t('dock.cancel')}</button>}
      </div>
    </div>
  );
}

function statusWords(q: DockQuestion, ahead: number, godName: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const time = q.dueAt ? timeOf(q.dueAt) : '';
  switch (q.status) {
    case 'sent': return ahead > 0 ? t('dock.status.finishing', { count: ahead, godName }) : t('dock.status.sent');
    case 'waiting': return q.waitingOn ? t('dock.status.waitingOn', { name: q.waitingOn, time }) : t('dock.status.waitingUntil', { godName, time });
    case 'late': return t('dock.status.late', { time });
    default: return t(`dock.status.${q.status}`, { godName });
  }
}

function ReplyBubble({ dataKey, r, wide, godId, godName, quote, expanded, onMore, onQuote, canReply, onReply }: {
  dataKey: string; r: DockReply; wide: boolean; godId: string; godName: string; quote?: DockQuestion; expanded: boolean; onMore: () => void; onQuote: () => void;
  canReply: boolean; onReply: () => void;
}) {
  const { t } = useTranslation();
  // Couldn't finish always says why; a refusal without one reads "No reason given" (10A).
  const text = r.act === 'refuse' && !r.text.trim() ? t('dock.noReason') : r.text;
  // Folded by height, 8 lines of 18 px (notes 6), so a list and a table fold
  // alike; a line clamp never folds a table (design review 2.1A).
  const fold = r.notes ? FOLD_NOTES_PX : FOLD_PX;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  // Wide, nothing folds: a reply shows in full (2A).
  const open = expanded || wide;
  // Measured against the folded box, and again when the text's own size
  // changes (file chips resolve late, the panel is resized).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || open) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [text, open]);
  const folded = !open && clipped;
  return (
    <div data-k={dataKey} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', maxWidth: '92%' }}>
      <AgentAvatar id={godId} name={godName} size={22} />
      <div style={{
        ['--dock-reply-bg' as string]: r.notes ? 'var(--cth-card-2)' : 'var(--cth-card)',
        minWidth: 0, background: 'var(--dock-reply-bg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)',
        borderRadius: 'var(--cth-r-lg)', borderStartStartRadius: 4, padding: wide ? '10px 14px' : '8px 11px', color: r.notes ? 'var(--cth-ink-2)' : 'var(--cth-ink)'
      }}>
        {r.notes && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', marginBottom: 3 }}>{t('dock.notes', { godName })}</div>}
        {quote && (
          <button onClick={onQuote} style={{ ...linkBtn, display: 'block', textDecoration: 'none', color: 'var(--cth-ink-3)', fontWeight: 400, marginBottom: 4, paddingInlineStart: 8, borderInlineStart: '2px solid var(--cth-line-2)', textAlign: 'start' }}>
            <span dir="auto">{firstSentence(quote.text)}</span>
          </button>
        )}
        <div ref={bodyRef} dir="auto" className="cth-dock-reply" style={open ? undefined : { maxHeight: fold, overflow: 'hidden', position: 'relative' }}>
          {/* Files it names are chips that open them (docs/designs/open-file-tab.md). */}
          <FileText source={boldFirst(text)} who={{ raisedBy: 'god' }} />
          {folded && <div aria-hidden="true" className="cth-dock-fade" />}
        </div>
        {folded && <button onClick={onMore} style={linkBtn}>{t('dock.more')}</button>}
        {canReply && <button onClick={onReply} style={{ ...linkBtn, display: 'block', marginTop: 4 }}>{t('dock.reply')}</button>}
      </div>
    </div>
  );
}

/** The answer's first sentence in bold (18A), unless Michael already marked it. */
function boldFirst(text: string): string {
  const s = text.trimStart();
  if (s.startsWith('**')) return text;
  const m = /^([^\n]+?[.!?])(\s|$)/.exec(s);
  return m ? `**${m[1]}**${s.slice(m[1].length)}` : text;
}

/** A long reply folds at 8 lines of 18 px; Michael's notes at 6 (D10 A, design 2.1A). */
const FOLD_PX = 144;
const FOLD_NOTES_PX = 108;

const dockStyle: CSSProperties = {
  position: 'absolute', insetInlineStart: 0, bottom: 'calc(100% + 8px)', width: 400, maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'min(430px, calc(100vh - 182px))', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  background: 'var(--cth-card)', borderRadius: 'var(--cth-r-2xl)',
  boxShadow: 'inset 0 0 0 1px var(--cth-line-2), var(--cth-shadow-lg)', fontFamily: 'var(--cth-font-ui)', pointerEvents: 'auto'
};
/** Wide, the 1:1 is the top of the center sheet; the sheet draws the card. */
const dockWideStyle: CSSProperties = {
  flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  fontFamily: 'var(--cth-font-ui)', pointerEvents: 'auto'
};
const quietBtn: CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-3)', fontFamily: 'var(--cth-font-ui)', fontSize: 12, padding: 2 };
const linkBtn: CSSProperties = { border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, marginInlineStart: 4, color: 'inherit', fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 };
const chipBtn: CSSProperties = { height: 28, padding: '0 10px', borderRadius: 'var(--cth-r-md)', border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', background: 'var(--cth-card)', color: 'var(--cth-ink)', fontFamily: 'var(--cth-font-ui)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' };
const jumpBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--cth-space-2)', height: 'var(--cth-space-6)', padding: '0 var(--cth-space-3)',
  border: 'none', borderRadius: 'var(--cth-r-md)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', background: 'var(--cth-card)',
  color: 'var(--cth-indigo)', fontFamily: 'var(--cth-font-ui)', fontSize: 'var(--cth-text-body-sm)', fontWeight: 600, cursor: 'pointer'
};
const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };
