import { RESEARCH_ID } from '@shared/research';
/**
 * The Office view: the studio (branding/DESIGN.md 8), the v2 replacement for the
 * pixel floor. The SVG art is drawn on a fixed 1060 x 816 stage and scaled to
 * fit; the label cards, Michael's hub card and the mailbox tags sit over it as
 * HTML at their scaled positions but real size, so text never shrinks below the
 * type floor. Everything shown comes from real state: agent status and action,
 * the task ledger, the mailboxes in config, live hive messages.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useStore, actionText, liveActivity, ACTION_CLOCKING_IN, ROSTER_BOOT_HOME, type Agent } from '@/store/store';
import { useClockingIn } from '@/hooks/useClockingIn';
import type { HarnessConfig } from '@/store/config';
import { departments, type DepartmentName } from '@/design/tokens';
import { useAppTheme } from '@/design/theme';
import { DeptIcon, PersonAvatar } from '@/scene/office/props';
import { PixelBadge, type StatusKind } from '@/components/PixelBadge';
import { NotReportingTag, useSilentEpisode } from '@/components/SilentEngine';
import { useHasTerminalDraft } from '@/components/terminalPool';
import { useOfficeBreak } from '@/components/OfficeBreakNotice';
import type { OfficeBreakView } from '@shared/officeBreak';
import { useMissions } from '@/components/triggers/ScheduleList';
import { parseTasks } from '@/components/TasksKanban';
import { missionsFor, nextRunAt } from '@shared/missions';
import { createBanter, createIdleLines } from '@/scene/office/cafeteriaLines';
import { browserStorage, markWelcomed, welcomeArmed } from '@/scene/office/peteWelcome';
import { getNeedsYouFeed, newestAskFor, shownQuestions, useNeedsYou, useNeedsYouCount } from '@/shell/useNeedsYou';
import { chatCandidates, stillIn } from '@/shell/closingFloor';

/** Nobody has gone home (not closing time). */
const NOBODY: ReadonlySet<string> = new Set();
import { P, STAGE_H, STAGE_W, type Pt } from './iso';
import { family, sceneTokens, type Family } from './theme';
import { HUB, HUB_CARD, POST_GY, cardRect, departmentOf, planStudio, postGx, roleOf, type PodPlan } from './layout';
import { FLIGHT_MS, bendFor, useStudioLife } from './life';
import { SHOW_MAILBOXES } from '@shared/buildFeatures';
import { DECOR, Decor, Flow, Hub, MailPost, Platform, Pod, PodGlow, StudioDefs, plateAt, plateWidth, type DeskState } from './StudioArt';


/** The agent fields the office draws. Changes to anything else (the terminal
 *  parser's station bookkeeping, timestamps) leave it alone. */
const DRAWN_FIELDS = ['id', 'name', 'character', 'status', 'action', 'progress', 'contextTokens', 'contextLimit', 'isGod', 'sourceCard', 'description', 'ptyId', 'lastPrompt'] as const;
function sameDrawnAgents(a: Agent[], b: Agent[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i] || DRAWN_FIELDS.every((k) => Object.is(x[k], b[i][k]))));
}
/** Space kept over the highest card above a pod (its department tab sits on top). */
const CARD_ROOM = 18;
/** Stage px from a pod's slot point up to the bottom of its chip: just over the monitors. */
const CHIP_LIFT = 80;
/** A card opened from a chip takes the chip's place: its top sits this far
 *  above the chip's bottom edge, so its tab row lands where the chip was. */
const ROLL_TOP = 14;
/** Invisible margin around a rolled card that keeps it open while the pointer
 *  crosses the spot where the chip was. */
const ROLL_PAD = 24;

type Board = { todo: number; doing: number; waiting: number; blocked: number; done: number };

/* ── Data ─────────────────────────────────────────────────────────────────── */

interface TaskSnapshot { board: Board; doingBy: Record<string, number>; forYouBy: Record<string, number>; kept: number; done: Record<string, string | undefined> }

function useTaskSnapshot(godId: string): TaskSnapshot {
  // The shared task read (shell/useNeedsYou.ts, eng R4): the "for you" chips
  // always match the pill and the board.
  const { tasks, foundations } = useNeedsYou();
  return useMemo(() => {
    const board: Board = { todo: 0, doing: 0, waiting: 0, blocked: 0, done: 0 };
    const doingBy: Record<string, number> = {};
    const forYouBy: Record<string, number> = {};
    let kept = 0;
    const done: Record<string, string | undefined> = {};
    for (const t of tasks) {
      // Michael's board has the Tasks view's five columns (design review 2026-10-18).
      board[t.status]++;
      if (t.status === 'done') done[t.id] = t.assignee;
      if (t.status === 'doing' && t.assignee) doingBy[t.assignee] = (doingBy[t.assignee] ?? 0) + 1;
      // Only asks Needs you shows: a foundation question answered another way or put off is left out.
      if (t.assignee) { const asks = shownQuestions(t, foundations).length; if (asks) forYouBy[t.assignee] = (forYouBy[t.assignee] ?? 0) + asks; }
      if (t.status !== 'done' && (t.assignee === godId || t.assignee === 'god')) kept++;
    }
    return { board, doingBy, forYouBy, kept, done };
  }, [tasks, foundations, godId]);
}

/** Jobs Michael handed out today: his `request` messages in the hive log. */
function useDelegatedToday(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      void window.cth.hiveLog(1000).then((log) => {
        if (!alive) return;
        const today = new Date().toDateString();
        let c = 0;
        for (const raw of log) {
          const e = raw as { kind?: string; from?: string; act?: string; created_at?: string; ts?: string };
          if (e.kind && e.kind !== 'message') continue;
          if (e.from !== 'god' || e.act !== 'request') continue;
          const at = e.created_at ?? e.ts;
          if (at && new Date(at).toDateString() === today) c++;
        }
        setN(c);
      }).catch(() => { /* keep the last count */ });
    };
    poll();
    const timer = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return n;
}

function useLiveConfig(initial: HarnessConfig): HarnessConfig {
  const [config, setConfig] = useState(initial);
  useEffect(() => setConfig(initial), [initial]);
  useEffect(() => window.cth.onConfigChanged((c) => setConfig(c as HarnessConfig)), []);
  return config;
}

function deskState(a: Agent): DeskState {
  switch (a.status) {
    case 'working': return 'working';
    case 'thinking': return 'thinking';
    case 'waiting': return 'waiting';
    case 'blocked': return 'needs';
    case 'compacting': return 'compacting';
    case 'looping': return 'looping';
    case 'success': return 'success';
    default: return 'idle';
  }
}

/* ── Stage ────────────────────────────────────────────────────────────────── */

/**
 * `bleed`: px the stage runs on under the floating right panel (owner,
 * 2026-09-30: the column read as a slab apart from the office). The room's
 * light and tint reach under the panel; the scene still fits the space left
 * of it.
 */
