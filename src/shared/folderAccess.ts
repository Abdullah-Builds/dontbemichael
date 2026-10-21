/**
 * Who may open and change which folder in an office (owner, 2026-09-25).
 *
 *  - Every agent's folder is private: only that agent (and anyone sharing the
 *    folder, which agents in the same role do by default) and anyone above it
 *    can open it. Michael's folder is no exception: only he and the owner (who
 *    isn't an agent) open it.
 *  - Michael works in the business folder (`~/Documents/<Business>`), and every
 *    team member's folder sits inside it by default. He is the only boss today.
 *  - A boss can READ a team member's folder but not change it. To get a file
 *    into it, the boss asks the team member.
 *  - Company wide information, policies and rules are shared through the
 *    knowledge feature, which every agent searches; no folder is shared.
 *
 * One pure module feeds both layers that enforce this:
 *  - `folderPolicy` becomes the Claude Code settings for a spawn: the OS
 *    sandbox (which covers shell commands, even in auto mode, on a Mac and
 *    Linux; Claude Code has no sandbox on Windows, so shell commands are not
 *    limited there, owner 2026-10-09) plus permission deny rules (which cover
 *    Claude's own file tools on every platform).
 *  - `folderDecision` is asked by the PreToolUse hook on every file tool call,
 *    so it sees folders created after the agent started, and it covers Michael's
 *    own top-level files, which a static rule can't express without also hiding
 *    the folders inside it.
 *
 * Kept in one place so a later owner-defined sharing screen can replace the
 * rules without touching the plumbing.
 */

import { RESEARCH_ID, RESEARCH_NAME } from './research';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface FolderLayout {
  /** Michael's folder: the business folder. Undefined on an office without one. */
  business?: string;
  /** Every team member's working folder (never Michael's), each once. */
  teamFolders: string[];
  /** The app's own private folder (`<harnessHome>/private`, issue #63): agents'
   *  mail tokens and the owner's sent questions. No agent, Michael included,
   *  opens or changes it. */
  appPrivate?: string;
  /** The app's own program and settings folders: the hook program
   *  (`<harnessHome>/hive/bin`), which Claude Code runs outside the sandbox on
   *  every tool call, and each agent's Claude settings
   *  (`<harnessHome>/agent-settings`), which set its sandbox at its next start
   *  (issue 100). Any agent may read them; none, Michael included, changes them. */
  appLocked?: string[];
  /** The engine's record of every session: its projects folder and its prompt
   *  history. The engine writes both itself; no agent, Michael included, opens
   *  them with its tools, so nobody reads a teammate's conversation. */
  engineRecords?: { projects: string; history: string };
}

export interface AgentFolderPolicy {
  /** `sandbox.filesystem` additions for Claude Code. */
  sandbox: { denyWrite: string[]; denyRead: string[]; allowRead: string[] };
  /** `permissions.deny` rules, e.g. `Read(//Users/a/Documents/Biz/Finance/**)`. */
  deny: string[];
  /** No shell command may run outside the sandbox (`allowUnsandboxedCommands:
   *  false`). Without it, an agent in auto mode can rerun a command with the
   *  sandbox off and read any folder (owner, 2026-09-25). Team members only. */
  sandboxOnly: boolean;
  /** The members whose hive folders `deny` covers, as the roster stood when
   *  the agent started (withMemberWall). A Read rule hides a folder from the
   *  agent's searches too (live check, Claude Code 2.1.302), but rules are read
   *  once at start, so the hook covers anyone hired since. */
  walledMembers?: string[];
}

export interface FolderAgent {
  isGod: boolean;
  /** The folder the agent works in. */
  cwd: string;
}

