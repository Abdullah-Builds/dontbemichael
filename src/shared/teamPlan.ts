/**
 * The pick-your-team step of onboarding, as plain data (Decisions 44, 47).
 *
 * Which agents start picked, which folder each one works in, what a picked team
 * needs connected, and what the finish step persists and creates. Kept out of
 * the wizard component so every rule here is testable without rendering it.
 */

import type { AgentDefinitionV2 } from './agentDefinition';
import type { OfficePack } from './officePack';

/**
 * Key for Michael's folder in the owner's override map. Michael's folder is the
 * business folder: every team member's default folder sits inside it
 * (src/shared/folderAccess.ts), so picking it moves those defaults too.
 */
export const OFFICE_KEY = '__office__';

/** Default absolute paths from main, all under `root` (Michael's folder). */
export interface FolderSuggestions {
  root: string;
  byFolder: Record<string, string>;
  /** The folder the owner picked for Michael can't hold an office; `root` is the default. */
  rootRefused?: boolean;
}

const trimSlash = (p: string) => p.replace(/[\\/]+$/, '');

/** Michael's folder: the owner's pick, or the suggested business folder. */
export function michaelFolderFor(
  suggestions: FolderSuggestions | undefined,
  overrides: Record<string, string>
): string | undefined {
  return overrides[OFFICE_KEY] ?? suggestions?.root;
}

/** True once the suggestions were worked out for the Michael folder now picked. */
function suggestionsCurrent(suggestions: FolderSuggestions | undefined, overrides: Record<string, string>): boolean {
  const picked = overrides[OFFICE_KEY];
  if (!suggestions) return false;
  return picked === undefined || (!suggestions.rootRefused && trimSlash(picked) === trimSlash(suggestions.root));
}

/** The folder NAME an agent works in: its pack's choice, or its role if the pack didn't say. */
export function folderNameFor(agent: Pick<AgentDefinitionV2, 'folder' | 'role'>): string {
  return agent.folder ?? agent.role;
}

/** Every distinct folder name the team could use, for asking main where each goes. */
export function folderNames(agents: AgentDefinitionV2[]): string[] {
  return [...new Set(agents.map(folderNameFor))];
}

/** The pack's suggested starting team: its `defaultPicks`, nothing else. */
export function initialPicks(pack: Pick<OfficePack, 'agents' | 'defaultPicks'>): Record<string, boolean> {
  const picks = new Set(pack.defaultPicks);
  return Object.fromEntries(pack.agents.map((a) => [a.id, picks.has(a.id)]));
}

/**
 * The absolute folder an agent will work in. The owner's pick wins; otherwise
 * the suggested `~/Documents/<Business>/<Folder>`. Undefined until main has
 * answered, so nothing is persisted against a folder we never resolved.
 */
export function folderFor(
  agent: Pick<AgentDefinitionV2, 'id' | 'folder' | 'role'>,
  suggestions: FolderSuggestions | undefined,
  overrides: Record<string, string>
): string | undefined {
  if (overrides[agent.id] !== undefined) return overrides[agent.id];
  return suggestionsCurrent(suggestions, overrides) ? suggestions?.byFolder[folderNameFor(agent)] : undefined;
}

/** Michael's folder once main has worked out the defaults under it. */
function businessFolderFor(
  suggestions: FolderSuggestions | undefined,
  overrides: Record<string, string>
): string | undefined {
  return suggestionsCurrent(suggestions, overrides) ? suggestions?.root : undefined;
}

/**
 * What the picked team needs connected, each account counted once. An account
 * one agent requires and another only wants is REQUIRED: it has to be set up
 * either way.
 */
export function connectionsNeeded(
  agents: AgentDefinitionV2[],
  picked: Record<string, boolean>
): { required: string[]; optional: string[] } {
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const a of agents) {
    if (!picked[a.id]) continue;
    for (const c of a.connections) (c.required ? required : optional).add(c.id);
  }
  for (const id of required) optional.delete(id);
  return { required: [...required], optional: [...optional] };
}

export type TeamPlan =
  | {
    ok: true;
    /** Michael's folder, the business folder. */
    business: string;
    /** Picked agents, each with the absolute folder it works in. */
    team: Array<{ agentId: string; folder: string }>;
    /** Every folder to make sure exists, Michael's first, each listed once. */
    folders: string[];
  }
  | { ok: false };

/**
 * What finish persists and creates. Not ready (`ok: false`) until Michael's
 * folder, and every picked agent's, is resolved.
 */
export function teamPlan(
  agents: AgentDefinitionV2[],
  picked: Record<string, boolean>,
  suggestions: FolderSuggestions | undefined,
  overrides: Record<string, string>
): TeamPlan {
  const business = businessFolderFor(suggestions, overrides);
  if (!business) return { ok: false };
  const team: Array<{ agentId: string; folder: string }> = [];
  for (const a of agents) {
    if (!picked[a.id]) continue;
    const folder = folderFor(a, suggestions, overrides);
    if (!folder) return { ok: false };
    team.push({ agentId: a.id, folder });
  }
  return { ok: true, business, team, folders: [...new Set([business, ...team.map((t) => t.folder)])] };
}