export const StudioStage = memo(function StudioStage({ config: initialConfig, bleed = 0, quietCards = false }: {
  config: HarnessConfig; bleed?: number;
  /** Demo mode (tools/studio-lab; owner, 2026-10-01): every pod shows its chip,
   *  even while people work; a card pops up only on hover, or for a few
   *  seconds when a demo spotlights someone (`cth:demo-spotlight`). */
  quietCards?: boolean;
}) {
  const { t } = useTranslation();
  const dark = useAppTheme() === 'dark';
  const T = sceneTokens(dark);
  const config = useLiveConfig(initialConfig);
  const selectedId = useStore((s) => s.selectedId);
  const rightColumn = useStore((s) => s.rightColumn);
  const floorView = useStore((s) => s.floorView);
  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);
  // The office re-renders only when something it draws changes (review,
  // 2026-10-01: every agent update re-rendered the whole stage), and keeps
  // its last picture while the Tasks or graph view covers it.
  const agents = useStoreWithEqualityFn(useStore, (s) => s.agents, (a, b) => {
    const st = useStore.getState();
    return st.floorView !== 'office' || !!st.fullscreenAgentId || sameDrawnAgents(a, b);
  });
  const god = agents.find((a) => a.isGod);
  const godId = god?.id ?? 'god';
  const snap = useTaskSnapshot(godId);
  const delegated = useDelegatedToday();
  const toYou = useNeedsYouCount();
  const { missions } = useMissions();

  const plan = useMemo(() => planStudio(agents), [agents]);
  const families = useMemo(() => {
    const out: Record<string, Family> = {};
    for (const d of Object.keys(departments) as DepartmentName[]) out[d] = family(d, dark);
    return out;
  }, [dark]);

  // Fit the stage into the container.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: STAGE_W, h: STAGE_H });
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  // The compact grid and the ring render different host elements: follow the
  // switch, or the stage stops tracking the window's size.
  }, [plan.compact]);
  // Leave room for the floating bottom bar under the platform.
  const fitW = Math.max(200, box.w - bleed);
  // A card above its pod keeps its size while the stage scales, so on a short
  // window it can rise past the top edge (Kelly's card under the top bar at
  // 1440 x 900). Each one needs its top at least CARD_ROOM down: that pushes
  // the stage down, and shrinks it when there is no room to push.
  const lifted = plan.pods.filter((p) => p.slot.mode === 'above').map((p) => cardRect(p.slot, p.members.length));
  const k = Math.min(fitW / STAGE_W, (box.h - 40) / STAGE_H, 1.25,
    ...lifted.map((r) => (box.h - 40 - CARD_ROOM - r.h) / (STAGE_H - r.top - r.h)));
  const ox = (fitW - STAGE_W * k) / 2;
  const oy = Math.max(0, (box.h - 70 - STAGE_H * k) / 2, ...lifted.map((r) => CARD_ROOM + r.h - (r.top + r.h) * k));
  const at = (x: number, y: number): CSSProperties => ({ position: 'absolute', left: ox + x * k, top: oy + y * k });

  // Opening or closing the right column changes `bleed` once. The scene is laid
  // out at its new size in that one render and eased there with a transform
  // over 240 ms (FLIP, docs/designs/needs-you-empty-state.md eng R3), never
  // re-rendered per frame. Reduced motion skips the ease.
  const flipRef = useRef<HTMLDivElement>(null);
  const geom = useRef<{ k: number; ox: number; oy: number; bleed: number } | null>(null);
  useLayoutEffect(() => {
    const prev = geom.current;
    geom.current = { k, ox, oy, bleed };
    const el = flipRef.current;
    // Only a column change eases. The stage's own few pixel resize that
    // follows it lands inside the running ease rather than restarting it.
    if (!prev || !el || prev.bleed === bleed) return;
    if (prev.k === k && prev.ox === ox && prev.oy === oy) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const sc = prev.k / k;
    el.style.transition = 'none';
    el.style.transform = `translate(${prev.ox - ox * sc}px, ${prev.oy - oy * sc}px) scale(${sc})`;
    void el.getBoundingClientRect();
    el.style.transition = 'transform 240ms cubic-bezier(0.2, 0, 0, 1)';
    el.style.transform = '';
  }, [k, ox, oy, bleed]);

  // Pause every animation while nobody can see the stage (DESIGN.md 11.2).
  const [docHidden, setDocHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setDocHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const paused = docHidden || floorView !== 'office' || !!fullscreenAgentId;
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (paused) svg.pauseAnimations(); else svg.unpauseAnimations();
  }, [paused]);

  // Where each agent sits, for tokens and the quote bubble.
  const seatOf = useMemo(() => {
    const m = new Map<string, { pod: PodPlan<Agent>; index: number }>();
    for (const pod of plan.pods) pod.members.forEach((a, index) => m.set(a.id, { pod, index }));
    return m;
  }, [plan]);

  // Mailbox posts: every connected mailbox, and who watches it. None while
  // SHOW_MAILBOXES is off, which also drops their tags and wires.
  const mailboxes = SHOW_MAILBOXES ? config.mailboxes ?? [] : [];
  const ownerOf = (mailboxId: string): Agent | undefined => {
    const entry = Object.entries(config.agentCapabilities ?? {})
      .find(([, c]) => c.email?.enabled && c.email.mailboxes?.[0] === mailboxId);
    return entry ? agents.find((a) => a.id === entry[0]) : undefined;
  };

  const accentOf = (id: string): string => {
    const a = agents.find((x) => x.id === id);
    return a ? families[departmentOf(a)].acc : T.req;
  };
  // Motion from real events: messages, scheduled runs, mail, tools, done tasks.
  const life = useStudioLife({
    seatOf, godId, paused, T, done: snap.done, toYou,
    team: agents.filter((a) => !a.isGod).map((a) => ({ id: a.id, name: a.name })),
    posts: mailboxes.map((m) => ({ id: m.id, ownerId: ownerOf(m.id)?.id })),
    accentOf
  });
  // Closing time first: banter never flies to or from someone gone home.
  const closing = useClosingLights();
  const quote = useIdleQuote(plan.pods, paused || !!closing?.all, life.throwNote, accentOf, closing?.out ?? NOBODY);
  const godBusy = !!god && ['working', 'thinking', 'looping', 'compacting'].includes(god.status);
  // Opening (DESIGN.md 8.12): a desk's light comes on as its person clocks in,
  // a pod's when the first of its people is in, Michael's office when he is.
  const away = useClockingIn(agents);
  const godStatus = useStore((s) => s.godStatus);
  const hubAway = godStatus === 'booting' || (!!god && away.has(god.id));
  const kickoff = useKickoff(plan.pods, paused);
  const hour = useHour();
  const night = hour >= 19 || hour < 6;

  const selected = rightColumn === 'person' ? selectedId : null;
  // With someone selected, everything else on the stage dims to 45%
  // (DESIGN.md 7.14 and 8.5).
  const dimmed = (ids: string[]) => !!selected && !ids.includes(selected);
  const dimStyle = (on: boolean): CSSProperties => ({ opacity: on ? 0.45 : 1, transition: 'opacity var(--cth-dur-base) var(--cth-ease)' });
  const select = (id: string) => useStore.getState().select(id);

  // A quiet pod shows a small chip on the pod; its full card opens while the
  // pointer is on the chip or the card (owner, 2026-09-30: cards on every idle
  // pod made the office look cluttered). The close waits a moment so the
  // pointer can travel from the chip up to the card.
  const [peek, setPeek] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const openPeek = (key: string) => { window.clearTimeout(closeTimer.current); setPeek(key); };
  const closePeek = () => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setPeek(null), 220); };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const podKey = (pod: PodPlan<Agent>) => `${pod.dept}-${pod.members[0].id}`;
  /** Where a chip's speech bubble goes (DESIGN.md 8.8): up from the chip's left,
   *  up from its right, or down under it, whichever first covers no open card. */
  const quoteSpot = (pod: PodPlan<Agent>, cx: number, chipTop: number): QuoteSpot => {
    const QW = 250; const QH = 60; const GAP = 10;
    const names = pod.members.map((a) => a.name).join(', ');
    const w = 30 + 14 * (pod.members.length - 1) + names.length * 6.6;
    const left = cx - w / 2;
    const boxes = plan.pods.filter((p) => p !== pod).map(openCard).flatMap((b) => (b ? [{ l: b.l, t: b.t, r: b.r, b: b.b }] : []));
    if (god && (selected === god.id || peek === 'hub')) {
      const pb = plateBox(god.name);
      const l = (pb.l + pb.r) / 2 - HUB_CARD.w / 2;
      boxes.push({ l, t: pb.b + 8, r: l + HUB_CARD.w, b: pb.b + 8 + 230 });
    }
    const spots: [QuoteSpot, number, number][] = [
      ['up', left, chipTop - GAP - QH],
      ['up-end', left + 32 - QW, chipTop - GAP - QH],
      ['down', left, chipTop + 28 + GAP]
    ];
    const free = spots.find(([, l, t]) => !boxes.some((q) => l < q.r && l + QW > q.l && t < q.b && t + QH > q.t));
    return (free ?? spots[0])[0];
  };

  /** Michael's name plate, in screen px: the plate is drawn in the glass's
   *  plane (a 0.5 shear), so its box is taller than the plate itself. */
  const plateBox = (name: string) => {
    const [px, py] = P(...plateAt(name));
    const w = plateWidth(name);
    return { l: ox + (px - w / 2) * k, t: oy + (py - 6 - w / 4) * k, r: ox + (px + w / 2) * k, b: oy + (py + 6 + w / 4) * k };
  };

  /** A pod shows its full card while someone in it is at work, or it is selected. */
  /** Someone in the pod is at work: its card stays open at its slot, with a stem. */
  const working = (pod: PodPlan<Agent>) => !quietCards && pod.members.some((a) => ACTIVE.has(a.status));
  /** A quiet pod opened by hover, a spotlight or a selection: its card rolls
   *  down from under the chip (owner, 2026-10-01). */
  const rolled = (pod: PodPlan<Agent>) => !working(pod) && (peek === podKey(pod) || pod.members.some((a) => a.id === selected));
  /** Stage px of a pod's chip: centered on the pod, its bottom edge just over the monitors. */
  const chipAt = (pod: PodPlan<Agent>) => ({ x: ox + pod.slot.x * k, y: oy + (pod.slot.y - CHIP_LIFT) * k });
  /** Where a pod's open card is, or null when it shows only its chip. */
  const openCard = (pod: PodPlan<Agent>): { l: number; t: number; r: number; b: number; down: boolean; bottomAt?: number } | null => {
    const r = cardRect(pod.slot, pod.members.length);
    if (working(pod)) {
      const l = ox + r.left * k;
      // A card above its pod is anchored by its bottom edge, so a taller card
      // (more people, a context bar) grows away from the pod, not onto it.
      const above = pod.slot.mode === 'above';
      const cy = oy + (above ? r.top + r.h : r.top) * k;
      const t = above ? cy - r.h : cy;
      return { l, t, r: l + r.w, b: t + r.h, down: false, bottomAt: above ? cy : undefined };
    }
    if (!rolled(pod)) return null;
    const c = chipAt(pod);
    const l = Math.min(Math.max(c.x - r.w / 2, 8), fitW - r.w - 8);
    return { l, t: c.y - ROLL_TOP, r: l + r.w, b: c.y - ROLL_TOP + r.h, down: true };
  };

  // A demo can pop one person's card for a moment, the way a hover does.
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    const onSpot = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      const pod = planRef.current.pods.find((p) => p.members.some((a) => a.id === id));
      if (!pod) return;
      window.clearTimeout(closeTimer.current);
      setPeek(podKey(pod));
      closeTimer.current = window.setTimeout(() => setPeek(null), 3400);
    };
    window.addEventListener('cth:demo-spotlight', onSpot);
    return () => window.removeEventListener('cth:demo-spotlight', onSpot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow keys move between cards in reading order (DESIGN.md 12).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const cards = Array.from(hostRef.current?.querySelectorAll<HTMLElement>('[data-studio-card]') ?? []);
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : i + 1;
    cards[(next + cards.length) % cards.length]?.focus();
  };

  if (plan.compact) {
    return (
      // The grid of cards does not run under the right column (only the ring
      // does), or its last column would sit beneath it (review, 2026-10-01).
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }}>
        <CompactGrid plan={plan} families={families} snap={snap} selected={selected} onSelect={select} missions={missions} godId={godId} />
      </div>
    );
  }

  return (
    <div ref={hostRef} className={`cth-studio${paused ? ' cth-studio-paused' : ''}`} onKeyDown={onKeyDown} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, right: -bleed, overflow: 'hidden', background: 'var(--cth-bg)' }}>
      {/* Eased to its new size when the right column opens or closes (FLIP,
          eng R3): laid out once at the new size, then the transform runs. */}
      <div ref={flipRef} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0' }}>
        {/* The stage's light (DESIGN.md 3.8) and a faint dot grid toward the edges. */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(900px 520px at ${fitW / 2}px 48%, ${dark ? '#211F31' : '#FFFFFF'} 0%, transparent 70%)`
        }} />
        <svg
          ref={svgRef}
          aria-hidden="true"
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          width={STAGE_W * k}
          height={STAGE_H * k}
          style={{ position: 'absolute', left: ox, top: oy, overflow: 'visible' }}
        >
          <StudioDefs T={T} families={families} />
          <Platform T={T} />
          {plan.pods.map((pod) => (
            <g key={`glow-${pod.dept}-${pod.members[0].id}`} style={dimStyle(dimmed(pod.members.map((a) => a.id)))}>
              <PodGlow grid={pod.grid} famKey={pod.dept} desks={pod.members.map((a) => ({ st: deskState(a) }))} />
            </g>
          ))}
          {/* No standing wires (owner, 2026-09-30: lines everywhere looked busy).
              A wire shows only while something moves along it: Michael's wire to a
              pod when someone there starts working, a mailbox's wire while mail
              moves. Messages draw their own path as they fly (life.tsx). */}
          {plan.pods.map((pod) => kickoff[pod.members[0].id] ? (
            <Flow key={`f-${pod.members[0].id}-${kickoff[pod.members[0].id]}`} a={HUB} b={pod.grid} bend={bendFor(pod.grid)} color={T.req} width={2.4} opacity={0.45} T={T} flowing fade />
          ) : null)}
          {mailboxes.map((m, i) => {
            const owner = ownerOf(m.id);
            const seat = owner ? seatOf.get(owner.id) : undefined;
            if (!seat || !life.postActive[m.id]) return null;
            const from: Pt = [postGx(i, mailboxes.length), POST_GY - 0.3];
            return <Flow key={`m-${m.id}`} a={from} b={seat.pod.grid} bend={0.3} color={T.req} width={2.2} opacity={0.5} T={T} flowing fade />;
          })}
          {/* Objects, back to front. */}
          {[
            ...DECOR.map((d) => ({ depth: d.at[0] + d.at[1], node: <Decor key={`decor-${d.at[0]}-${d.at[1]}`} kind={d.kind} at={d.at} T={T} /> })),
            ...mailboxes.map((m, i) => {
              const gx = postGx(i, mailboxes.length);
              const owner = ownerOf(m.id);
              return {
                depth: gx + POST_GY,
                // A mailbox stays bright when its watcher is the one selected.
                node: <g key={`p-${m.id}`} style={dimStyle(dimmed(owner ? [owner.id] : []) || (!!owner && !!closing?.out.has(owner.id)))}><MailPost gx={gx} gy={POST_GY} broken={m.status === 'needs-attention'} c={owner ? families[departmentOf(owner)] : null} T={T} active={life.postActive[m.id]} /></g>
              };
            }),
            ...plan.pods.map((pod) => ({
              depth: pod.grid[0] + pod.grid[1],
              node: (
                <g key={`pod-${pod.dept}-${pod.members[0].id}`} style={dimStyle(dimmed(pod.members.map((a) => a.id)))}>
                <Pod
                  grid={pod.grid}
                  // A person who has gone home at closing time has a dark desk (2A).
                  desks={pod.members.map((a) => ({ st: deskState(a), prop: a.character, away: away.has(a.id) || !!closing?.out.has(a.id) }))}
                  c={families[pod.dept]} famKey={pod.dept}
                  label={t(`studio.dept.${pod.dept}`)}
                  selected={pod.members.some((a) => a.id === selected)}
                  T={T} dark={dark}
                  arriving={pod.members.some((a) => life.arriving.has(a.id))}
                  lightsOut={(!!closing && pod.members.every((a) => closing.out.has(a.id))) || pod.members.every((a) => away.has(a.id))}
                />
                </g>
              )
            })),
            { depth: 0, node: <g key="hub" style={dimStyle(dimmed(god ? [god.id] : []))}><Hub T={T} dark={dark} board={snap.board} busy={godBusy} name={god?.name} plateLit={!!god && (selected === god.id || peek === 'hub')} ringing={life.clockRinging} lightsOut={!!closing?.all || hubAway}
              stats={{ delegated, toYou, kept: snap.kept, ctx: god && god.contextTokens !== undefined && god.contextLimit ? Math.round((god.contextTokens / god.contextLimit) * 100) : null }} /></g> }
          ].sort((a, b) => a.depth - b.depth).map((o) => o.node)}
          {life.svg}
        </svg>

        {/* The light of the day (DESIGN.md 8.12): morning sun from the left, a
            golden evening, a darker night where working desks keep their lamps on. */}
        <DayLight hour={hour} dark={dark} />
        {night && (
          <svg aria-hidden="true" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} width={STAGE_W * k} height={STAGE_H * k}
            style={{ position: 'absolute', left: ox, top: oy, overflow: 'visible', pointerEvents: 'none', mixBlendMode: 'screen' }}>
            <defs>
              <radialGradient id="st-lamp"><stop offset="0" stopColor="#FFD38A" stopOpacity={0.55} /><stop offset="1" stopColor="#FFD38A" stopOpacity={0} /></radialGradient>
            </defs>
            {plan.pods.filter((pod) => pod.members.some((a) => ACTIVE.has(a.status) && !away.has(a.id)) && !(closing && pod.members.every((a) => closing.out.has(a.id)))).map((pod) => {
              const [x, y] = P(pod.grid[0], pod.grid[1], 30);
              return <ellipse key={pod.members[0].id} cx={x} cy={y} rx={95} ry={60} fill="url(#st-lamp)" className="cth-st-breathe" />;
            })}
            {godBusy && !closing?.all && (() => { const [x, y] = P(0, -0.2, 40); return <ellipse cx={x} cy={y} rx={110} ry={70} fill="url(#st-lamp)" />; })()}
          </svg>
        )}

        {/* Stems from each card to its pod. */}
        <svg aria-hidden="true" width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {plan.pods.map((pod) => {
            if (!working(pod)) return null;
            const r = cardRect(pod.slot, pod.members.length);
            const x = ox + r.stem.x * k;
            return (
              <g key={`stem-${pod.members[0].id}`} style={dimStyle(dimmed(pod.members.map((a) => a.id)))}>
                <line x1={x} y1={oy + r.stem.y1 * k} x2={x} y2={oy + r.stem.y2 * k} stroke={T.stem} strokeWidth={1} strokeDasharray="2 3" />
                <circle cx={x} cy={oy + r.stem.y2 * k} r={2.2} fill={T.stem} />
              </g>
            );
          })}
        </svg>

        {/* Label cards. */}
        {plan.pods.map((pod) => {
          const key = podKey(pod);
          // Closing time (docs/designs/closing-floor.md): people who have gone
          // home leave the chip and card (2A); with nobody left, the chip fades
          // out with the lights and nothing on the pod opens anyone (1A, 8A).
          const present = stillIn(pod.members, closing?.out ?? NOBODY);
          if (!present.length) {
            const { x, y } = chipAt(pod);
            return (
              <div key={`gone-${pod.members[0].id}`} className="cth-st-gone" aria-hidden="true" ref={(el) => el?.setAttribute('inert', '')}
                style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%, -100%)' }}>
                <PodChip style={{ position: 'relative' }} dept={pod.dept} members={pod.members} c={families[pod.dept]} snap={snap}
                  onSelect={() => undefined} onEnter={() => undefined} onLeave={() => undefined} quote={null} quoteSpot="up" />
              </div>
            );
          }
          if (present.length !== pod.members.length) pod = { ...pod, members: present };
          const { x: chipX, y: chipY } = chipAt(pod);
          const speaking = quote && pod.members.some((a) => a.id === quote.agentId) ? quote : null;
          const open = openCard(pod);
          // Opened from the chip, the card takes the chip's place and rolls down
          // over the monitors; the chip hides, so nothing shows twice (owner,
          // 2026-10-01). A margin keeps it open while the pointer leaves the
          // chip's spot.
          if (open?.down) {
            return (
              <div key={`card-${pod.members[0].id}`} className="cth-st-roll"
                onMouseEnter={() => openPeek(key)} onMouseLeave={closePeek}
                style={{ position: 'absolute', left: open.l - ROLL_PAD, top: open.t - ROLL_PAD, padding: `${ROLL_PAD}px ${ROLL_PAD}px 0`, zIndex: 3 }}>
                <PodCard
                  style={{ position: 'relative', width: open.r - open.l }}
                  dept={pod.dept} members={pod.members} c={families[pod.dept]}
                  snap={snap} selected={selected} onSelect={select} missions={missions} godId={godId}
                />
              </div>
            );
          }
          // A pod at work shows its card at its slot, with a stem; a quiet pod
          // its chip, just over its monitors (the right and front chips used to
          // hang under the pod, on empty floor).
          if (open) {
            return (
              <PodCard
                key={`card-${pod.members[0].id}`}
                // The selected person's card sits above any dimmed neighbour it overlaps.
                style={{ position: 'absolute', left: open.l, top: open.bottomAt ?? open.t, width: open.r - open.l, transform: open.bottomAt !== undefined ? 'translateY(-100%)' : undefined, zIndex: selected && pod.members.some((a) => a.id === selected) ? 2 : undefined, ...dimStyle(dimmed(pod.members.map((a) => a.id))) }}
                dept={pod.dept} members={pod.members} c={families[pod.dept]}
                snap={snap} selected={selected} onSelect={select} missions={missions} godId={godId}
              />
            );
          }
          return (
            <PodChip
              key={`chip-${pod.members[0].id}`}
              style={{ position: 'absolute', left: chipX, top: chipY, transform: 'translate(-50%, -100%)', ...dimStyle(dimmed(pod.members.map((a) => a.id))) }}
              dept={pod.dept} members={pod.members} c={families[pod.dept]} snap={snap}
              onSelect={select} onEnter={() => openPeek(key)} onLeave={closePeek}
              quote={speaking}
              quoteSpot={speaking ? quoteSpot(pod, chipX, chipY - 28) : 'up'}
            />
          );
        })}

        {/* Michael: his name plate on the glass is the way in (owner, 2026-09-30).
            Hover shows his full card under the plate; a click selects him, which
            keeps the card open. His numbers live on his walls. */}
        {god && (() => {
          const sel = selected === god.id;
          const plate = plateBox(god.name);
          return (
            <>
              <button
                data-studio-card=""
                onClick={() => select(god.id)}
                onMouseEnter={() => openPeek('hub')}
                onMouseLeave={closePeek}
                onFocus={() => openPeek('hub')}
                onBlur={closePeek}
                aria-label={`${god.name}, ${t('studio.officeManager')}`}
                className="cth-st-plate"
                style={{ position: 'absolute', left: plate.l, top: plate.t, width: plate.r - plate.l, height: plate.b - plate.t }}
              />
              {(sel || peek === 'hub') && (
                <div onMouseEnter={() => openPeek('hub')} onMouseLeave={closePeek}
                  style={{ position: 'absolute', left: (plate.l + plate.r) / 2 - HUB_CARD.w / 2, top: plate.b + 8, width: HUB_CARD.w, zIndex: 3 }}>
                  <HubCard
                    style={{ width: '100%' }}
                    god={god} selected={sel} onSelect={() => select(god.id)}
                    delegated={delegated} toYou={toYou} kept={snap.kept} board={snap.board}
                  />
                </div>
              )}
            </>
          );
        })()}

        {/* Mailbox tags. */}
        {mailboxes.map((m, i) => {
          const [x, y] = P(postGx(i, mailboxes.length), POST_GY, 0);
          const owner = ownerOf(m.id);
          const broken = m.status === 'needs-attention';
          const w = broken ? 170 : 96;
          return (
            <MailTag key={m.id} style={{ position: 'absolute', left: ox + x * k - (broken ? w / 2 - 16 : w / 2), top: oy + (y + 20) * k, minWidth: w, width: 'max-content', maxWidth: 230, ...dimStyle(dimmed(owner ? [owner.id] : []) || (!!owner && !!closing?.out.has(owner.id))) }}
              width={w} address={m.address} owner={owner?.name} acc={owner ? families[departmentOf(owner)].acc : T.req}
              broken={broken} reason={m.statusReason} />
          );
        })}

        {/* A scheduled job's name, as it starts. */}
        {life.bubbles.map((b) => (
          <div key={b.key} className={b.tone === 'welcome' ? 'cth-st-sched cth-st-welcome' : 'cth-st-sched'} style={{ ...at(b.at[0], b.at[1]), transform: 'translateX(-50%)' }}>
            {b.tone === 'welcome'
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8 5.8 1.9-5.8 1.9L12 18l-1.9-5.4L4.3 10.7l5.8-1.9z" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
            {b.tone === 'welcome' ? t('studio.welcome', { name: b.text }) : b.text}
          </div>
        ))}

        <div className="cth-sr-only" aria-live="polite">{t('studio.summary', { count: agents.length })}</div>
      </div>
    </div>
  );
});

/* ── Label card (DESIGN.md 7.14) ──────────────────────────────────────────── */

function PodCard({ style, dept, members, c, snap, selected, onSelect, missions, godId, onEnter, onLeave }: {
  style: CSSProperties; dept: DepartmentName; members: Agent[]; c: Family; snap: TaskSnapshot;
  selected: string | null; onSelect: (id: string) => void; missions: ReturnType<typeof useMissions>['missions']; godId: string;
  onEnter?: () => void; onLeave?: () => void;
}) {
  const { t } = useTranslation();
  const lead = members[0];
  const doing = members.reduce((n, a) => n + (snap.doingBy[a.id] ?? 0), 0);
  const forYou = members.reduce((n, a) => n + (snap.forYouBy[a.id] ?? 0), 0);
  const isSel = members.some((a) => a.id === selected);
  const allIdle = members.every((a) => a.status === 'idle');
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave} style={{
      ...style, borderRadius: 'var(--cth-r-xl)', padding: '12px 10px 0 9px',
      background: `color-mix(in srgb, var(--cth-card) ${allIdle ? 86 : 96}%, transparent)`, backdropFilter: 'blur(6px)',
      boxShadow: isSel ? 'inset 0 0 0 1px var(--cth-ink), var(--cth-ring-select), var(--cth-shadow-md)' : 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-md)'
    }}>
      <div style={{ position: 'absolute', insetInlineStart: 9, top: -9, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ ...deptTab, boxShadow: `inset 0 0 0 1px ${c.m}` }}><DeptIcon dept={dept} size={10} color={c.acc} />{t(`studio.dept.${dept}`)}</span>
        {doing > 0 && (
          <button title={t('studio.doing', { count: doing })} aria-label={t('studio.doing', { count: doing })}
            onClick={() => openFirstDoing(lead.id)} style={sticky}>{doing}</button>
        )}
        {forYou > 0 && (
          // Opens the board at this pod's newest ask, focus in its reply (D11).
          <button
            className="cth-for-you"
            onClick={() => useStore.getState().openNeedsYou({ taskId: newestAskFor(members.map((a) => a.id), getNeedsYouFeed().tasks, getNeedsYouFeed().foundations) })}
            style={{ ...forYouBadge, background: undefined, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          ><i style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--cth-coral-base)', display: 'block' }} />{t('studio.forYou', { count: forYou })}</button>
        )}
      </div>
      {members.map((a, i) => (
        <MemberRow key={a.id} a={a} c={c} divider={i > 0} onSelect={onSelect} missions={missions} godId={godId} />
      ))}
    </div>
  );
}

function openFirstDoing(agentId: string) {
  void window.cth.hiveTasks().then((raw) => {
    const task = parseTasks(raw).find((x) => x.status === 'doing' && x.assignee === agentId);
    if (task) useStore.getState().openTaskDetail(task.id);
  }).catch(() => { /* nothing to open */ });
}

function MemberRow({ a, c, divider, onSelect, missions, godId }: {
  a: Agent; c: Family; divider: boolean; onSelect: (id: string) => void; missions: ReturnType<typeof useMissions>['missions']; godId: string;
}) {
  const { t } = useTranslation();
  const typing = useHasTerminalDraft(a.ptyId);
  const onBreak = useOfficeBreak();
  const status: StatusKind = typing ? 'typing' : breakStatus(a, onBreak);
  // Its engine isn't reporting: the tag replaces the status (issue #326, SD14).
  const silent = useSilentEpisode(a.id);
  const next = (() => {
    const now = Date.now();
    const times = missionsFor(missions, a.id, godId).filter((m) => m.enabled).map((m) => ({ at: nextRunAt(m, now), label: m.label })).filter((x): x is { at: number; label: string } => x.at !== null);
    if (!times.length) return null;
    const first = times.sort((x, y) => x.at - y.at)[0];
    return `${new Date(first.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: ${first.label}`;
  })();
  const live = a.status !== 'idle' ? liveActivity(a) : '';
  // Office words for what the agent is doing; the owner's own prompt, the
  // fallback, shows as written (it would read "Read the contract" as a tool).
  const caption = sentence((live ? (a.action?.trim() ? actionText(live, t) : live) : '') || next || '');
  const pct = Math.min(8, Math.max(0, a.progress ?? 0)) / 8;
  const gauge = (a.progress ?? 0) >= 7 ? 'var(--cth-coral-base)' : (a.progress ?? 0) >= 6 ? 'var(--cth-amber)' : c.acc;
  return (
    <button
      data-studio-card=""
      onClick={() => onSelect(a.id)}
      aria-label={`${a.name}, ${roleOf(a)}`}
      style={{
        display: 'block', width: '100%', padding: divider ? '7px 0 0' : 0, marginTop: divider ? 7 : 0, border: 'none',
        borderTop: divider ? '1px dashed var(--cth-line-2)' : 'none', background: 'transparent', cursor: 'pointer', textAlign: 'start',
        fontFamily: 'var(--cth-font-ui)', borderRadius: 6
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, position: 'relative', paddingInlineEnd: 2 }}>
        <PersonAvatar who={a} size={24} style={{ marginTop: 1 }} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 12.5, fontWeight: 600, lineHeight: '15px', letterSpacing: '-0.02em', color: a.status === 'idle' ? 'var(--cth-ink-3)' : 'var(--cth-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingInlineEnd: 78 }}>{a.name}</b>
          <i style={{ fontStyle: 'normal', fontSize: 10, lineHeight: '13px', color: 'var(--cth-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleOf(a)}</i>
        </span>
        {silent
          ? <NotReportingTag style={{ position: 'absolute', insetInlineEnd: 0, top: 0 }} />
          : <PixelBadge status={status} style={{ position: 'absolute', insetInlineEnd: 0, top: 0, fontSize: 10, lineHeight: '13px', padding: '1px 7px' }} />}
      </div>
      <div style={{ marginTop: 5, marginBottom: 8, fontSize: 10.5, lineHeight: '14px', color: a.status === 'idle' ? 'var(--cth-ink-3)' : 'var(--cth-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={caption}>{caption || t('studio.nothingNow')}</div>
      {pct > 0 && (
        <div title={t('studio.context')} style={{ height: 3, marginBottom: 6, borderRadius: 2, background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, background: gauge, borderRadius: 2 }} />
        </div>
      )}
    </button>
  );
}

/** A quiet pod's chip (DESIGN.md 7.14a): who sits there, and anything waiting
 *  on the owner, without the full card. Hover shows the card; a click opens
 *  that person's panel. */
type QuoteSpot = 'up' | 'up-end' | 'down';

function PodChip({ style, dept, members, c, snap, onSelect, onEnter, onLeave, quote, quoteSpot }: {
  style: CSSProperties; dept: DepartmentName; members: Agent[]; c: Family; snap: TaskSnapshot;
  onSelect: (id: string) => void; onEnter: () => void; onLeave: () => void;
  /** An idle line someone in this pod is saying, or one thrown to them (DESIGN.md 8.8). */
  quote: Quote | null;
  quoteSpot: QuoteSpot;
}) {
  const { t } = useTranslation();
  const forYou = members.reduce((n, a) => n + (snap.forYouBy[a.id] ?? 0), 0);
  const names = members.map((a) => a.name).join(', ');
  const speakerAt = quote ? members.findIndex((a) => a.id === quote.agentId) : -1;
  const speaker = speakerAt >= 0 ? members[speakerAt] : null;
  return (
    <div style={style}>
      {/* The speech bubble belongs to the chip: its tail points at the speaker's avatar. */}
      {quote && speaker && (
        <div key={quote.key} aria-hidden="true"
          className={['cth-st-quote', quoteSpot === 'down' ? 'cth-st-quote-below' : '', quoteSpot === 'up-end' ? 'cth-st-quote-end' : ''].filter(Boolean).join(' ')}
          style={{
            ...(quoteSpot === 'down' ? { top: 'calc(100% + 10px)' } : { bottom: 'calc(100% + 10px)' }),
            // Opening leftward, the bubble's right edge sits just past the
            // speaker's avatar so the tail (12px in from that edge) lands on it.
            ...(quoteSpot === 'up-end' ? { right: `calc(100% - ${4 + speakerAt * 14 + 10 + 18}px)` } : { left: 0 }),
            // A thrown line wears the sender's color and name.
            ['--q-acc' as string]: quote.from?.acc ?? c.acc, ['--q-tail' as string]: `${4 + speakerAt * 14 + 4}px`,
            animationDuration: `${quote.ms}ms`
          } as CSSProperties}>
          {(quote.from || members.length > 1) && <span className="cth-st-quote-who">{quote.from?.name ?? speaker.name}</span>}
          <span className="cth-st-quote-text">“{quote.text}”</span>
        </div>
      )}
    <button
      data-studio-card=""
      onClick={() => onSelect(members[0].id)}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-label={`${t(`studio.dept.${dept}`)}: ${names}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px 0 4px',
        border: 'none', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--cth-font-ui)',
        background: 'color-mix(in srgb, var(--cth-card) 92%, transparent)', backdropFilter: 'blur(6px)',
        boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-sm)'
      }}
    >
      <span style={{ display: 'inline-flex' }}>
        {members.map((a, i) => (
          <PersonAvatar key={a.id} who={a} size={20} className={i === speakerAt ? 'cth-st-speak' : undefined}
            ring={i === speakerAt ? c.acc : undefined} separator={i !== speakerAt}
            style={{ marginInlineStart: i ? -6 : 0, position: 'relative', zIndex: i === speakerAt ? 1 : undefined }} />
        ))}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-2)' }}>{names}</span>
      {forYou > 0 && (
        <span style={forYouBadge}><i style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--cth-coral-base)', display: 'block' }} />{t('studio.forYou', { count: forYou })}</span>
      )}
    </button>
    </div>
  );
}

