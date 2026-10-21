/**
 * The jobs the hire wizard offers, as plain data (docs/designs/hire-redesign.md).
 *
 * A job is a title, the line Michael routes by, and a work style. It comes from
 * one of three places:
 *   - a teammate already in this office (their text as it is today, owner edits
 *     included: design D2),
 *   - a card in any office pack (every business, not just this one: point 4),
 *   - nothing ("Write a new job").
 * Copied text names the person it was written for ("Pam sorts the business
 * inbox"), so the copy swaps that name for the new hire's.
 *
 * Also here: the folder a hire gets (its own, suffixed on a clash: point 2) and
 * the instant, rules-only half of the distinct job check (D6). No electron or
 * node imports: the renderer and main use it, and tests load it directly.
 */

import type { AgentDefinitionV2 } from './agentDefinition';
import type { OfficePack } from './officePack';
import { splitAgentRole, joinAgentRole } from './agentRole';
import { teamMemberGoal, teamMemberName, folderNameFor } from './teamPlan';
import { OFFICE_ROLES } from './officeRoles';

export type HireJobSource = 'card' | 'team' | 'new';

export interface HireJob {
  /** `card:<businessType>/<cardId>`, `team:<agentId>`, or `new`. */
  key: string;
  source: HireJobSource;
  /** Job title: "Executive Admin". */
  title: string;
  /** The line Michael routes by ("what to send"). */
  routing: string;
  /** Work style, written to the agent. */
  workStyle: string;
  /** One sentence for the job list. */
  summary: string;
  /** Folder name the job works in by default ("Admin"). */
  folder?: string;
  modelTier?: 'best' | 'fast';
  /** The pack card this job traces back to: `<businessType>/<cardId>`. */
  sourceCard?: string;
  /** The person the text was written for; swapped for the new hire's name. */
  fromName?: string;
  /** Pack display name, for card jobs ("Restaurant & Food"). */
  business?: string;
  /** The teammate's character, for office jobs. */
  character?: string;
}

export const NEW_JOB_KEY = 'new';

/**
 * Who does a clone of a teammate's job (owner, 2026-10-03: the people already
 * on the team are greyed with "Clone", so nobody hires a second Dwight). The
 * first free person in the same job family (Dwight to Jim), else in the same
 * cast group, else anyone free, in the cast's order. Michael is the office
 * manager on every team, never a hire. Null when nobody is free.
 */
export function cloneCharacter(of: string, taken: ReadonlySet<string>, groups: ReadonlyArray<ReadonlyArray<string>>): string | null {
  const order = groups.flat().filter((c) => c !== 'michael' && !taken.has(c) && c !== of);
  const family = CHARACTER_CARD[of];
  const group = groups.find((g) => g.includes(of)) ?? [];
  return order.find((c) => !!family && CHARACTER_CARD[c] === family)
    ?? order.find((c) => group.includes(c))
    ?? order[0]
    ?? null;
}

/** The Who step's groups with a free person first, in their usual order, and
 *  the groups whose people are all on the team at the end (owner, 2026-10-03). */
export function freeGroupsFirst<T extends { members: readonly string[] }>(groups: readonly T[], taken: ReadonlySet<string>): T[] {
  const full = (g: T) => g.members.every((m) => taken.has(m));
  return [...groups.filter((g) => !full(g)), ...groups.filter(full)];
}

/** The first person free to hire, for the wizard's opening pick. */
export function firstFreeCharacter(preferred: string, taken: ReadonlySet<string>, groups: ReadonlyArray<ReadonlyArray<string>>): string {
  if (preferred !== 'michael' && !taken.has(preferred)) return preferred;
  return groups.flat().find((c) => c !== 'michael' && !taken.has(c)) ?? preferred;
}

/**
 * What "Write a new job" starts with: the job of the character the owner
 * picked (owner, 2026-10-03: picking Creed and writing a new job should keep
 * "Quality Control", for the owner to change). Their family's role and folder
 * from the office role map, the same ones every pack card uses; empty for a
 * character with no job family.
 */
export function newJobStart(character: string): { title: string; folder?: string } {
  const card = CHARACTER_CARD[character] as keyof typeof OFFICE_ROLES | undefined;
  const role = card ? OFFICE_ROLES[card] : undefined;
  return role ? { title: role.role, folder: role.folder } : { title: '' };
}

