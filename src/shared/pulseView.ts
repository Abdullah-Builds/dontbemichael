/**
 * What the Pulse view receives (docs/designs/team-performance.md): shared by
 * main (src/main/pulse.ts builds it), preload and the renderer.
 *
 * No electron or node imports.
 */
import type { PulseSnapshot } from './teamPerformance';
import type { Advice } from './teamAdvice';
import type { KeptSafe } from './pulseSafety';
import type { Learning } from './teamLearning';
import type { FoundationsPulse } from './foundations';

export interface AppliedChange { id: number; adviceId: string; agentId: string; kind: string; before: unknown; after: unknown; at: number; undoneAt: number | null }

/** Compare (owner, 2026-10-16): the span before, measured by the same snapshot
 *  code as the period, up to the same day (D7, D9). */
export interface PulseCompare {
  snapshot: PulseSnapshot;
  keptSafe: KeptSafe;
}

export interface PulseView {
  available: boolean;
  billing: 'account' | 'apiKey';
  collectingSince: string | null;
  /** The first day Pulse recorded as things happened (a backfill reads the
   *  weeks before it); recommendations count from here. */
  liveSince: string | null;
  snapshot: PulseSnapshot;
  advice: Advice[];
  /** Before advice can show: what the advice rules see in the live days so far,
   *  at half their evidence, shown as facts with nothing to apply (owner,
   *  2026-10-19). Empty once advice can show. Missing from an older main. */
  early?: Advice[];
  /** Company foundations (office-foundations.md): the strip's jobs and each
   *  member's count, from harness.db. Missing from an older main. */
  foundations?: FoundationsPulse;
  /** When suggestions start (14 days after the first record), or null once they can show. */
  adviceFrom: string | null;
  saved: { state: 'none' } | { state: 'measuring'; firstAt: number } | { state: 'measured'; usd: number; since: number };
  headroom: { usedPct: number; resetsAt: number; runsOutAt: number | null } | null;
  applied: AppliedChange[];
  /** Each member's value per week for the last four weeks, oldest first. */
  trend: Record<string, number[]>;
  /** What the trust layer and the owner's settings stopped in the period. */
  keptSafe: KeptSafe;
  /** What the team learned and asked in the period (and the span before with
   *  Compare), plus what it holds in all. */
  learning: Learning;
  /** On a Claude plan with a known price: every dollar above is the member's
   *  part of the plan's real cost for the period, split by share of the work;
   *  `payPerUse` is what the same work would cost per use. Null on an API key
   *  (dollars are what was spent) or a plan with no known price. */
  plan: { label: string | null; monthly: number; source: 'owner' | 'detected'; periodCost: number; payPerUse: number } | null;
  /** The span before, when Compare is on and ready; else null. */
  compare: PulseCompare | null;
  /** Whether this period can compare: its span before starts on or after the
   *  first live recorded day (D8). */
  compareReady: boolean;
  /** The first day this period can compare, for the switch's (i); null with no live records. */
  compareFrom: string | null;
}