/** Claude's file tools that only read. */
export const FOLDER_READ_TOOLS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
/** Claude's file tools that write. */
export const FOLDER_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The Claude Code settings that hold an agent to its folders. */
export function folderPolicy(agent: FolderAgent, layout: FolderLayout, caseInsensitive: boolean): AgentFolderPolicy {
  const same = sameFn(caseInsensitive);
  const inside = insideFn(caseInsensitive);
  const policy: AgentFolderPolicy = { sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: !agent.isGod };
  // Nobody opens the app's private folder: a sibling's live mail token sits
  // there while it runs (#63). Claude's CLI still reads its own --mcp-config.
  if (layout.appPrivate) {
    policy.sandbox.denyRead.push(layout.appPrivate);
    policy.sandbox.denyWrite.push(layout.appPrivate);
    policy.deny.push(rule('Read', layout.appPrivate), rule('Edit', layout.appPrivate));
  }
  for (const f of layout.appLocked ?? []) {
    policy.sandbox.denyWrite.push(f);
    policy.deny.push(rule('Edit', f));
  }
  if (layout.engineRecords) {
    const { projects, history } = layout.engineRecords;
    policy.sandbox.denyRead.push(projects, history);
    policy.sandbox.denyWrite.push(projects, history);
    policy.deny.push(rule('Read', projects), rule('Edit', projects), fileRule('Read', history), fileRule('Edit', history));
  }

  if (agent.isGod) {
    // Read everything; change nothing that belongs to a team member.
    for (const f of teamFoldersOf(layout, same)) {
      if (inside(f, agent.cwd)) continue; // never lock Michael out of his own folder
      policy.sandbox.denyWrite.push(f);
      policy.deny.push(rule('Edit', f));
    }
    return policy;
  }

  const own = agent.cwd;
  const others = teamFoldersOf(layout, same).filter((f) => !same(f, own) && !inside(f, own));
  // Michael's folder, except this agent's own. allowRead wins over denyRead in
  // Claude's sandbox, so the agent keeps its own folder when it sits inside
  // Michael's.
  if (layout.business && !inside(own, layout.business)) {
    policy.sandbox.denyRead.push(layout.business);
    policy.sandbox.allowRead.push(own);
  }
  for (const f of others) {
    policy.sandbox.denyRead.push(f);
    policy.deny.push(rule('Read', f), rule('Edit', f));
  }
  return policy;
}

/**
 * Whether one file tool call is allowed. `target` is absolute. Reasons go
 * straight back to the agent, so each one says what to do instead.
 */
export function folderDecision(
  agent: FolderAgent,
  layout: FolderLayout,
  tool: string,
  target: string,
  caseInsensitive: boolean,
  godName = 'Michael'
): { deny: boolean; reason?: string } {
  const writes = FOLDER_WRITE_TOOLS.has(tool);
  if (!writes && !FOLDER_READ_TOOLS.has(tool)) return { deny: false };
  const same = sameFn(caseInsensitive);
  const inside = insideFn(caseInsensitive);
  const teamFolder = teamFoldersOf(layout, same).find((f) => inside(f, target));

  if (layout.appPrivate && inside(layout.appPrivate, target)) {
    return { deny: true, reason: 'That folder is the app\'s own and holds private settings. Nobody on the team opens it.' };
  }
  if (writes && (layout.appLocked ?? []).some((f) => inside(f, target))) {
    return { deny: true, reason: 'That folder holds the app\'s own program and settings. You can read it, but nobody on the team changes it.' };
  }
  const records = layout.engineRecords;
  if (records && (inside(records.projects, target) || same(records.history, target))) {
    return { deny: true, reason: 'That is where every team member\'s conversations are kept, so nobody on the team opens it.' };
  }

  if (agent.isGod) {
    if (writes && teamFolder && !inside(teamFolder, agent.cwd)) {
      return {
        deny: true,
        reason: 'Team members\' folders are theirs to change. You can read this one, but to get something into it, ask the team member it belongs to.'
      };
    }
    return { deny: false };
  }

  const own = agent.cwd;
  if (inside(own, target)) return { deny: false };
  if (teamFolder) {
    return {
      deny: true,
      reason: `That folder belongs to another team member, and only they and ${godName} can open it. If you need something from it, ask ${godName}.`
    };
  }
  if (layout.business && inside(layout.business, target)) {
    return {
      deny: true,
      reason: `That is ${godName}'s folder, and only ${godName} can open it. If you need something from it, ask ${godName}.`
    };
  }
  return { deny: false };
}

