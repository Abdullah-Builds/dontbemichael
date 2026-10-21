/**
 * `<harnessHome>/office.json`, the office's own record (src/shared/officeRecord.ts).
 *
 * Plain node:fs, no electron import, so it tests as a node module.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  configMatchesRegistry,
  officeRecordFromConfig,
  officeRecordFromRegistry,
  parseOfficeRecord,
  sameOfficeRecord,
  type OfficeConfigFields,
  type OfficeRecord,
  type RegistryAgentFields
} from '../shared/officeRecord';
import { homeFolderStatus } from './homeFolder';
import type { FolderLayout } from '../shared/folderAccess';
import { claudeProjectsRoot, engineHistoryFile } from './transcript';

export function officeRecordPath(home: string): string {
  return join(home, 'office.json');
}

/** The record in this office folder, or null when there is none (or it is unreadable). */
export function readOfficeRecord(home: string): OfficeRecord | null {
  try {
    const p = officeRecordPath(home);
    if (!existsSync(p)) return null;
    return parseOfficeRecord(JSON.parse(readFileSync(p, 'utf8')));
  } catch {
    return null;
  }
}

/** Write the record: temp file then rename, so a crash never leaves half a file. */
export function writeOfficeRecord(home: string, rec: OfficeRecord): void {
  const p = officeRecordPath(home);
  const tmp = `${p}.tmp`;
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(tmp, JSON.stringify(rec, null, 2), 'utf8');
    renameSync(tmp, p);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* noop */ }
    throw e;
  }
}

/**
 * Keep office.json in step with the config: written when setup has finished and
 * the office's description changed, left alone otherwise. Returns whether it
 * wrote. Never throws: a record that cannot be saved must not break a config save.
 */
export function syncOfficeRecord(cfg: OfficeConfigFields): boolean {
  const rec = officeRecordFromConfig(cfg);
  const home = cfg.harnessHome;
  if (!rec || !home) return false;
  // A save that switches offices only (harnessHome) never gets here: callers
  // sync on saves that touch the office's own fields (touchesOffice).
  // Only an office that exists gets a record. Setup makes the home folder
  // before it saves, and a missing office must not be recreated as a stray file.
  if (!existsSync(home)) return false;
  try {
    if (sameOfficeRecord(readOfficeRecord(home), rec)) return false;
    writeOfficeRecord(home, rec);
    return true;
  } catch (e) {
    console.error('[office] could not save office.json:', e);
    return false;
  }
}

/**
 * At launch: give an office set up before office.json existed its record, but
 * only when the config's team really is this office's team (its registry has
 * each member in the same folder). Several offices share one config, so
 * without that check a switch between them could label one with another's team.
 */
export function backfillOfficeRecord(cfg: OfficeConfigFields): boolean {
  const home = cfg.harnessHome;
  if (!home || !existsSync(home) || readOfficeRecord(home)) return false;
  const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';
  if (!configMatchesRegistry(cfg, readRegistryAgents(home), caseInsensitive)) return false;
  return syncOfficeRecord(cfg);
}

function readRegistryAgents(home: string): Record<string, RegistryAgentFields> | undefined {
  try {
    const p = join(home, 'hive', 'registry.json');
    if (!existsSync(p)) return undefined;
    const reg = JSON.parse(readFileSync(p, 'utf8')) as { agents?: unknown };
    return reg.agents && typeof reg.agents === 'object'
      ? (reg.agents as Record<string, RegistryAgentFields>)
      : undefined;
  } catch {
    return undefined;
  }
}

export interface FoundOffice {
  path: string;
  hasOffice: boolean;
  /** How the office describes itself, or null when there is no team to continue. */
  record: OfficeRecord | null;
  /** Where the record came from: its own file, or its hive registry. */
  source: 'file' | 'registry' | null;
}

/** Folders an office record may never send an agent into, whatever it says:
 *  the disk root, the home folder itself, and the places that hold keys and
 *  app settings. A record is a file in a folder that could have been copied or
 *  synced from elsewhere, so its folders are checked before setup offers them. */
export function isUsableTeamFolder(folder: string, home = homedir()): boolean {
  if (!isAbsolute(folder)) return false;
  // Follow links (a folder that is a link into ~/.ssh is ~/.ssh), and compare
  // ignoring case where the disk does: on macOS and Windows ~/LIBRARY is ~/Library.
  const fold = process.platform === 'darwin' || process.platform === 'win32'
    ? (p: string) => p.toLowerCase()
    : (p: string) => p;
  const real = (p: string) => {
    try { return fold(realpathSync.native(resolve(p))); } catch { return fold(resolve(p)); }
  };
  const f = real(folder);
  const h = real(home);
  // A disk root is its own parent. Comparing with resolve(sep) missed it on
  // Windows, where `f` is lowercased and the root is not ("c:\" vs "C:\").
  if (dirname(f) === f || f === h) return false;
  for (const kept of ['.ssh', '.claude', '.config', '.gnupg', 'Library']) {
    const k = join(h, fold(kept));
    if (f === k || f.startsWith(k + sep)) return false;
  }
  return true;
}