/**
 * Each character's own job: the pack card of their job family. Characters with
 * no card of their own (Erin, Jim, Kevin...) take their family's card, matching
 * the job each tile names (addAgent.castRole).
 */
export const CHARACTER_CARD: Readonly<Record<string, string>> = {
  pam: 'pam', erin: 'pam',
  dwight: 'dwight', jim: 'dwight', stanley: 'dwight', phyllis: 'dwight', andy: 'dwight',
  oscar: 'oscar', angela: 'oscar', kevin: 'oscar',
  kelly: 'kelly',
  ryan: 'ryan',
  toby: 'toby',
  nick: 'nick',
  sadiq: 'sadiq',
  creed: 'creed',
  meredith: 'meredith',
  darryl: 'darryl'
};

export interface Business { name?: string; city?: string }

function cardJob(pack: OfficePack, def: AgentDefinitionV2, business: Business): HireJob {
  return {
    key: `card:${pack.businessType}/${def.id}`,
    source: 'card',
    title: def.role,
    routing: (def.routing ?? def.summary).trim(),
    workStyle: teamMemberGoal(def, business),
    summary: def.summary,
    folder: folderNameFor(def),
    modelTier: def.modelTier,
    sourceCard: `${pack.businessType}/${def.id}`,
    fromName: teamMemberName(def),
    business: pack.displayName
  };
}

/**
 * Every card in every pack, this office's own pack first, then the others in
 * the order given, core last. A card whose text is the same as one already
 * listed (a business pack repeating core's) is shown once.
 */