/**
 * The computer's temporary folders (ship review D6.1): Claude Code keeps a
 * session's scratch files and command output there unless told otherwise, so
 * Research's file tools open none of them. Its own session files live in its
 * desk (RESEARCH_TMP_DIR) and every other office agent's in its own folder
 * under the app's home (AGENT_TMP_DIR), both set with CLAUDE_CODE_TMPDIR.
 */
export function tempFolders(platform: string, tmpdir: string): string[] {
  const posix = platform === 'darwin'
    ? ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders']
    : ['/tmp', '/var/tmp'];
  return Array.from(new Set([...(platform === 'win32' ? [] : posix), tmpdir].filter((f) => !!f && isAbsolute(f))));
}

/** The temporary folders Research's shell is walled from: all but /tmp, where
 *  Claude Code's shell keeps its own working files whatever the settings say
 *  (live check 2026-10-13: with /tmp walled, every command fails). */
export function shellTempWalls(platform: string, tmpdir: string): string[] {
  return tempFolders(platform, tmpdir).filter((f) => f !== '/tmp' && f !== '/private/tmp');
}

/** A file tool saving into the shared temporary folders while Research is on
 *  (owner, D7.2): Research's shell can read /tmp, so another agent saves its
 *  scratch work in its own folder instead and carries on there. */
export function sharedTempWriteDecision(temps: string[], ownTmp: string, ownCwd: string | undefined, tool: string, target: string, caseInsensitive: boolean, name: string = RESEARCH_NAME): { deny: boolean; reason?: string } {
  if (!FOLDER_WRITE_TOOLS.has(tool)) return { deny: false };
  const inside = insideFn(caseInsensitive);
  // Its own folders stay open, even in an office that sits in a temp folder.
  if ([ownTmp, ownCwd].some((f) => f && inside(f, target))) return { deny: false };
  if (!temps.some((f) => f && inside(f, target))) return { deny: false };
  return { deny: true, reason: `While ${name} is on, the shared temporary folders are closed for saving. Save it in your own scratch folder, ${ownTmp}, and carry on from there.` };
}

/** A save aimed at the shared temporary folders, judged on the file it names
 *  (`//tmp`, `/./tmp` and `..` resolve first): the fail closed checks use it
 *  when the app's own check can't run (the hook program has the same pattern). */
export function isSharedTempSave(tool: string, input: unknown, cwd?: string): boolean {
  if (!FOLDER_WRITE_TOOLS.has(tool)) return false;
  const target = folderToolTarget(tool, input, cwd) ?? '';
  return /^(?:\/private)?\/(?:tmp|var\/tmp|var\/folders)(?:\/|$)/i.test(target);
}

/** Another agent's session scratch folder (`<home>/agent-tmp/<id>`, D6.1):
 *  its command output and scratch files are its own, like its team folder
 *  (ship review pass 2). Michael reads everything, as with team folders. */
export function agentTmpDecision(home: string, agentId: string, isGod: boolean, tool: string, target: string, caseInsensitive: boolean): { deny: boolean; reason?: string } {
  if (isGod || (!FOLDER_WRITE_TOOLS.has(tool) && !FOLDER_READ_TOOLS.has(tool))) return { deny: false };
  const inside = insideFn(caseInsensitive);
  const all = join(home, AGENT_TMP_DIR);
  if (!inside(all, target) || inside(join(all, agentTmpName(agentId)), target)) return { deny: false };
  return { deny: true, reason: 'That is another team member\'s scratch folder, and only they can open it. Use your own.' };
}

/** Where an office agent's Claude session keeps its scratch files: under the
 *  app's home, outside the hive, one folder per agent. */
export const AGENT_TMP_DIR = 'agent-tmp';

/** An agent's own folder name inside AGENT_TMP_DIR: its id when that is a
 *  plain short name, else a short safe form of it with a checksum, so a hire
 *  with a long name still gets a folder (Codex review, second ship). */