/**
 * The folders an office's access rules are built from (src/shared/folderAccess.ts).
 *
 * `folders` is every team member's working folder as recorded (config and
 * registry), which can differ in case from the disk ("SunriseBakery" for
 * "SunRiseBakery"), so each is resolved to its real path: the OS sandbox matches
 * real paths. Folders that aren't a team member's own place are dropped: the
 * home folder and the app's kept folders, the app's own folder, and anything
 * that contains Michael's folder (an agent started in ~/Documents is not a
 * reason to hide ~/Documents).
 */
export function folderLayoutFor(businessFolder: string | undefined, folders: string[], harnessHome?: string): FolderLayout {
  const onDisk = (p: string) => {
    try { return realpathSync.native(resolve(p)); } catch { return resolve(p); }
  };
  // A record the engine hasn't written yet takes its folder's real path.
  const recordOnDisk = (p: string) => {
    try { return realpathSync.native(resolve(p)); } catch { return join(onDisk(dirname(p)), basename(p)); }
  };
  const fold = process.platform === 'darwin' || process.platform === 'win32'
    ? (p: string) => p.toLowerCase()
    : (p: string) => p;
  const within = (parent: string, child: string) => {
    const a = fold(parent); const b = fold(child);
    return a === b || b.startsWith(a.endsWith(sep) ? a : a + sep);
  };
  const business = businessFolder && isUsableTeamFolder(businessFolder) ? onDisk(businessFolder) : undefined;
  const app = harnessHome ? onDisk(harnessHome) : undefined;
  const teamFolders: string[] = [];
  for (const raw of folders) {
    if (!raw || !isAbsolute(raw) || !isUsableTeamFolder(raw)) continue;
    const f = onDisk(raw);
    if (app && (within(app, f) || within(f, app))) continue;
    if (business && within(f, business)) continue;
    if (teamFolders.some((t) => fold(t) === fold(f))) continue;
    teamFolders.push(f);
  }
  // The app's private folder (issue #63), whatever the layout: nobody opens it.
  // Its program and settings folders (issue 100): nobody changes them.
  // Every session's record: nobody's tools open it.
  return {
    business, teamFolders,
    ...(app ? { appPrivate: join(app, 'private'), appLocked: [join(app, 'hive', 'bin'), join(app, 'agent-settings')] } : {}),
    engineRecords: { projects: recordOnDisk(claudeProjectsRoot()), history: recordOnDisk(engineHistoryFile()) }
  };
}

/** The deepest folder that contains every path's parent, or undefined. */
function commonDir(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  let dir = dirname(paths[0]);
  const fold = process.platform === 'win32'
    ? (p: string) => p.toLowerCase()
    : (p: string) => p;
  while (!paths.every((p) => fold(p) === fold(dir) || fold(p).startsWith(fold(dir + sep)))) {
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return dir;
}

function isFolder(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** Only usable folders, and for an office that never recorded Michael's folder,
 *  the folder its team's folders share (Documents/<Business>). */
function checkedRecord(rec: OfficeRecord): OfficeRecord {
  const team = rec.team.filter((m) => isUsableTeamFolder(m.folder));
  let businessFolder = rec.businessFolder && isUsableTeamFolder(rec.businessFolder) ? rec.businessFolder : undefined;
  // With no business folder to go on, the team's folders must share one of
  // their own. Sharing only the home folder (hires in unrelated places) is not
  // an office to continue: it would put Michael in ~ and name the business
  // after the user account.
  if (!businessFolder) {
    const parents = new Set(team.map((m) => dirname(resolve(m.folder))));
    const one = parents.size === 1 ? [...parents][0] : undefined;
    const shared = one ?? commonDir(team.map((m) => resolve(m.folder)));
    if (!shared || !isUsableTeamFolder(shared)) return { ...rec, businessFolder: undefined, team: [] };
    businessFolder = shared;
  }
  return { ...rec, businessFolder, team };
}

/** What is in this folder: an office, and if so which one and which team. */
export function findOffice(home: string): FoundOffice {
  const found = findOfficeUnchecked(home);
  return found.record ? { ...found, record: checkedRecord(found.record) } : found;
}

function findOfficeUnchecked(home: string): FoundOffice {
  const st = homeFolderStatus(home);
  if (!st.hasOffice) return { path: home, hasOffice: false, record: null, source: null };
  const fromFile = readOfficeRecord(home);
  if (fromFile && fromFile.team.length > 0) return { path: home, hasOffice: true, record: fromFile, source: 'file' };
  const fromRegistry = officeRecordFromRegistry(readRegistryAgents(home));
  if (fromRegistry) {
    // A file with the business details but no team (setup finished with nobody
    // picked, then agents were hired later) still names the business best.
    const rec = fromFile ? { ...fromRegistry, ...stripEmpty(fromFile), team: fromRegistry.team } : fromRegistry;
    return { path: home, hasOffice: true, record: rec, source: 'registry' };
  }
  return { path: home, hasOffice: true, record: fromFile, source: fromFile ? 'file' : null };
}

function stripEmpty(rec: OfficeRecord): Partial<OfficeRecord> {
  const out: Partial<OfficeRecord> = {};
  if (rec.businessName) out.businessName = rec.businessName;
  if (rec.businessCity) out.businessCity = rec.businessCity;
  if (rec.businessType) out.businessType = rec.businessType;
  if (rec.businessFolder) out.businessFolder = rec.businessFolder;
  if (rec.companyProfile) out.companyProfile = rec.companyProfile;
  return out;
}