export function cardJobs(
  packs: OfficePack[],
  core: OfficePack | undefined,
  businessType: string | undefined,
  business: Business
): HireJob[] {
  const own = packs.find((p) => p.businessType === businessType);
  const order = [own, ...packs.filter((p) => p !== own), core].filter((p): p is OfficePack => !!p);
  const seen = new Set<string>();
  const out: HireJob[] = [];
  for (const pack of order) {
    for (const def of pack.agents ?? []) {
      const job = cardJob(pack, def, business);
      const sig = `${job.title}\n${job.routing}\n${job.workStyle}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(job);
    }
  }
  return out;
}

export interface Teammate {
  id: string;
  name: string;
  character?: string;
  description?: string;
  goal?: string;
  cwd?: string;
  sourceCard?: string;
  isGod?: boolean;
  isAssistant?: boolean;
  archived?: boolean;
}

/** The team the owner works with: not Michael, his assistant or archived agents. */
export function activeTeam<T extends Teammate>(agents: T[]): T[] {
  return agents.filter((a) => !a.isGod && !a.isAssistant && !a.archived);
}

/** The pack card a teammate traces back to, if any: the one it was hired from,
 *  or the card with its id (setup starts pack members under their card's id). */
export function teammateCard(t: Teammate, cards: HireJob[]): string | undefined {
  if (t.sourceCard) return t.sourceCard;
  return cards.find((c) => c.sourceCard?.endsWith(`/${t.id}`))?.sourceCard;
}

/** Every teammate's job as it is today ("Your office"), teammates without a
 *  job line left out. */
export function teamJobs(agents: Teammate[], cards: HireJob[] = []): HireJob[] {
  const out: HireJob[] = [];
  for (const t of activeTeam(agents)) {
    const { role, roleDescription } = splitAgentRole(t.description);
    if (!role && !roleDescription) continue;
    const card = teammateCard(t, cards);
    const cardJob = card ? cards.find((c) => c.sourceCard === card) : undefined;
    out.push({
      key: `team:${t.id}`,
      source: 'team',
      title: role,
      routing: roleDescription,
      workStyle: t.goal ?? '',
      summary: cardJob?.summary ?? roleDescription,
      folder: cardJob?.folder ?? (role || undefined),
      modelTier: cardJob?.modelTier,
      sourceCard: card,
      fromName: t.name,
      character: t.character
    });
  }
  return out;
}

/**
 * The job a character comes with (D2): a teammate in this office doing that
 * character's family job first (their text as it stands), else the family card
 * from this office's pack, else from any pack. `cards` is cardJobs' order, so
 * the first matching card is this office's.
 */
export function ownJob(character: string, team: HireJob[], cards: HireJob[]): HireJob | undefined {
  const cardId = CHARACTER_CARD[character];
  if (!cardId) return undefined;
  const mate = team.find((j) => sameFamily(j, character));
  if (mate) return mate;
  return cards.find((c) => c.sourceCard?.split('/')[1] === cardId);
}

/**
 * True when an office job is in the character's job family (owner, 2026-09-27:
 * picking Erin, an Executive Admin, lists only the office's admin jobs). It
 * matches the card the job traces back to, or the teammate's own character, so
 * a job the owner wrote for Jim still lists under Jim's Sales family.
 */
export function sameFamily(job: HireJob, character: string): boolean {
  const cardId = CHARACTER_CARD[character];
  if (!cardId) return false;
  if (job.sourceCard?.split('/')[1] === cardId) return true;
  return !!job.character && CHARACTER_CARD[job.character] === cardId;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `from` swapped for `to` as a whole word: "Pam sorts" -> "Erin sorts", while
 *  "Pamphlet" stays. No-op when either name is empty or they are the same. */
const nameRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'gu');

export function swapName(text: string, from: string | undefined, to: string): string {
  const f = from?.trim();
  const t = to.trim();
  if (!text || !f || !t || f === t) return text;
  return text.replace(nameRe(f), () => t);
}

/**
 * A rename reaches the team's text (owner, 2026-10-03: "work style and role
 * should not mention the agent's own name; if the agent name is changed it may
 * create problems"). Today's packs name nobody, but a team member hired from
 * an older card, or a teammate's "that goes to <Name>" line, can still carry
 * the old name: each such role line and Work style gets the new one. Returns
 * only the agents whose text changes.
 */
export function renamePatches(
  agents: Array<{ id: string; description?: string; goal?: string }>,
  from: string,
  to: string
): Array<{ id: string; description?: string; goal?: string }> {
  const out: Array<{ id: string; description?: string; goal?: string }> = [];
  for (const a of agents) {
    const description = a.description ? swapName(a.description, from, to) : a.description;
    const goal = a.goal ? swapName(a.goal, from, to) : a.goal;
    if (description === a.description && goal === a.goal) continue;
    out.push({ id: a.id, ...(description !== a.description ? { description } : {}), ...(goal !== a.goal ? { goal } : {}) });
  }
  return out;
}

/** A job copied for `name`: its routing line and work style name them. */
export function jobFor(job: HireJob, name: string): { title: string; routing: string; workStyle: string } {
  return {
    title: job.title,
    routing: swapName(job.routing, job.fromName, name),
    workStyle: swapName(job.workStyle, job.fromName, name)
  };
}

/**
 * A new team member's id: their name as lowercase letters, digits and hyphens,
 * then a time stamp so two hires with one name never collide. Accents are
 * dropped first ("Óscar" becomes "oscar", not "-scar"), and a name with no
 * Latin letters or digits left (小王, سارة) falls back to "agent". The id never
 * starts with a hyphen: it is passed to command line tools as an argument
 * (`mempalace mine ... --wing <id> --agent <id>`), and an argument that starts
 * with a hyphen is read as an option, so that agent's memory never got indexed.
 */
export function hireAgentId(name: string, now: number = Date.now()): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'agent'}-${now.toString(36)}`;
}

/** One folder name, safe on every system: no path separators or characters
 *  Windows forbids, no leading dots, at most 60 characters. "AR/AP Clerk"
 *  becomes "AR-AP Clerk", never a folder inside a folder. The trailing-dot
 *  and trailing-space strip runs again AFTER the length cut: a name sliced
 *  mid-word can end in a '.' or ' ' that Windows silently drops, so the
 *  folder on disk would not match the name the office shows for it. */
export function safeFolder(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '').trim().slice(0, 60).replace(/[.\s]+$/, '');
}

/**
 * The folder a new hire gets (point 2): the job's folder name if nothing uses
 * it yet, else `<Folder>_<Name>`, then `<Folder>_<Name>_2`, ... `taken` answers
 * whether a folder name is already on disk or in use by a teammate.
 */
export function hireFolderName(base: string, name: string, taken: (folder: string) => boolean): string {
  const b = base.trim() || name.trim() || 'Team';
  if (!taken(b)) return b;
  // Trailing dots and spaces come off too: Windows drops them silently, so
  // "Jim." would land on disk as "Jim" while the office keeps showing "Jim.".
  const n = name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/[.\s]+$/, '');
  const first = n ? `${b}_${n}` : `${b}_2`;
  if (!taken(first)) return first;
  for (let i = 2; i < 100; i++) {
    const next = `${first}_${i}`;
    if (!taken(next)) return next;
  }
  return `${first}_${Date.now().toString(36)}`;
}