/** Statuses that mean someone is at work, so their pod shows its full card. */
const ACTIVE = new Set<string>(['thinking', 'working', 'blocked', 'compacting', 'looping']);

/** "On a break" for a Claude agent that is not mid turn while the plan's
 *  usage limit holds the office (issue 124); otherwise its own status. */
function breakStatus(a: Agent, b: OfficeBreakView | null): StatusKind {
  return b && (a.provider ?? 'claude') === 'claude' && !ACTIVE.has(a.status) ? 'break' : (a.status as StatusKind);
}

/** Activity captions are stored lower case ("nothing to do"); a caption on
 *  its own line starts with a capital. */
function sentence(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const deptTab: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cth-ink-2)',
  background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)', borderRadius: 6, padding: '2px 6px', lineHeight: '12px'
};
const sticky: CSSProperties = {
  fontFamily: 'var(--cth-font-mono)', fontSize: 10, fontWeight: 600, color: '#6B5200', background: '#FFE58A',
  border: 'none', borderRadius: '2px 2px 6px 2px', width: 17, height: 17, display: 'grid', placeItems: 'center', padding: 0,
  transform: 'rotate(-5deg)', boxShadow: '0 1px 2px rgba(120,90,0,.25)', cursor: 'pointer'
};
const forYouBadge: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 600, lineHeight: '12px', whiteSpace: 'nowrap',
  color: 'var(--cth-coral-text)', background: 'var(--cth-coral-soft)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-coral-base) 35%, transparent)',
  borderRadius: 999, padding: '2px 7px 2px 5px'
};

