/**
 * Pulse's ways to save (docs/designs/team-performance.md, Recommendations): four
 * rules over the last 14 days, each shown only past its evidence minimum and
 * applied only by the owner's click. Never a cheaper model for Michael, never
 * across providers, never from a day whose records could not be saved (D15).
 * A dismissed suggestion returns only when its evidence crosses the next band
 * or 14 more days of data arrive (D13).
 *
 * Before 14 live days the same rules run in an early mode (owner, 2026-10-19,
 * eng D1): over the live days so far, each evidence minimum halved. What they
 * find shows as plain facts, never as a change to apply, and a model fact
 * names no model (eng D2).
 *
 * No electron or node imports: main calls it, tests load it directly.
 */

import type { ModelTier } from './modelCatalogPayload';

export const ADVICE_WINDOW_MS = 14 * 86_400_000;
/** Early patterns need half the evidence advice needs (owner, 2026-10-19, eng D1). */
export const EARLY_SCALE = 0.5;
/** The reopen rule's minimum of reopened cards. */
export const REOPEN_MIN = 3;
export const MIN_RUNS = 10;
export const MIN_INTERVAL_MS = 15 * 60_000;

/** One scheduled run, as the processor closed it. */
export interface RunFact {
  missionId: string;
  agentId: string;
  start: number;
  outcome: 'did-work' | 'nothing' | 'failed' | 'unknown';
  workCount: number;
  usd: number;
  /** Day of the run (YYYY-MM-DD), to leave out days with gaps. */
  day: string;
}

/** A schedule as advice needs it. */
export interface MissionFact {
  id: string;
  to: string;
  label: string;
  intervalMs: number;
  /** Set when the schedule runs at times or on weekdays (no clean halving). */
  timed: boolean;
}

/** One member's model and quality evidence. */
export interface MemberModelFact {
  agentId: string;
  provider: string;
  model: string | null;
  isGod: boolean;
  /** Pieces of work in the window (all kinds). */
  pieces: number;
  /** Mail decisions in the window (not cancelled). */
  mailDecisions: number;
  /** Kept as is share over drafts and cards, or null under 10 decisions. */
  keptShare: number | null;
  /** Kept as is decisions counted (drafts plus cards). */
  keptDecisions: number;
  reopens: number;
  usdPerWeek: number;
}

/** A catalog row as the ladder needs it (newest first, as the catalog lists). */
export interface LadderModel { provider: string; id: string; label: string; tier?: ModelTier }

export type AdviceKind = 'run-less' | 'run-more' | 'cheaper-model' | 'stronger-model';

export interface Advice {
  /** Stable id: rule, member and schedule. */
  id: string;
  kind: AdviceKind;
  agentId: string;
  missionId?: string;
  /** Evidence for the card and for dismiss bands. */
  evidence: { runs?: number; nothing?: number; didWork?: number; kept?: number; decisions?: number; reopens?: number };
  /** What one click changes. `editor` = open the schedule editor with the suggestion. */
  change:
    | { kind: 'interval'; fromMs: number; toMs: number }
    | { kind: 'editor'; direction: 'less' | 'more' }
    | { kind: 'model'; from: string | null; to: string; toLabel: string };
  /** Expected saving a week at API prices, when it can be worked out. */
  savesPerWeek: number | null;
  /** The evidence band a dismissal is pinned to. */
  band: number;
}

export interface Dismissal { id: string; band: number; at: number }

const TIER_ORDER: readonly ModelTier[] = ['small', 'middle', 'top'];

/** The newest model one tier up or down in the same provider, or null. */
export function nextTier(ladder: LadderModel[], provider: string, model: string | null, dir: -1 | 1): LadderModel | null {
  const mine = ladder.find((m) => m.provider === provider && m.id === model);
  if (!mine?.tier) return null;
  const want = TIER_ORDER[TIER_ORDER.indexOf(mine.tier) + dir];
  if (!want) return null;
  return ladder.find((m) => m.provider === provider && m.tier === want) ?? null;
}

/** Halve the evidence minimums (rounded up) over a shorter window: the early
 *  mode. Called without it, the rules are exactly the 14 day advice. */
export interface EarlyMode {
  /** The first live moment counted; the window runs from here to `now`. */
  from: number;
  /** 0.5 halves every evidence minimum (rounded up). */
  scale: number;
}