// ─── The distinct job check, rules half (D6) ─────────────────────────────────

export interface JobProfile {
  name: string;
  title: string;
  routing: string;
  workStyle?: string;
  mailbox?: string;
}

const STOP = new Set(('a an and are as at be by for from goes here in is it its not of on or so '
  + 'that the their them then this to was what when where which who with you your send sends '
  + 'sorts handles every any all one owner business').split(' '));

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** Shared content words over all content words (0..1). */
export function lineSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

export const SIMILAR_LINES = 0.5;

/** Teammates the new job overlaps by the instant rules: what to send lines that
 *  share most of their words. The title is never compared: a job is the work
 *  it takes, so renaming "Sales Director" to "Sales Director1" changes nothing
 *  (owner, 2026-09-27). Names are left out so "Dwight runs" and "Jim runs"
 *  match. */
export function overlapsByRules(job: JobProfile, team: JobProfile[]): string[] {
  const strip = (text: string, ...names: string[]) =>
    names.filter((n) => n.trim()).reduce((t, n) => t.replace(nameRe(n.trim()), ' '), text);
  const out: string[] = [];
  for (const m of team) {
    if (lineSimilarity(strip(job.routing, job.name, m.name), strip(m.routing, job.name, m.name)) >= SIMILAR_LINES) out.push(m.name);
  }
  return out;
}

/** What a binding adds: the new hire's line gains the scope, each overlapping
 *  teammate's line gains "Not for ...; that goes to <Name>." */
export function bindingLines(binding: string, name: string): { own: string; others: string } {
  const b = binding.trim().replace(/[.\s]+$/, '');
  return { own: `Only ${b}.`, others: `Not for ${b}; that goes to ${name}.` };
}

// Lazy up to the fixed ending, so a scope with a period or a semicolon
// ("orders over $1.5k", "refunds; returns") matches too.
const bindingRe = (n: string) => new RegExp(`\\s*Not for (?:(?!Not for ).)+?; that goes to ${escapeRe(n)}\\.(?![\\p{L}\\p{N}])`, 'gu');

/** The "Not for ...; that goes to <name>." lines in one teammate's role line,
 *  so they can be put back if that hire returns (ship review 2026-10-03). */
export function bindingLinesFor(name: string, description: string | undefined): string[] {
  const n = name.trim();
  if (!n || !description) return [];
  return (description.match(bindingRe(n)) ?? []).map((l) => l.trim());
}

type WithLines = { id: string; releasedBindings?: Array<{ id: string; line: string }> };

/**
 * Hires that just came back onto the floor with released binding lines. The
 * spawn that brings a closed hire back builds a fresh roster entry and drops
 * the archived one, so the lines are read from the entry it had before.
 */
export function returningBindings(
  prev: { agents: WithLines[]; archived: WithLines[]; restorable: WithLines[] },
  next: WithLines[]
): Array<{ id: string; lines: Array<{ id: string; line: string }> }> {
  const before = new Set(prev.agents.map((a) => a.id));
  const kept = new Map([...prev.archived, ...prev.restorable].map((a) => [a.id, a.releasedBindings]));
  return next
    .filter((a) => !before.has(a.id))
    .map((a) => ({ id: a.id, lines: a.releasedBindings?.length ? a.releasedBindings : kept.get(a.id) ?? [] }))
    .filter((r) => r.lines.length > 0);
}

/**
 * The role lines a returning hire's released bindings put back: each line goes
 * back once, only on a teammate still here, never twice on the same line.
 */
export function restoredRoles<T extends { id: string; description?: string }>(lines: Array<{ id: string; line: string }>, team: T[]): Array<{ id: string; description: string }> {
  const next = new Map<string, string>();
  for (const { id, line } of lines) {
    const mate = team.find((a) => a.id === id);
    if (!mate) continue;
    const current = next.get(id) ?? mate.description ?? '';
    if (current.includes(line)) continue;
    const split = splitAgentRole(current);
    next.set(id, hireRole(split.role, appendOnce(split.roleDescription, line)));
  }
  return [...next].map(([id, description]) => ({ id, description }));
}