/* ── Michael's hub card (DESIGN.md 7.17) ──────────────────────────────────── */

function HubCard({ style, god, selected, onSelect, delegated, toYou, kept, board }: {
  style: CSSProperties; god: Agent; selected: boolean; onSelect: () => void;
  delegated: number; toYou: number; kept: number; board: Board;
}) {
  const { t } = useTranslation();
  const onBreak = useOfficeBreak();
  const godSilent = useSilentEpisode(god.id);
  const ctx = god.contextTokens !== undefined && god.contextLimit ? Math.round((god.contextTokens / god.contextLimit) * 100) : null;
  const stat = (n: number, label: string, coral = false) => (
    <div style={{ padding: '6px 0 7px', textAlign: 'center' }}>
      <b style={{ display: 'block', fontFamily: 'var(--cth-font-mono)', fontSize: 16, fontWeight: 600, lineHeight: '19px', color: coral && n > 0 ? 'var(--cth-coral-text)' : 'var(--cth-ink)' }}><span key={n} className="cth-st-tick">{n}</span></b>
      <span style={{ fontSize: 10, color: 'var(--cth-ink-3)' }}>{label}</span>
    </div>
  );
  const col = (n: number, label: string, key: string) => (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, fontSize: 10, color: 'var(--cth-ink-3)' }}>
      <b style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--cth-ink)', display: 'flex', alignItems: 'center', gap: 4, lineHeight: '15px' }}>
        <i style={{ width: 6, height: 6, borderRadius: 2, background: key, display: 'block' }} /><span key={n} className="cth-st-tick">{n}</span>
      </b>{label}
    </span>
  );
  return (
    <div style={{
      position: 'relative', ...style, borderRadius: 'var(--cth-r-2xl)', overflow: 'hidden', background: 'var(--cth-card)',
      boxShadow: selected ? 'var(--cth-ring-select), var(--cth-shadow-hub)' : 'var(--cth-shadow-hub)'
    }}>
      <button data-studio-card="" onClick={onSelect} aria-label={god.name} style={{
        position: 'relative', display: 'block', width: '100%', padding: '9px 11px 8px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--cth-font-ui)'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <PersonAvatar who={god} size={26} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <b style={{ fontSize: 12.5, fontWeight: 600, lineHeight: '15px', color: 'var(--cth-ink)', paddingInlineEnd: 76 }}>{god.name}</b>
            <i style={{ fontStyle: 'normal', fontSize: 10, color: 'var(--cth-ink-3)', whiteSpace: 'nowrap' }}>{t('studio.officeManager')}</i>
          </span>
          {godSilent
            ? <NotReportingTag style={{ position: 'absolute', insetInlineEnd: 11, top: 9 }} />
            : <PixelBadge status={breakStatus(god, onBreak)} style={{ position: 'absolute', insetInlineEnd: 11, top: 9, fontSize: 10, lineHeight: '13px', padding: '1px 7px' }} />}
        </div>
        <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: '14px', color: 'var(--cth-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {god.action?.trim() ? sentence(actionText(god.action.trim(), t)) : t('studio.runningTheOffice')}
        </div>
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid var(--cth-line)', background: 'var(--cth-card-2)' }}>
        {stat(delegated, t('studio.delegated'))}
        <div style={{ borderInline: '1px solid var(--cth-line)' }}>{stat(toYou, t('studio.toYou'), true)}</div>
        {stat(kept, t('studio.kept'))}
      </div>
      <button onClick={() => useStore.getState().setFloorView('tasks')} aria-label={t('floorView.tasks')} style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', width: '100%', padding: '6px 4px 7px', border: 'none', borderTop: '1px solid var(--cth-line)',
        background: 'transparent', cursor: 'pointer', fontFamily: 'var(--cth-font-ui)'
      }}>
        {col(board.todo, t('studio.todo'), 'var(--cth-ink-4)')}
        {col(board.doing, t('studio.doingCol'), 'var(--cth-blue)')}
        {col(board.waiting, t('kanban.colWaiting'), 'var(--cth-amber)')}
        {col(board.blocked, t('studio.blocked'), 'var(--cth-coral-base)')}
        {col(board.done, t('studio.done'), 'var(--cth-green)')}
      </button>
      {ctx !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--cth-line)', padding: '7px 11px 8px', fontSize: 10, color: 'var(--cth-ink-3)', background: 'var(--cth-card-2)' }}>
          {t('studio.context')}
          <span style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--cth-neutral-soft)', overflow: 'hidden' }}>
            <i style={{ display: 'block', height: '100%', width: `${Math.min(100, ctx)}%`, borderRadius: 3, background: 'linear-gradient(90deg,#8E83F5,#6C5CE7)' }} />
          </span>
          <span style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 600, color: 'var(--cth-ink-2)' }}>{ctx}%</span>
        </div>
      )}
      {/* The outline sits over the rows: an inset shadow on the card paints
          under its children, so the filled stats and context rows hid it at
          the sides when the card was selected. */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
        boxShadow: `inset 0 0 0 1px ${selected ? 'var(--cth-ink)' : 'var(--cth-line)'}`
      }} />
    </div>
  );
}

