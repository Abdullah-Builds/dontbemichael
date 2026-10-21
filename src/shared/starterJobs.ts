/**
 * Starter jobs: the schedules a pack gives a team member when it is hired
 * (inbox zero, owner 2026-10-03). How often a job runs is the schedule's,
 * never the Work style's; what to concentrate on in each run is the job's
 * focus area (docs/designs/schedule-focus-areas.md).
 *
 * A pack writes the timing in words tied to its own office hours, so a
 * restaurant's "during office hours" means its long day and a consultancy's
 * its weekdays:
 *   "every 2h during office hours"  on the office days, between opening and closing
 *   "18:00 on office days"          once, at that time, on the office days
 *   "mon 09:00", "weekdays 08:30"   a fixed day list and time
 */
import { cleanFocus, parseWhen, missionsFor, OWNER, type ScheduledMission } from './missions';

export interface StarterHours { days: string[]; work: { start: string; end: string } }
export interface StarterJob { agentId: string; title: string; schedule: string; focus: string }

/** A starter job's timing as a schedule, or null when the words don't parse. */
export function parseStarterSchedule(schedule: string, hours: StarterHours): ReturnType<typeof parseWhen> {
  const s = schedule.trim().toLowerCase();
  const every = /^every (\d+\s*(?:m|min|h|hr|hours?))\s+during office hours$/.exec(s);
  if (every) return parseWhen({ every: every[1].replace(/\s+/g, ''), days: hours.days, between: [hours.work.start, hours.work.end] });
  const daily = /^(\d{1,2}:\d{2}) on office days$/.exec(s);
  if (daily) return parseWhen({ days: hours.days, at: daily[1] });
  const fixed = /^([a-z,\s]+?)\s+(\d{1,2}:\d{2})$/.exec(s);
  if (fixed) return parseWhen({ days: fixed[1].split(/[\s,]+/).filter(Boolean), at: fixed[2] });
  return null;
}

/**
 * The schedules a hire gets from its pack card: each starter job for `defId`,
 * owned by `to` (the new team member's id), skipping a job it already has by
 * the same name. Created as the owner's, since the owner chose the hire.
 */
export function starterMissionsFor(
  jobs: StarterJob[] | undefined,
  hours: StarterHours,
  defId: string,
  to: string,
  existing: ScheduledMission[],
  godId: string,
  newId: (i: number) => string
): ScheduledMission[] {
  const have = new Set(missionsFor(existing, to, godId).map((m) => m.label.trim().toLowerCase()));
  const out: ScheduledMission[] = [];
  for (const job of jobs ?? []) {
    if (job.agentId !== defId || have.has(job.title.trim().toLowerCase())) continue;
    const when = parseStarterSchedule(job.schedule, hours);
    const focus = cleanFocus(job.focus);
    if (!when || !focus) continue;
    out.push({
      id: newId(out.length),
      label: job.title.trim(),
      intervalMs: when.intervalMs,
      ...(when.weekly ? { weekly: when.weekly } : {}),
      ...(when.times ? { times: when.times } : {}),
      to,
      body: '',
      focus,
      enabled: true,
      createdBy: OWNER
    });
    have.add(job.title.trim().toLowerCase());
  }
  return out;
}

/** Only the Office Pack fields needed to suggest jobs without importing the
 * pack validator (which already imports parseStarterSchedule from this file). */
export interface StarterSuggestionPack {
  businessType: string;
  agents: Array<{ id: string }>;
  officeHours: StarterHours;
  starterMissions?: StarterJob[];
}

export interface StarterSuggestion {
  job: StarterJob;
  hours: StarterHours;
}

/** Suggestions belong to the card this teammate was hired from. Original team
 * members have no sourceCard, so use their office's pack, then core. Only
 * valid, distinct jobs appear, with at most three choices in an empty tab. */
export function starterSuggestionsFor(
  packs: StarterSuggestionPack[],
  businessType: string | undefined,
  agentId: string,
  sourceCard?: string,
  limit = 3
): StarterSuggestion[] {
  const [sourceType, sourceId] = sourceCard?.split('/') ?? [];
  const definitionId = sourceCard ? sourceId : agentId;
  const hasCard = (p: StarterSuggestionPack, id: string | undefined) =>
    !!id && p.agents.some((a) => a.id === id);
  const preferred = packs.find((p) => p.businessType === businessType && hasCard(p, agentId));
  const core = packs.find((p) => p.businessType === 'core' && hasCard(p, agentId));
  const pack = sourceCard
    ? packs.find((p) => p.businessType === sourceType && hasCard(p, definitionId))
    : preferred?.starterMissions?.some((job) => job.agentId === agentId) ? preferred : core ?? preferred;
  if (!pack || !definitionId) return [];
  const seen = new Set<string>();
  return (pack.starterMissions ?? [])
    .filter((job) => {
      if (job.agentId !== definitionId || !parseStarterSchedule(job.schedule, pack.officeHours) || !cleanFocus(job.focus)) return false;
      const title = job.title.trim().toLowerCase();
      if (seen.has(title)) return false;
      seen.add(title);
      return true;
    })
    .slice(0, limit)
    .map((job) => ({ job, hours: pack.officeHours }));
}

/** A suggested job is only a proposal: saving it must never start a run.
 * Use the same parser, focus and duplicate guard as jobs seeded at hire. */
export function pausedStarterMission(
  suggestion: StarterSuggestion,
  to: string,
  existing: ScheduledMission[],
  godId: string,
  newId: (i: number) => string
): ScheduledMission | null {
  const [mission] = starterMissionsFor(
    [suggestion.job], suggestion.hours, suggestion.job.agentId, to, existing, godId, newId
  );
  return mission ? { ...mission, enabled: false } : null;
}

/** Keep offering the remaining starters while this member only has jobs matching
 * its pack. Compare the job itself, not runtime state (enabled, last run, etc.),
 * so an unrelated custom job, including one with a starter's name, hides them. */
export function remainingStarterMissions(
  starters: StarterSuggestion[],
  to: string,
  existing: ScheduledMission[],
  godId: string,
  newId: (i: number) => string
): ScheduledMission[] {
  const candidates = starters.flatMap((starter, i) => {
    const mission = pausedStarterMission(starter, to, [], godId, () => newId(i));
    return mission ? [mission] : [];
  });
  const mine = missionsFor(existing, to, godId);
  const sameJob = (a: ScheduledMission, b: ScheduledMission) =>
    a.label.trim().toLowerCase() === b.label.trim().toLowerCase()
    && cleanFocus(a.focus) === cleanFocus(b.focus)
    && !a.body && (!a.kind || a.kind === 'dispatch')
    && a.intervalMs === b.intervalMs
    && JSON.stringify(a.weekly) === JSON.stringify(b.weekly)
    && JSON.stringify(a.times) === JSON.stringify(b.times);
  if (mine.some((mission) => !candidates.some((candidate) => sameJob(mission, candidate)))) return [];
  const have = new Set(mine.map((mission) => mission.label.trim().toLowerCase()));
  return candidates.filter((mission) => !have.has(mission.label.trim().toLowerCase())).slice(0, 3);
}