export function agentTmpName(id: string): string {
  // A Windows device name (con, nul, com1) can't be a folder there.
  if (/^[\w-]{1,64}$/.test(id) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(id)) return id;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${id.replace(/[^\w-]/g, '_').slice(0, 40)}-${h.toString(36)}`;
}
/** Research's, inside its desk. */
export const RESEARCH_TMP_DIR = '.tmp';

/**
 * Research's walls (issue #230, eng review R1): it uses the internet, so it
 * opens nothing of the office. `walled` are the folders it may not open (the
 * app's home with the hive, the business folder, team folders, the shared
 * memory and company knowledge); `own` its own folders inside them (its agent
 * folder and its desk), which the sandbox opens again. Its shell writes only
 * its own folders (hive.sandboxWritableDirs), and the hook judges its file
 * tools (researchFolderDecision), since a deny rule can't be opened again.
 */
export function researchFolderPolicy(walled: string[], own: string[], home?: string): AgentFolderPolicy {
  const clean = (l: string[]) => Array.from(new Set(l.filter((f) => !!f && isAbsolute(f)).map((f) => resolve(f))));
  // A second layer under the hook's write allowlist: permission rules can't
  // reopen a folder they deny, so they name the riskiest places outside its
  // own folders instead, where a write would reach other agents or the owner's
  // shell (ship review D2.6).
  const risky = home && isAbsolute(home)
    ? ['.claude', '.config', '.ssh', 'Library'].map((d) => rule('Edit', join(home, d)))
      .concat(['.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile'].map((f) => `Edit(/${resolve(home, f).replace(/\\/g, '/').replace(/^\/?/, '/')})`))
    : [];
  return { sandbox: { denyWrite: [], denyRead: clean(walled), allowRead: clean(own) }, deny: risky, sandboxOnly: true };
}

/** One file tool call by Research: it writes only its own folders (an
 *  allowlist, ship review D2.6), and reads its own folders or anything outside
 *  and above no wall (the home folder is walled, D2.5). */
export function researchFolderDecision(walled: string[], own: string[], tool: string, target: string, caseInsensitive: boolean, writeOwn: string[] = own): { deny: boolean; reason?: string } {
  const writes = FOLDER_WRITE_TOOLS.has(tool);
  if (!writes && !FOLDER_READ_TOOLS.has(tool)) return { deny: false };
  const inside = insideFn(caseInsensitive);
  // It reads its whole folder but writes only where its shell may: the app
  // keeps the rest (identity, memory index, cursor, skills; Codex review,
  // third ship).
  if ((writes ? writeOwn : own).some((f) => f && inside(f, target))) return { deny: false };
  if (writes) {
    return { deny: true, reason: 'You save files only in your own desk and notes folder. Put what you write there.' };
  }
  // A search from a folder above a wall (Grep on "/" or "/Users") reads what
  // the wall holds, so it is refused too.
  if (walled.some((f) => f && (inside(f, target) || inside(target, f)))) {
    return { deny: true, reason: 'You work only from the internet and your own folder: the office\'s files, task board and memory are kept from you on purpose. Everything you need is in the message you were sent.' };
  }
  return { deny: false };
}

/** Every other agent's guard on Research's folders (eng review R2, owner
 *  2026-10-13): they are Research's alone. Nobody else writes into them, so
 *  nothing reaches Research without the trust layer, and nobody else reads
 *  them, so nothing leaves Research without it either. */
export function withResearchWall(policy: AgentFolderPolicy, researchFolders: string[]): AgentFolderPolicy {
  const dirs = Array.from(new Set(researchFolders.filter((f) => !!f && isAbsolute(f)).map((f) => resolve(f))));
  return {
    ...policy,
    sandbox: {
      ...policy.sandbox,
      denyWrite: Array.from(new Set([...policy.sandbox.denyWrite, ...dirs])),
      denyRead: Array.from(new Set([...policy.sandbox.denyRead, ...dirs]))
    },
    deny: Array.from(new Set([...policy.deny, ...dirs.flatMap((d) => [rule('Edit', d), rule('Read', d)])]))
  };
}

/** Each team member's hive folder is its own (owner, 2026-10-16: a member's
 *  memory is private, Michael's included in the rule): its shell reads no other
 *  member's folder and not the hive's git history, which keeps every member's
 *  notes over time; its own folder stays open, since allowRead wins over
 *  denyRead in Claude's sandbox. Its file tools get a Read rule on every other
 *  member's folder and the history, so a search over the hive leaves them out;
 *  the hook (memberWallDecision) also judges each call, members hired later
 *  included. */
export function withMemberWall(policy: AgentFolderPolicy, hiveRoot: string, ownId: string, memberIds: string[]): AgentFolderPolicy {
  if (!hiveRoot || !isAbsolute(hiveRoot)) return policy;
  const agents = resolve(hiveRoot, 'agents');
  const git = resolve(hiveRoot, '.git');
  const members = Array.from(new Set(memberIds.filter(Boolean)));
  const others = members.filter((id) => id !== ownId).map((id) => resolve(agents, id));
  return {
    ...policy,
    walledMembers: members,
    sandbox: {
      ...policy.sandbox,
      denyRead: Array.from(new Set([...policy.sandbox.denyRead, agents, git])),
      allowRead: Array.from(new Set([...policy.sandbox.allowRead, resolve(agents, ownId)]))
    },
    deny: Array.from(new Set([...policy.deny, rule('Read', git), ...others.map((d) => rule('Read', d))]))
  };
}

/** A search the hook can't narrow: Claude Code's Grep and Glob over a folder. */
const SEARCH_TOOLS: ReadonlySet<string> = new Set(['Grep', 'Glob']);

/** A file tool reaching into another member's hive folder or the hive's git
 *  history, by any agent, Michael included (owner, 2026-10-16). Writes there
 *  are the harness guard's to judge; this keeps reads out.
 *
 *  A search over a folder that holds every member's (the hive, the app's
 *  home, the user's home) is left to the Read rules the agent started with,
 *  which hide those members' folders from its results. Given the roster
 *  (`members`) and who those rules cover (`walled`, null when unknown), such a
 *  search is refused while anyone hired since is not covered: the hook can't
 *  take their files out of a result, only refuse the call. */
export function memberWallDecision(hiveRoot: string, agentId: string, tool: string, target: string, caseInsensitive: boolean, nameOf: (id: string) => string,
  roster?: { members: readonly string[]; walled: readonly string[] | null }): { deny: boolean; reason?: string } {
  if (!hiveRoot || (!FOLDER_READ_TOOLS.has(tool) && !FOLDER_WRITE_TOOLS.has(tool))) return { deny: false };
  const inside = insideFn(caseInsensitive);
  const git = resolve(hiveRoot, '.git');
  if (inside(git, target)) {
    return { deny: true, reason: 'The hive\'s git history keeps every team member\'s notes, so it is closed to everyone. To learn what a teammate knows, send them a "query" message.' };
  }
  const agents = resolve(hiveRoot, 'agents');
  const same = (a: string, b: string): boolean => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (roster && SEARCH_TOOLS.has(tool) && inside(target, agents)) {
    const walled = roster.walled ?? [];
    const late = roster.members.filter((id) => id && !same(id, agentId) && !walled.some((w) => same(w, id)));
    if (late.length) {
      const names = late.map(nameOf).join(', ');
      return { deny: true, reason: `${names} joined after this session started, so a search over every team member's folder could reach their notes. Search a folder that holds only your own files or the shared ones (the board, the task list), or ask ${late.length === 1 ? 'them' : 'each of them'} with a "query" message. Your next session covers them.` };
    }
  }
  if (!inside(agents, target)) return { deny: false };
  const owner = relative(agents, resolve(target)).split(/[\\/]/)[0];
  if (!owner || same(owner, agentId)) return { deny: false };
  const name = nameOf(owner);
  return { deny: true, reason: `That is ${name}'s own folder: their notes, memory and inbox are theirs alone. To learn what ${name} knows, send them a "query" message.` };
}

