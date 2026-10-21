/**
 * The office's own record of who it is: `<harnessHome>/office.json`.
 *
 * WHY THIS EXISTS. Setup used to derive everything from what the owner typed:
 * the team's folders are `~/Documents/<Business name>/<Folder>`. After a
 * reinstall (or a new data folder, as on 2026-09-24) setup runs again, and a
 * business name typed slightly differently pointed the team at new, empty
 * folders while the real office sat untouched in the home folder. The office
 * folder is the one thing that survives a reinstall, so the office describes
 * itself there, and setup recognises it by folder, never by name.
 *
 * The record is written by config:update only when a save changes the office's
 * own fields (touchesOffice), never when a save only switches offices, and is
 * backfilled at launch (backfillOfficeRecord) only when the config's team
 * matches the office's registry. An office without one is described from its
 * hive registry instead (`officeRecordFromRegistry`).
 *
 * Pure data and pure functions; the file I/O lives in src/main/officeFile.ts.
 */
import type { TeamPlan } from './teamPlan';
import { cleanCompanyProfile, type CompanyProfile } from './companyProfile';

export interface OfficeRecord {
  version: 1;
  businessName?: string;
  businessCity?: string;
  businessType?: string;
  /** Michael's folder, the business folder that holds the team's folders by
   *  default (src/shared/folderAccess.ts). Absent when only the registry was
   *  available and no business folder could be told apart from the team's.
   *  Records written before 2026-09-25 named the shared Office folder instead;
   *  those are read as the folder holding it (legacyBusinessFolder). */
  businessFolder?: string;
  /** Key facts about the business (src/shared/companyProfile.ts), kept with the
   *  office so setting it up again doesn't ask for them twice. */
  companyProfile?: CompanyProfile;
  /** Each team member and the folder it works in. Michael is not listed. */
  team: Array<{ agentId: string; folder: string }>;
}

/** The fields of the app config a record is built from. */
export interface OfficeConfigFields {
  onboardingComplete?: boolean;
  harnessHome?: string | null;
  businessName?: string;
  businessCity?: string;
  businessType?: string;
  businessFolder?: string;
  /** Before 2026-09-25: the shared Office folder, inside Michael's. */
  officeFolder?: string;
  companyProfile?: CompanyProfile;
  businessTeam?: Array<{ agentId: string; folder: string }>;
}

/** The fields of a hive registry entry a record reads. Its `archived` flag is
 *  deliberately not among them: see officeRecordFromRegistry. */
export interface RegistryAgentFields {
  id?: string;
  cwd?: string;
}

/** The god agent's registry id. It works in the hive, not in a business folder. */
const GOD_ID = 'god';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/**
 * Michael's folder for an office set up before 2026-09-25, which recorded only
 * its shared Office folder: the folder holding it. The Office folder is gone as
 * a concept (company knowledge lives in the knowledge feature); on disk it's an
 * ordinary folder inside Michael's.
 */
/** `{ companyProfile }` when there is anything in it, else nothing, so an
 *  office without a profile keeps the record shape it always had. */
function profileField(raw: unknown): { companyProfile?: CompanyProfile } {
  const p = cleanCompanyProfile(raw);
  return Object.keys(p).length ? { companyProfile: p } : {};
}

export function legacyBusinessFolder(officeFolder: string | undefined): string | undefined {
  const o = str(officeFolder)?.replace(/[\\/]+$/, '');
  if (!o) return undefined;
  const at = Math.max(o.lastIndexOf('/'), o.lastIndexOf('\\'));
  return at > 0 ? o.slice(0, at) : undefined;
}

function cleanTeam(v: unknown): Array<{ agentId: string; folder: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ agentId: string; folder: string }> = [];
  const seen = new Set<string>();
  for (const m of v) {
    const agentId = str((m as { agentId?: unknown })?.agentId);
    const folder = str((m as { folder?: unknown })?.folder);
    if (!agentId || !folder || seen.has(agentId)) continue;
    seen.add(agentId);
    out.push({ agentId, folder });
  }
  return out;
}

/** A record read from disk, or null when it is not one. Never throws. */
export function parseOfficeRecord(v: unknown): OfficeRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return null;
  return {
    version: 1,
    businessName: str(o.businessName),
    businessCity: str(o.businessCity),
    businessType: str(o.businessType),
    businessFolder: str(o.businessFolder) ?? legacyBusinessFolder(str(o.officeFolder)),
    ...profileField(o.companyProfile),
    team: cleanTeam(o.team)
  };
}