/** Every suggestion the evidence supports today, before dismissals. */
export function adviceFor(input: {
  now: number;
  runs: RunFact[];
  missions: MissionFact[];
  members: MemberModelFact[];
  ladder: LadderModel[];
  gapDays: string[];
  /** Price per million output tokens for a model, or undefined when unknown. */
  priceOf: (model: string) => number | undefined;
}, early?: EarlyMode): Advice[] {
  const since = early ? Math.max(early.from, input.now - ADVICE_WINDOW_MS) : input.now - ADVICE_WINDOW_MS;
  const min = (n: number): number => (early ? Math.ceil(n * early.scale) : n);
  const gaps = new Set(input.gapDays);
  const runs = input.runs.filter((r) => r.start >= since && !gaps.has(r.day) && r.outcome !== 'unknown');
  const out: Advice[] = [];

  for (const m of input.missions) {
    const mine = runs.filter((r) => r.missionId === m.id);
    if (mine.length < min(MIN_RUNS)) continue;
    const nothing = mine.filter((r) => r.outcome === 'nothing').length;
    const didWork = mine.filter((r) => r.outcome === 'did-work').length;
    const weeks = Math.max(1, input.now - since) / (7 * 86_400_000);
    const runUsdPerWeek = mine.reduce((s, r) => s + r.usd, 0) / weeks;
    if (nothing / mine.length >= 0.7) {
      out.push({
        id: `run-less:${m.to}:${m.id}`, kind: 'run-less', agentId: m.to, missionId: m.id,
        evidence: { runs: mine.length, nothing },
        change: m.timed ? { kind: 'editor', direction: 'less' } : { kind: 'interval', fromMs: m.intervalMs, toMs: m.intervalMs * 2 },
        savesPerWeek: runUsdPerWeek / 2,
        band: nothing
      });
      continue;
    }
    if (didWork / mine.length >= 0.9 && !m.timed && m.intervalMs / 2 >= MIN_INTERVAL_MS) {
      const mid = since + (input.now - since) / 2;
      const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
      const last = median(mine.filter((r) => r.start >= mid).map((r) => r.workCount));
      const prev = median(mine.filter((r) => r.start < mid).map((r) => r.workCount));
      if (prev > 0 && last >= prev * 1.3) {
        out.push({
          id: `run-more:${m.to}:${m.id}`, kind: 'run-more', agentId: m.to, missionId: m.id,
          evidence: { runs: mine.length, didWork },
          change: { kind: 'interval', fromMs: m.intervalMs, toMs: Math.max(MIN_INTERVAL_MS, m.intervalMs / 2) },
          savesPerWeek: null,
          band: didWork
        });
      }
    }
  }

  for (const p of input.members) {
    // Claude only for now (memory 2026-10-10: never across providers).
    if (p.provider !== 'claude' || !p.model) continue;
    const down = !p.isGod && p.pieces >= min(20) && p.mailDecisions >= min(10) && p.keptShare !== null && p.keptShare >= 0.9 && p.reopens === 0
      ? nextTier(input.ladder, p.provider, p.model, -1) : null;
    if (down) {
      const a = input.priceOf(p.model), b = input.priceOf(down.id);
      out.push({
        id: `cheaper-model:${p.agentId}`, kind: 'cheaper-model', agentId: p.agentId,
        evidence: { kept: Math.round((p.keptShare ?? 0) * p.keptDecisions), decisions: p.keptDecisions, reopens: 0 },
        change: { kind: 'model', from: p.model, to: down.id, toLabel: down.label },
        savesPerWeek: a !== undefined && b !== undefined && a > 0 ? p.usdPerWeek * (1 - b / a) : null,
        band: Math.floor(p.keptDecisions / 10)
      });
      continue;
    }
    const weak = (p.keptDecisions >= min(10) && p.keptShare !== null && p.keptShare < 0.6) || p.reopens >= min(REOPEN_MIN);
    const up = weak ? nextTier(input.ladder, p.provider, p.model, 1) : null;
    if (up) {
      out.push({
        id: `stronger-model:${p.agentId}`, kind: 'stronger-model', agentId: p.agentId,
        evidence: { kept: p.keptShare === null ? undefined : Math.round(p.keptShare * p.keptDecisions), decisions: p.keptDecisions, reopens: p.reopens },
        change: { kind: 'model', from: p.model, to: up.id, toLabel: up.label },
        savesPerWeek: null,
        band: Math.floor(p.keptDecisions / 10) + p.reopens
      });
    }
  }
  return out;
}

/** D13: a dismissed suggestion stays hidden until its band rises or 14 days pass. */
export function visibleAdvice(all: Advice[], dismissed: Dismissal[], now: number): Advice[] {
  const by = new Map(dismissed.map((d) => [d.id, d]));
  return all.filter((a) => {
    const d = by.get(a.id);
    return !d || a.band > d.band || now - d.at >= ADVICE_WINDOW_MS;
  });
}