/** A team member's shell reads no other agent's session scratch folder
 *  (ship review pass 2); its own stays open, since allowRead wins over
 *  denyRead in Claude's sandbox. Michael's shell reads them, as team folders. */
export function withAgentTmpWall(policy: AgentFolderPolicy, home: string, agentId: string, isGod: boolean): AgentFolderPolicy {
  if (isGod || !home || !isAbsolute(home)) return policy;
  const all = resolve(home, AGENT_TMP_DIR);
  return {
    ...policy,
    sandbox: {
      ...policy.sandbox,
      denyRead: Array.from(new Set([...policy.sandbox.denyRead, all])),
      allowRead: Array.from(new Set([...policy.sandbox.allowRead, join(all, agentTmpName(agentId))]))
    }
  };
}

/** A file tool reaching into Research's folders, by anyone but Research. */
export function researchWallDecision(researchFolders: string[], tool: string, target: string, caseInsensitive: boolean, name: string = RESEARCH_NAME): { deny: boolean; reason?: string } {
  const writes = FOLDER_WRITE_TOOLS.has(tool);
  if (!writes && !FOLDER_READ_TOOLS.has(tool)) return { deny: false };
  const inside = insideFn(caseInsensitive);
  // A search over a folder that holds Research's (the hive, the app's home)
  // stays open: the Read deny rules withResearchWall writes keep its files
  // out of the results.
  if (researchFolders.some((f) => f && inside(f, target))) {
    return {
      deny: true,
      reason: writes
        ? `That is ${name}'s folder. To ask ${name} something, write a message to "${RESEARCH_ID}" in your own outbox; the app checks it and delivers it.`
        : `That is ${name}'s folder, and only ${name} reads it. What ${name} finds reaches you in their messages, after the app checks them.`
    };
  }
  return { deny: false };
}

