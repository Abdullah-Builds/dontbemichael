/**
 * Is the app's home folder (config.harnessHome) still there, with the office
 * inside it?
 *
 * Checked at launch BEFORE the hive is bootstrapped. Bootstrapping creates the
 * hive skeleton with mkdir -p, so if the owner moved or deleted the folder the
 * app used to rebuild an EMPTY office at the old path, silently: the team came
 * back with no memory, tasks or history. Now a missing office skips that, and
 * the renderer shows the "we can't find your office" screen instead of the
 * floor. Every normal launch goes straight in, with no picker (owner,
 * 2026-09-24).
 *
 * Plain node:fs, no electron import, so it tests as a node module.
 */
import { cpSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { privateOwnerDir, privateRoot } from '../shared/agentPrivatePaths';

export interface HomeFolderStatus {
  path: string | null;
  /** The folder itself exists (and is a folder). */
  exists: boolean;
  /** It holds an office the app made: hive/registry.json, written on first bootstrap. */
  hasOffice: boolean;
}

export function homeFolderStatus(path: string | null | undefined): HomeFolderStatus {
  if (!path) return { path: null, exists: false, hasOffice: false };
  let exists = false;
  try { exists = statSync(path).isDirectory(); } catch { exists = false; }
  const hasOffice = exists && existsSync(join(path, 'hive', 'registry.json'));
  return { path, exists, hasOffice };
}

/**
 * Whether launch may bootstrap the office in place. Before onboarding there is
 * nothing to lose (and no home yet), so it is fine; after onboarding the office
 * must actually be there.
 */
export function homeReadyAtLaunch(cfg: { onboardingComplete?: boolean; harnessHome?: string | null }): boolean {
  if (!cfg.onboardingComplete) return true;
  return homeFolderStatus(cfg.harnessHome).hasOffice;
}

/**
 * Copy an office into a new home folder ("Move my office here"). Throws if a
 * copy fails, so the caller can stay on the old home.
 *
 * roster.json + its backups ride along with hive/palace: the roster is the
 * renderer's half of the same state, and leaving it behind would move the
 * agents' sessions and memory to the new home while their names, notes and
 * worktree paths stayed at the old one. The board guard and the house rules
 * each agent has heard ride along, so a move neither resends old reminders nor
 * forgets a Done card. The owner's questions to Michael and their state live
 * outside the hive, in private/owner (#63), so they are copied too: without
 * them the conversation with Michael came up empty after a move.
 * Pulse's held list (private/held.jsonl) moves too, so its history is not lost,
 * and so do the Company foundations record and its list of owner messages.
 * private/agent-mcp stays behind on purpose: it holds mail tokens, which are
 * written again each time a team member starts.
 */
export function copyOfficeData(oldHome: string, newHome: string): void {
  const pairs = ['hive', 'palace', 'roster.json', 'roster-backups'].map((sub): [string, string] => [join(oldHome, sub), join(newHome, sub)]);
  for (const f of ['card-guard.json', 'house-rules-seen.json', 'research-stamp.key', 'research-threads.json', 'research-outbox', 'held.jsonl', 'checked.jsonl', 'checked-archive', 'checked-backfill.json', 'foundations.json', 'owner-said.jsonl']) pairs.push([join(privateRoot(oldHome), f), join(privateRoot(newHome), f)]);
  pairs.push([privateOwnerDir(oldHome), privateOwnerDir(newHome)]);
  for (const [src, dest] of pairs) {
    if (!existsSync(src)) continue;
    // cpSync copies the whole tree incl. .git and is cross-device safe (unlike
    // renameSync, which throws EXDEV across volumes). We COPY, never delete —
    // the old folder stays as a safety net the user removes manually.
    cpSync(src, dest, { recursive: true, force: true, dereference: false });
  }
}