/**
 * The teammates' role lines without the bindings that send work to `name`,
 * for when that hire leaves (owner, 2026-10-03): "Not for catering enquiries;
 * that goes to Creed." would otherwise send Michael's routing to nobody. The
 * bound hire's own "Only ..." goes with them. Lines are matched by the name, so
 * bindings made before this are cleaned too; a rename keeps them matching
 * (renamePatches). Only the teammates whose line changes are returned.
 */
export function releaseBindings<T extends { id: string; description?: string }>(name: string, team: T[]): Array<{ id: string; description: string }> {
  const n = name.trim();
  if (!n) return [];
  const re = bindingRe(n);
  const out: Array<{ id: string; description: string }> = [];
  for (const t of team) {
    const d = t.description ?? '';
    const next = d.replace(re, '').trim();
    if (next !== d.trim()) out.push({ id: t.id, description: next });
  }
  return out;
}

/** `line` with `extra` appended once (no duplicate on a second bind). */
export function appendOnce(line: string, extra: string): string {
  const l = line.trim();
  if (!extra || l.includes(extra)) return l;
  if (!l) return extra;
  // A line the owner left without a full stop gets one, so the added sentence
  // never runs into theirs ("data issues Only the data in HubSpot.").
  return `${/[.!?:;)"'”’]$/.test(l) ? l : `${l}.`} ${extra}`;
}

/** The stored role line for a hire. */
export function hireRole(title: string, routing: string): string {
  return joinAgentRole(title, routing);
}

// ─── The distinct job check, AI half (prompt and answer; the call is main's) ─

export interface DistinctVerdict {
  distinct: boolean;
  overlapsWith: string[];
  why: string;
  suggestion?: string;
  /** 'ai' when the hidden Claude check answered; 'rules' when it could not. */
  source: 'ai' | 'rules';
}

export function distinctPrompt(job: JobProfile, team: JobProfile[]): string {
  const clip = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const lines = team.map((m) =>
    `- ${m.name}: title "${clip(m.title, 80)}"; what to send: "${clip(m.routing, 500)}"`
    + `${m.mailbox ? `; mailbox ${m.mailbox}` : ''}; work style: "${clip(m.workStyle, 600)}"`);
  return [
    'You check whether a new team member\'s job overlaps anyone already on a small business\'s AI team.',
    'The office manager routes each piece of work by reading every teammate\'s "what to send" line, so two teammates whose lines cover the same work make routing a coin toss and double the work.',
    'A job is distinct when a request could only sensibly go to one of them: a different area of work, or the same area bound to something particular such as its own mailbox, a named channel, a customer group, a location or a topic.',
    'Judge only by what to send and the work style. The job title and the person\'s name never make a job distinct: the same work under another title is an overlap.',
    '',
    'The team today:',
    ...(lines.length ? lines : ['- (nobody yet)']),
    '',
    `The new hire, ${job.name}:`,
    `title "${clip(job.title, 80)}"; what to send: "${clip(job.routing, 500)}"${job.mailbox ? `; mailbox ${job.mailbox}` : ''}; work style: "${clip(job.workStyle, 1200)}"`,
    '',
    'Answer with ONE JSON object and nothing else:',
    '{"distinct": true or false, "overlapsWith": ["names of teammates whose work overlaps"], "why": "one plain sentence for the owner", "suggestion": "one short way to make the new job particular, or empty"}',
    'Use plain words and no dashes.'
  ].join('\n');
}

/** The JSON verdict from the model's answer, names limited to the team's.
 *  Null when the answer holds no usable verdict. */
export function parseDistinctAnswer(text: string, teamNames: string[]): DistinctVerdict | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.distinct !== 'boolean') return null;
  const known = new Map(teamNames.map((n) => [n.toLowerCase(), n]));
  const overlapsWith = Array.isArray(o.overlapsWith)
    ? [...new Set(o.overlapsWith.filter((x): x is string => typeof x === 'string')
      .map((x) => known.get(x.trim().toLowerCase())).filter((x): x is string => !!x))]
    : [];
  const distinct = o.distinct && overlapsWith.length === 0;
  return {
    distinct,
    overlapsWith: distinct ? [] : overlapsWith,
    why: typeof o.why === 'string' ? o.why.trim().slice(0, 400) : '',
    suggestion: typeof o.suggestion === 'string' && o.suggestion.trim() ? o.suggestion.trim().slice(0, 300) : undefined,
    source: 'ai'
  };
}