/** A Claude Code permission rule for everything under an absolute folder. */
function rule(tool: 'Read' | 'Edit', folder: string): string {
  const p = resolve(folder).replace(/\\/g, '/');
  // Absolute paths are written with a leading `//` in permission rules.
  return `${tool}(/${p.startsWith('/') ? p : `/${p}`}/**)`;
}

/** The same rule for one file. */
function fileRule(tool: 'Read' | 'Edit', file: string): string {
  return rule(tool, file).slice(0, -4) + ')';
}

/** Team folders, each once, never Michael's folder itself. */
function teamFoldersOf(layout: FolderLayout, same: (a: string, b: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of layout.teamFolders) {
    if (!f || !isAbsolute(f)) continue;
    if (layout.business && same(f, layout.business)) continue;
    if (out.some((o) => same(o, f))) continue;
    out.push(resolve(f));
  }
  return out;
}

function sameFn(ci: boolean) {
  const n = (p: string) => (ci ? resolve(p).toLowerCase() : resolve(p));
  return (a: string, b: string) => n(a) === n(b);
}

/** `insideFn(ci)(parent, child)`: child is parent or anything under it. */
function insideFn(ci: boolean) {
  const n = (p: string) => (ci ? resolve(p).toLowerCase() : resolve(p));
  return (parent: string, child: string) => {
    const rel = relative(n(parent), n(child));
    // `..x` is a name inside the parent; only `..` itself or `../…` climbs out.
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
}

/**
 * The absolute path a file tool call touches, or null if it names none (a Grep
 * or Glob with no path runs in the agent's own folder). A Glob is judged by the
 * part of its pattern before the first wildcard.
 */
export function folderToolTarget(tool: string, input: unknown, cwd: string | undefined): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  // Trimmed first, as Claude Code reads a path (its expandPath trims, then
  // expands ~): " /Users/x" is the folder /Users/x, never one inside the
  // agent's own (red team, ship review pass 3).
  const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim().length > 0 ? (o[k] as string).trim() : null);
  let p = str('file_path') ?? str('notebook_path') ?? str('path');
  if (tool === 'Glob') {
    // Judged by the part before the first wildcard, relative or not and with
    // or without a path: `../Finance/**` lists another folder's files.
    const pattern = str('pattern');
    const cut = pattern ? pattern.search(/[*?[{]/) : -1;
    const prefix = pattern ? (cut === -1 ? pattern : pattern.slice(0, cut)) : '';
    if (prefix) p = p && !isAbsolute(prefix) && !prefix.startsWith('~/') && !prefix.startsWith('~\\') ? join(p, prefix) : prefix;
  }
  if (!p) return null;
  if (typeof process !== 'undefined') {
    const home = process.env.HOME || process.env.USERPROFILE || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : null);
    if (home) {
      if (p === '~') p = home;
      else if (p.startsWith('~/') || p.startsWith('~\\')) p = resolve(home, p.slice(2));
    }
  }
  return isAbsolute(p) ? resolve(p) : cwd ? resolve(cwd, p) : null;
}
