/**
 * The harness folder is plumbing only (Decision 48) — the "block" half.
 *
 * Agents are TOLD where their work belongs (the folder line in their prompt);
 * this refuses a file-writing tool call that lands in the harness folder anyway,
 * unless it is one of the few files the hive protocol itself tells agents to
 * write. The refusal reason goes straight back to the agent, so it names where
 * the work should go instead and the agent can correct itself.
 *
 * LIMITS, stated plainly:
 *  - Only Claude's file tools (Write/Edit/MultiEdit/NotebookEdit) are checked.
 *    A shell command that writes a file can't be judged from its text.
 *  - The PreToolUse hook fails OPEN for these file tools when the agent's shim
 *    can't reach the app's socket, so this is a strong guard, not an airtight
 *    one. (MCP and MCP resource calls fail closed instead: see HOOK_SHIM and
 *    docs/designs/claude-connectors.md, D8.)
 *
 * No electron import. The hook server supplies the paths.
 */

import { existsSync, lstatSync, readlinkSync, realpathSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { AGENT_TMP_DIR, agentTmpName } from '../shared/folderAccess';
import { ALLOW_TEMP_WORKERS } from '../shared/buildFeatures';
import { isSameOrInside } from './pathInside';

/** Claude's tools that write a file at a path given in their input. */
export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const MAX_SYMLINK_HOPS = 40;

export interface HarnessWriteInput {
  tool: string;
  toolInput: unknown;
  /** The agent's working directory, from the hook payload. Relative paths resolve against it. */
  cwd?: string;
  agentId: string;
  isGod: boolean;
  harnessHome: string;
  hiveRoot: string;
  /** macOS and Windows file systems ignore case; Linux does not. */
  caseInsensitive: boolean;
}

function expandTildePath(p: string): string {
  const t = p.trim();
  if (t === '~') return homedir();
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(homedir(), t.slice(2));
  return t;
}

function realpathNativeSync(p: string): string {
  return typeof realpathSync.native === 'function' ? realpathSync.native(p) : realpathSync(p);
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Canonicalize an absolute path, following both existing symlinks and DANGLING
 * symlinks (whose target does not exist on disk yet).
 *
 * Why `realpathSync` alone is not enough:
 *  1. For a new file that does not exist yet, `realpathSync` throws ENOENT, so we
 *     walk up to the deepest existing ancestor on disk and re-attach the tail.
 *  2. For a DANGLING symlink (e.g. `<cwd>/link.json -> <hiveRoot>/tasks.json`
 *     when `tasks.json` does not exist yet), `realpathSync` ALSO throws ENOENT,
 *     even though the symlink itself exists on disk (`lstatSync` succeeds and
 *     `isSymbolicLink()` is true). Walking past it would misclassify the write
 *     as landing in `<cwd>`. Instead, we read the symlink target with
 *     `readlinkSync`, re-attach the tail, and continue resolving hops.
 *  3. For synthetic unit-test paths whose ancestors do not exist on disk at all,
 *     this walks up to the filesystem root and returns `resolve(absPath)`,
 *     preserving 100% compatibility with pure lexical tests.
 */
export function resolveCanonicalPath(absPath: string): { path: string; symlinkLoop: boolean } {
  let curr = resolve(absPath);
  for (let hop = 0; hop < MAX_SYMLINK_HOPS; hop++) {
    try {
      return { path: realpathNativeSync(curr), symlinkLoop: false };
    } catch {
      // Target or an ancestor does not exist (or is a dangling symlink).
    }

    let probe = curr;
    const tail: string[] = [];
    let hopped = false;

    for (;;) {
      const st = lstatOrNull(probe);
      if (st != null) {
        if (st.isSymbolicLink()) {
          let linkTarget: string;
          try {
            linkTarget = readlinkSync(probe);
          } catch {
            return { path: curr, symlinkLoop: true };
          }
          const resolvedLink = isAbsolute(linkTarget)
            ? resolve(linkTarget)
            : resolve(dirname(probe), linkTarget);
          curr = tail.length ? resolve(resolvedLink, ...tail) : resolvedLink;
          hopped = true;
          break;
        }
        // `probe` exists and is not a symlink; canonicalize `probe` (in case a
        // parent directory of `probe` is a symlink) and re-attach the non-existent tail.
        try {
          const realBase = realpathNativeSync(probe);
          return {
            path: tail.length ? resolve(realBase, ...tail) : realBase,
            symlinkLoop: false
          };
        } catch {
          // A parent of `probe` is a broken link; keep walking up to find it.
        }
      }

      const parent = dirname(probe);
      if (parent === probe) {
        return { path: curr, symlinkLoop: false };
      }
      tail.unshift(basename(probe));
      probe = parent;
    }

    if (!hopped) {
      return { path: curr, symlinkLoop: false };
    }
  }

  return { path: curr, symlinkLoop: true };
}

/**
 * True if any path component strictly below `rootDir` is a symbolic link on disk.
 * Mirrors `hasSymlinkComponent` in `src/main/fs.ts`: coordination files inside
 * `hive/` are plain files/dirs, never symlinks.
 */
function hasSymlinkComponentBelow(rootDir: string, targetPath: string): boolean {
  const rel = relative(rootDir, targetPath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
  let cur = rootDir;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cur = resolve(cur, part);
    try {
      if (lstatSync(cur).isSymbolicLink()) return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return true;
    }
  }
  return false;
}

export function harnessWriteDecision(i: HarnessWriteInput): { deny: boolean; reason?: string } {
  if (!GUARDED_TOOLS.has(i.tool)) return { deny: false };
  const rawTarget = targetPath(i.toolInput, i.cwd);
  if (!rawTarget) return { deny: false };

  const norm = (p: string) => (i.caseInsensitive ? p.toLowerCase() : p);
  const realHarnessHome = resolveCanonicalPath(expandTildePath(i.harnessHome)).path;
  const realHiveRoot = resolveCanonicalPath(expandTildePath(i.hiveRoot)).path;
  const resolvedTarget = resolveCanonicalPath(rawTarget);
  const canonicalTarget = resolvedTarget.path;

  const rawInHarness = isSameOrInside(norm(resolve(expandTildePath(i.harnessHome))), norm(rawTarget));
  const canonicalInHarness = isSameOrInside(norm(realHarnessHome), norm(canonicalTarget));

  // Neither the lexical path nor the canonical symlink-resolved target touches harnessHome.
  if (!rawInHarness && !canonicalInHarness) return { deny: false };

  // Its own scratch folder, where its Claude session keeps temp files (ship
  // review D6.1: no longer the shared /tmp). Judged by canonical path too so a
  // symlink inside scratch pointing into the hive or out of scratch is not exempted.
  const rawScratch = resolve(expandTildePath(i.harnessHome), AGENT_TMP_DIR, agentTmpName(i.agentId));
  const realScratch = resolveCanonicalPath(rawScratch).path;
  const rawInScratch = isSameOrInside(norm(rawScratch), norm(rawTarget));
  const canonicalInScratch = isSameOrInside(norm(realScratch), norm(canonicalTarget));
  if (rawInScratch && canonicalInScratch && !resolvedTarget.symlinkLoop) {
    return { deny: false };
  }

  // Refuse symlink loops or symlinks inside harnessHome that point outside harnessHome.
  if (!resolvedTarget.symlinkLoop && canonicalInHarness) {
    const rawInHive = isSameOrInside(norm(resolve(expandTildePath(i.hiveRoot))), norm(rawTarget));
    const canonicalInHive = isSameOrInside(norm(realHiveRoot), norm(canonicalTarget));

    // Never allow a symlink inside hiveRoot to redirect a plumbing write.
    const symlinkInHive =
      (rawInHive && hasSymlinkComponentBelow(resolve(expandTildePath(i.hiveRoot)), rawTarget)) ||
      (canonicalInHive && hasSymlinkComponentBelow(realHiveRoot, canonicalTarget));

    if (!symlinkInHive && canonicalInHive) {
      const rel = relative(norm(realHiveRoot), norm(canonicalTarget)).split(/[\\/]/).join('/');
      const targetExists = () =>
        existsSync(canonicalTarget) ||
        lstatOrNull(canonicalTarget) != null ||
        lstatOrNull(rawTarget) != null;
      if (isPlumbing(rel, norm(i.agentId), i.isGod, i.tool, targetExists)) {
        return { deny: false };
      }
    }
  }

  const resolvedCwd = i.cwd ? resolveCanonicalPath(expandTildePath(i.cwd)).path : undefined;
  const workHere =
    i.cwd && resolvedCwd && !isSameOrInside(norm(realHarnessHome), norm(resolvedCwd))
      ? ` (${i.cwd})`
      : '';
  return {
    deny: true,
    reason:
      `The hive folder is only for coordination: your memory/inbox.md, your inbox and outbox, ${i.isGod ? 'tasks.json, board.md and the triage folder' : 'and one new file per filing in the triage folder; Michael alone writes tasks.json, so tell him what changed'}. Your memory index (memory.md) is kept by the app: add notes to memory/inbox.md instead. ` +
      `Save documents, drafts and other work in your own folder${workHere} instead.`
  };
}

/**
 * The files the hive protocol tells an agent to write (PROTOCOL.md and the
 * injected prompt). Everything else in the hive is the app's to write.
 */
function isPlumbing(rel: string, agentId: string, isGod: boolean, tool: string, exists: () => boolean): boolean {
  const own = `agents/${agentId}/`;
  // An agent adds notes to its memory inbox; the index (memory.md) is the
  // app's to write (memoryTidy.ts).
  if (rel === `${own}memory/inbox.md`) return true;
  // The handoff it writes before its conversation is cleared (safeClearer.ts).
  if (rel === `${own}memory/handoff.md`) return true;
  if (rel.startsWith(`${own}outbox/`) || rel.startsWith(`${own}inbox/`)) return true;
  // A team member files what its work needs as one new file in triage/
  // (card-lifecycle.md section 10); Michael files them away in triage/.done/.
  // Written once: a new JSON file named with the agent's own id, never an
  // edit, never over a filing already there (its own or another agent's).
  const filing = rel.startsWith('triage/') ? rel.slice('triage/'.length) : '';
  if (tool === 'Write' && filing.endsWith(`-${agentId}.json`) && !filing.includes('/') && !filing.startsWith('.') && !exists()) return true;
  if (isGod && rel.startsWith('triage/.done/')) return true;
  // Michael alone writes the board (ship review D8).
  if (isGod && rel === 'tasks.json') return true;
  // Michael is the board's sole scribe, and the only one who files spawn
  // requests, in a build that has them (ALLOW_TEMP_WORKERS).
  if (isGod && (rel === 'board.md' || (ALLOW_TEMP_WORKERS && rel.startsWith('spawn-requests/')))) return true;
  return false;
}

/** The absolute path a tool call would write, or null if it names none. */
function targetPath(input: unknown, cwd: string | undefined): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as { file_path?: unknown; notebook_path?: unknown };
  const raw = typeof o.file_path === 'string' ? o.file_path : typeof o.notebook_path === 'string' ? o.notebook_path : null;
  if (!raw) return null;
  const p = expandTildePath(raw);
  // resolve() also collapses `..`, so `outbox/../../board.md` is judged as board.md.
  if (isAbsolute(p)) return resolve(p);
  return cwd ? resolve(expandTildePath(cwd), p) : null;
}