/* ── Mailbox tag (DESIGN.md 7.18) ─────────────────────────────────────────── */

function MailTag({ style, width, address, owner, acc, broken, reason }: {
  style: CSSProperties; width: number; address: string; owner?: string; acc: string; broken: boolean; reason?: string;
}) {
  const { t } = useTranslation();
  const local = `${address.split('@')[0]}@`;
  const openMailboxes = () => window.dispatchEvent(new CustomEvent('cth:open-settings', { detail: { section: 'Connections' } }));
  return (
    <div title={address} style={{
      width, ...style, padding: broken ? '5px 9px 6px' : '4px 8px', borderRadius: 10,
      background: broken ? 'var(--cth-coral-soft)' : 'var(--cth-card)',
      boxShadow: `inset 0 0 0 1px ${broken ? 'color-mix(in srgb, var(--cth-coral-base) 35%, transparent)' : 'var(--cth-line)'}, var(--cth-shadow-md)`,
      borderTop: `2.5px solid ${broken ? 'var(--cth-coral-base)' : acc}`,
      display: 'flex', flexDirection: 'column', gap: 1
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <b style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, fontWeight: 600, lineHeight: '13px', color: 'var(--cth-ink)' }}>{local}</b>
        <span style={{ fontSize: 10, lineHeight: '12px', color: 'var(--cth-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{owner ?? t('studio.noOwner')}</span>
      </div>
      {broken && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <em title={reason} style={{ fontStyle: 'normal', fontSize: 10, fontWeight: 600, color: 'var(--cth-coral-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('studio.mailboxBroken')}</em>
          <button onClick={openMailboxes} style={{
            marginInlineStart: 'auto', height: 18, padding: '0 8px', border: 'none', borderRadius: 999, cursor: 'pointer',
            background: 'var(--cth-coral-strong)', color: 'var(--cth-on-coral)', fontFamily: 'var(--cth-font-ui)', fontSize: 10, fontWeight: 600
          }}>{t('studio.fix')}</button>
        </div>
      )}
    </div>
  );
}

/* ── Compact grid for large teams (DESIGN.md 8.9) ─────────────────────────── */

function CompactGrid({ plan, families, snap, selected, onSelect, missions, godId }: {
  plan: ReturnType<typeof planStudio<Agent>>; families: Record<string, Family>; snap: TaskSnapshot;
  selected: string | null; onSelect: (id: string) => void; missions: ReturnType<typeof useMissions>['missions']; godId: string;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px 24px 110px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {plan.groups.map((g) => (
        <div key={g.dept} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(186px, 1fr))', gap: 18, paddingTop: 10 }}>
          {g.members.map((a) => (
            <PodCard key={a.id} style={{ position: 'relative', opacity: selected && a.id !== selected ? 0.45 : 1, transition: 'opacity var(--cth-dur-base) var(--cth-ease)' }} dept={g.dept} members={[a]} c={families[g.dept]}
              snap={snap} selected={selected} onSelect={onSelect} missions={missions} godId={godId} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Work starting (DESIGN.md 8.12) ───────────────────────────────────────── */

/** Pods where someone just started working, keyed by the pod's first member,
 *  for about three seconds: Michael's wire to the pod shows and flows, then
 *  fades. Nothing on first load: work already under way is not a start. */
function useKickoff(pods: PodPlan<Agent>[], paused: boolean): Record<string, number> {
  const [kick, setKick] = useState<Record<string, number>>({});
  const prev = useRef<Map<string, boolean> | null>(null);
  // Pending timeouts only; each leaves the set when it fires.
  const timers = useRef(new Set<number>());
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const sig = pods.map((p) => `${p.members[0].id}:${p.members.map((a) => a.status).join('.')}`).join('|');
  // Coming back from the Tasks or graph view, whoever started meanwhile is
  // just the new baseline: no handoff beams for work handed out minutes ago.
  const wasPaused = useRef(paused);
  useEffect(() => {
    const now = new Map(pods.flatMap((p) => p.members.map((a) => [a.id, ACTIVE.has(a.status)] as [string, boolean])));
    const before = prev.current;
    prev.current = now;
    const resumed = wasPaused.current;
    wasPaused.current = paused;
    if (!before || paused || resumed) return;
    for (const pod of pods) {
      if (!pod.members.some((a) => now.get(a.id) && before.get(a.id) === false)) continue;
      const key = pod.members[0].id;
      const stamp = Date.now();
      setKick((k) => ({ ...k, [key]: stamp }));
      const id = window.setTimeout(() => {
        timers.current.delete(id);
        setKick((k) => {
          if (k[key] !== stamp) return k;
          const n = { ...k }; delete n[key]; return n;
        });
      }, 3200);
      timers.current.add(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, paused]);
  return kick;
}

/* ── Closing time and daylight (DESIGN.md 8.12) ───────────────────────────── */

/** Closing time, as the stage sees it: who has gone home (confirmed or
 *  excused), and whether the whole office is closed. Null when not closing. */
function useClosingLights(): { out: Set<string>; all: boolean } | null {
  const [state, setState] = useState<{ out: Set<string>; all: boolean } | null>(null);
  useEffect(() => window.cth.onClosingTime((ev) => {
    const e = ev as { phase: string; confirmed?: string[]; excused?: string[] };
    if (e.phase === 'cancelled' || e.phase === 'error') { setState(null); return; }
    setState({ out: new Set([...(e.confirmed ?? []), ...(e.excused ?? [])]), all: e.phase === 'complete' });
  }), []);
  return state;
}

/** The local hour, checked every minute (a demo can set it with an event). */
function useHour(): number {
  const [h, setH] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => setH(new Date().getHours()), 60_000);
    const onDemo = (ev: Event) => setH((ev as CustomEvent<number>).detail);
    window.addEventListener('cth:demo-hour', onDemo);
    return () => { window.clearInterval(id); window.removeEventListener('cth:demo-hour', onDemo); };
  }, []);
  return h;
}

function DayLight({ hour, dark }: { hour: number; dark: boolean }) {
  const k = dark ? 0.6 : 1;
  const bg = hour >= 6 && hour < 10
    ? `linear-gradient(115deg, rgba(255,196,140,${0.26 * k}) 0%, rgba(255,214,170,${0.1 * k}) 35%, transparent 65%)`
    : hour >= 16 && hour < 19
      ? `linear-gradient(295deg, rgba(255,150,70,${0.3 * k}) 0%, rgba(255,120,90,${0.12 * k}) 40%, rgba(110,80,200,${0.08 * k}) 100%)`
      : hour >= 19 || hour < 6
        ? `radial-gradient(1100px 700px at 50% 45%, rgba(60,48,130,${0.16 * k}) 0%, rgba(40,32,96,${0.34 * k}) 100%)`
        : '';
  if (!bg) return null;
  return <div aria-hidden="true" className="cth-st-daylight" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: bg, mixBlendMode: 'multiply' }} />;
}

/* ── Idle quote and banter (DESIGN.md 8.8) ─────────────────────────────── */

/** A line on a chip: said by `agentId`, or (with `from`) thrown to them by
 *  someone else and shown where it landed. Visible for `ms`. */
type Quote = { agentId: string; text: string; key: number; from?: { name: string; acc: string }; ms: number };

function useIdleQuote(
  pods: PodPlan<Agent>[], paused: boolean,
  throwNote: (fromId: string, toId: string) => boolean,
  accentOf: (id: string) => string,
  gone: ReadonlySet<string>
): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(null);
  const live = useRef({ pods, throwNote, accentOf, gone });
  live.current = { pods, throwNote, accentOf, gone };
  // One deck of lines and one of exchanges, so nothing repeats until it must.
  const [lines] = useState(() => createIdleLines());
  const [banter] = useState(() => createBanter());
  const lastSpeaker = useRef('');
  useEffect(() => {
    if (paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setQuote(null); return; }
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };
    let timer: number | undefined;
    let hide: number | undefined;
    let n = 0;
    let busyUntil = 0;
    const show = (q: Omit<Quote, 'key'>) => {
      setQuote({ ...q, key: n++ });
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setQuote(null), q.ms);
    };
    // Someone idle and in (not clocking in, not gone home at closing time), in
    // a pod where nobody still at work is busy, so a bubble never sits on an
    // open card or a dark office. Pete, the Research member, is one of them:
    // he wears his own face now, so nobody calls him Ryan (owner, 2026-10-13).
    const quietPeople = () => chatCandidates(live.current.pods, live.current.gone, ACTIVE, ACTION_CLOCKING_IN);
    const podOfId = (id: string) => live.current.pods.find((p) => p.members.some((m) => m.id === id));
    const pickOne = (people: Agent[]) => {
      const others = people.length > 1 ? people.filter((x) => x.id !== lastSpeaker.current) : people;
      const a = others[Math.floor(Math.random() * others.length)];
      lastSpeaker.current = a.id;
      return a;
    };

    // One person says a line of their own.
    const say = () => {
      const idle = quietPeople();
      if (!idle.length) return;
      const a = pickOne(idle);
      show({ agentId: a.id, text: lines(a.character), ms: 8000 });
    };

    // Two people in different pods trade an exchange: each beat flies across
    // as a paper plane (envelopes are only ever real messages; owner,
    // 2026-10-04) and shows where it lands, held long enough to read while
    // the reply is on its way back.
    const chat = (): boolean => {
      const idle = quietPeople();
      if (idle.length < 2) return false;
      const a = pickOne(idle);
      const partners = idle.filter((b) => podOfId(b.id) !== podOfId(a.id));
      // The exchange picks the partner, so each side is said by someone who would.
      const pick = banter(a.character, partners.map((x) => x.character));
      if (!pick) return false;
      talk(a, partners[pick.partner], pick.beats);
      return true;
    };

    // Pete's first day welcome (peteWelcome.ts): after the owner turns Research
    // on, the first conversation that can be one of Pete's is, with someone in
    // another pod. Only the timer asks for it, never demo or lab banter, so a
    // demo cannot use it up. Nothing fits yet: the tick goes on as usual.
    const welcomeChat = (): boolean => {
      if (!welcomeArmed(browserStorage(), ROSTER_BOOT_HOME)) return false;
      const idle = quietPeople();
      const pete = idle.find((p) => p.id === RESEARCH_ID);
      if (!pete) return false;
      const others = idle.filter((b) => podOfId(b.id) !== podOfId(pete.id));
      const own = others.length ? banter(pete.character, others.map((x) => x.character), pete.character) : null;
      if (own) {
        lastSpeaker.current = pete.id;
        talk(pete, others[own.partner], own.beats, () => markWelcomed(browserStorage(), ROSTER_BOOT_HOME));
        return true;
      }
      for (const a of [...others].sort(() => Math.random() - 0.5)) {
        const pick = banter(a.character, [pete.character], pete.character);
        if (!pick) continue;
        lastSpeaker.current = a.id;
        talk(a, pete, pick.beats, () => markWelcomed(browserStorage(), ROSTER_BOOT_HOME));
        return true;
      }
      return false;
    };

    // Plays one exchange between a (who opens) and b; `thrown` runs once the
    // first beat is in the air.
    const talk = (a: Agent, b: Agent, beats: readonly string[], thrown?: () => void) => {
      const holdFor = (text: string) => Math.min(3600, Math.max(2000, 1200 + text.length * 50));
      busyUntil = Date.now() + beats.reduce((t, x) => t + FLIGHT_MS + holdFor(x), 0) + 2000;
      const play = (i: number) => {
        const [from, to] = i % 2 ? [b, a] : [a, b];
        // Someone got work mid conversation: it ends there.
        const still = quietPeople().map((x) => x.id);
        if (!still.includes(from.id) || !still.includes(to.id)) { busyUntil = 0; return; }
        if (!live.current.throwNote(from.id, to.id)) { busyUntil = 0; return; }
        if (i === 0) thrown?.();
        const text = beats[i];
        const last = i === beats.length - 1;
        const hold = holdFor(text);
        later(FLIGHT_MS, () => {
          show({ agentId: to.id, text, from: { name: from.name, acc: live.current.accentOf(from.id) }, ms: last ? hold + 1600 : hold + FLIGHT_MS + 300 });
          if (!last) later(hold, () => play(i + 1));
        });
      };
      play(0);
    };

    // The first comes soon after the office opens, then every 15 to 30 s:
    // a conversation a little over half the time, when two people are free.
    let first = true;
    const tick = () => {
      if (Date.now() < busyUntil) return;
      if (welcomeChat()) return;
      if (Math.random() < 0.55 && chat()) return;
      say();
    };
    const schedule = () => {
      const wait = first ? 8000 + Math.random() * 7000 : 15_000 + Math.random() * 15_000;
      first = false;
      timer = window.setTimeout(() => { tick(); schedule(); }, wait);
    };
    schedule();
    // Demo mode (and the design lab) can ask for a line, or a conversation, now.
    const banterNow = () => { if (!chat()) say(); };
    window.addEventListener('cth:demo-quote', say);
    window.addEventListener('cth:demo-banter', banterNow);
    return () => {
      window.clearTimeout(timer); window.clearTimeout(hide); timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('cth:demo-quote', say);
      window.removeEventListener('cth:demo-banter', banterNow);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  return quote;
}