/** The record the config describes, or null before setup has finished. */
export function officeRecordFromConfig(cfg: OfficeConfigFields): OfficeRecord | null {
  if (!cfg.onboardingComplete || !str(cfg.harnessHome)) return null;
  return {
    version: 1,
    businessName: str(cfg.businessName),
    businessCity: str(cfg.businessCity),
    businessType: str(cfg.businessType),
    businessFolder: str(cfg.businessFolder) ?? legacyBusinessFolder(cfg.officeFolder),
    ...profileField(cfg.companyProfile),
    team: cleanTeam(cfg.businessTeam)
  };
}

/** Last path segment, for either separator. */
function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** The deepest folder every path sits in, or undefined when they share only the root. */
function commonParent(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const sep = paths[0].includes('\\') && !paths[0].includes('/') ? '\\' : '/';
  const uncPath = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(paths[0]);
  const windowsPath = /^[A-Za-z]:[\\/]/.test(paths[0]) || uncPath;
  const split = paths.map((p) => p.split(/[\\/]/));
  const parent = split.map((parts) => parts.slice(0, -1));
  const first = parent[0];
  let n = first.length;
  for (const parts of parent.slice(1)) {
    let i = 0;
    while (i < n && i < parts.length && (windowsPath
      ? parts[i].toLowerCase() === first[i].toLowerCase()
      : parts[i] === first[i])) i++;
    n = i;
  }
  const joined = first.slice(0, n).join(sep);
  return joined && joined !== sep && n > (uncPath ? 4 : 1) ? joined : undefined;
}

/**
 * Describe an office that has no office.json from its hive registry: every
 * team member and the folder it works in. `archived` there only means the
 * member's terminal was closed (every agent is archived when the app quits),
 * so it does not leave the team. The business name is a best
 * guess (the folder the team's folders share), used only to pre-fill; the
 * folders themselves come from the registry, which is what matters.
 */
export function officeRecordFromRegistry(
  agents: Record<string, RegistryAgentFields> | undefined
): OfficeRecord | null {
  const team: Array<{ agentId: string; folder: string }> = [];
  for (const [key, a] of Object.entries(agents ?? {})) {
    const agentId = str(a?.id) ?? key;
    const folder = str(a?.cwd);
    if (agentId === GOD_ID || !folder) continue;
    team.push({ agentId, folder });
  }
  if (team.length === 0) return null;
  const parent = commonParent(team.map((m) => m.folder));
  return {
    version: 1,
    businessName: parent ? baseName(parent) : undefined,
    businessFolder: undefined,
    team
  };
}

/**
 * The setup plan that continues this office exactly as recorded: the same team
 * in the same folders, whatever the owner would type as the business name. An
 * office with no recorded business folder uses the folder its team's folders
 * share.
 */
export function teamPlanFromRecord(rec: OfficeRecord | null | undefined): TeamPlan {
  if (!rec || rec.team.length === 0) return { ok: false };
  const business = rec.businessFolder ?? commonParent(rec.team.map((m) => m.folder));
  if (!business) return { ok: false };
  const folders = [business];
  for (const m of rec.team) if (!folders.includes(m.folder)) folders.push(m.folder);
  return { ok: true, business, team: rec.team.map((m) => ({ ...m })), folders };
}

/** True when two records describe the same office, so an unchanged one is not rewritten. */
export function sameOfficeRecord(a: OfficeRecord | null, b: OfficeRecord | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Config fields that describe the office. Only a save that changes one of
 *  these may rewrite office.json: the fields are global, not per office, so a
 *  save that only switches offices (harnessHome) must never write the previous
 *  office's description into the new one (2026-09-24 review). */
export const OFFICE_FIELDS = [
  'onboardingComplete', 'businessName', 'businessCity', 'businessType', 'businessFolder', 'officeFolder', 'companyProfile', 'businessTeam'
] as const;

export function touchesOffice(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object') return false;
  return OFFICE_FIELDS.some((k) => k in (patch as Record<string, unknown>));
}

/**
 * Whether the config's team is this office's team: every member is in the
 * office's registry, working in the same folder. The launch backfill writes a
 * record only then, so an install with several offices never labels one office
 * with another's team. `caseInsensitive` for macOS and Windows, whose folder
 * names ignore case.
 */
export function configMatchesRegistry(
  cfg: OfficeConfigFields,
  agents: Record<string, RegistryAgentFields> | undefined,
  caseInsensitive: boolean
): boolean {
  const team = cleanTeam(cfg.businessTeam);
  if (team.length === 0 || !agents) return false;
  const norm = (p: string) => {
    const t = p.replace(/[\\/]+$/, '');
    return caseInsensitive ? t.toLowerCase() : t;
  };
  return team.every((m) => {
    const cwd = str(agents[m.agentId]?.cwd);
    return !!cwd && norm(cwd) === norm(m.folder);
  });
}