// ─── Starting a picked team member (Decision 44) ─────────────────────────────

/** "oscar" → "Oscar". The cast's display names are exactly this. */
export function teamMemberName(def: Pick<AgentDefinitionV2, 'id' | 'character'>): string {
  const base = def.character || def.id;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * The role an agent carries in the hive and on its roster card: its title and
 * the Role description Michael routes by (agent instructions audit,
 * 2026-09-25). A pack agent without one (an imported pack) falls back to its
 * card summary.
 */
export function teamMemberRole(def: Pick<AgentDefinitionV2, 'role' | 'summary' | 'routing'>): string {
  return `${def.role}: ${def.routing ?? def.summary}`;
}

/** `{Business}` and `{City}` filled in; a missing city drops cleanly. */
export function fillBusiness(text: string, business: { name?: string; city?: string }): string {
  const name = business.name?.trim() || 'the business';
  const city = business.city?.trim();
  return (city ? text.replace(/\{City\}/g, () => city) : text.replace(/,? ?\{City\}/g, ''))
    .replace(/\{Business\}/g, () => name);
}

/**
 * The standing goal (Work style): how this team member does its jobs, written
 * to it, from the pack's `workStyle` with the business filled in. It rides the
 * hook's goal channel, delivered at session start and when it changes, so an
 * owner's later edit takes effect without a restart. A pack agent without a
 * Work style (an imported pack) gets one built from its card fields.
 */
export function teamMemberGoal(
  def: Pick<AgentDefinitionV2, 'role' | 'summary' | 'does' | 'wontDo' | 'firstAction' | 'workStyle'>,
  business: { name?: string; city?: string }
): string {
  if (def.workStyle) return fillBusiness(def.workStyle, business);
  const where = business.name ? `${business.name}${business.city ? `, ${business.city}` : ''}` : 'the business';
  return [
    `The owner set this work style for your role at ${where}.`,
    `\nThe job: ${def.summary}`,
    def.does.length ? `\nWhat you do:\n${def.does.map((d) => `• ${d}`).join('\n')}` : '',
    def.wontDo.length ? `\nNeeds the owner's approval (send it to Michael first):\n${def.wontDo.map((d) => `• ${d}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * The one-time rewrite of existing team members (owner, 2026-09-25: "rewrite
 * all"). Every agent whose id is a pack member gets its Role description and
 * Work style replaced with today's pack text, the same text a new hire gets.
 * Michael and agents that match no pack are left alone. Returns only the agents
 * whose text actually changes. The roster is backed up before this is applied.
 */
export function rewrittenInstructions(
  agents: Array<{ id: string; description?: string; goal?: string; isGod?: boolean; isAssistant?: boolean }>,
  defs: Map<string, AgentDefinitionV2>,
  business: { name?: string; city?: string }
): Array<{ id: string; description: string; goal: string }> {
  const out: Array<{ id: string; description: string; goal: string }> = [];
  for (const a of agents) {
    if (a.isGod || a.isAssistant) continue;
    const def = defs.get(a.id);
    if (!def) continue;
    const description = teamMemberRole(def);
    const goal = teamMemberGoal(def, business);
    if (description === a.description && goal === a.goal) continue;
    out.push({ id: a.id, description, goal });
  }
  return out;
}

/** Card colours for the team, in pick order. Lemon is Michael's, so it goes last. */
const TEAM_ACCENTS = ['mint', 'sky', 'coral', 'lilac', 'peach', 'lemon'] as const;
export function teamAccent(index: number): (typeof TEAM_ACCENTS)[number] {
  return TEAM_ACCENTS[((index % TEAM_ACCENTS.length) + TEAM_ACCENTS.length) % TEAM_ACCENTS.length];
}

/**
 * Whether team start should start this member, and where.
 *
 * The floor decides, not the hive registry: a member already on the floor, in
 * its archived list, or waiting to be restored is left to the floor. The
 * registry's own `archived` flag is not a removal (every agent is archived when
 * the app quits), so a member the registry knows but the floor lost is started
 * again, in the folder the registry says it works in rather than the one setup
 * derived this time (2026-09-24).
 */
export function teamMemberStart(
  id: string,
  setupFolder: string,
  floorIds: ReadonlySet<string>,
  registryCwd?: string
): { start: false } | { start: true; cwd: string } {
  if (floorIds.has(id)) return { start: false };
  const known = typeof registryCwd === 'string' && registryCwd.trim() ? registryCwd : undefined;
  return { start: true, cwd: known ?? setupFolder };
}

/**
 * Michael's note when picked team members did not start. The owner hears it
 * through him (docs/designs/michael-only-notifications.md), and the app tries
 * those members again the next time the office opens.
 */
export function didNotStartNote(names: string[], again: boolean): { subject: string; body: string } {
  const one = names.length === 1;
  const who = one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return {
    subject: one ? `${who} did not start` : 'Team members did not start',
    body: `${who} did not start ${again ? 'again on this launch' : 'when the office opened'} and ${one ? 'is' : 'are'} not on the floor. The app tries again the next time the office opens. Tell the owner who is missing.`
  };
}
