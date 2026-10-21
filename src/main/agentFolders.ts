/**
 * Where each agent's folder lives on the owner's disk (Decisions 44, 45).
 *
 * An agent works INSIDE its folder: what it reads for context and what it
 * produces both live there. Unless the owner points it somewhere else, a folder
 * is `~/Documents/<Business name>/<Folder>`, and Michael plus every agent share
 * `~/Documents/<Business name>/Office`.
 *
 * Both names arrive from outside: the business name is typed by the owner, and
 * a folder name comes from a pack that may have been imported. So both are
 * cleaned into one safe folder name, and the final path is checked to still be
 * inside the business folder before anything is created.
 *
 * Creation only ever ADDS a missing folder. An existing folder, and anything in
 * it, is left exactly as it is.
 */

import { mkdirSync, statSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

/** The folder Michael works in, and that every agent can reach. */
export const OFFICE_FOLDER = 'Office';

const FALLBACK_BUSINESS = 'My Business';
const MAX_NAME = 60;
/** Names Windows reserves for devices; a folder by one of these can't be opened
 *  there. Windows reads only the part before the first dot, so `CON.txt` is one. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * One safe folder name from anything a person or a pack might supply.
 *
 * "A/B Consulting" → "A-B Consulting", "../../x" → "x", "  Café  " → "Café".
 * Returns `fallback` when nothing usable is left.
 */
export function safeFolderName(raw: string, fallback = 'Folder'): string {
  let name = String(raw ?? '')
    // Path separators and characters Windows forbids become a dash; control
    // characters disappear.
    .replace(/[\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot makes a hidden folder (and ".." climbs out); Windows strips
    // trailing dots and spaces, which would make two names collide.
    .replace(/^[.\s-]+/, '')
    .replace(/[.\s]+$/, '');

  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME).replace(/[.\s]+$/, '');
  if (!name) return fallback;
  // The suffix goes before the first dot, so `CON.txt` becomes `CON-folder.txt`.
  if (WINDOWS_RESERVED.test(name)) name = name.replace(/^[^.]*/, (device) => `${device}-folder`);
  return name;
}

/** `~/Documents/<Business name>` — the parent of every default agent folder. */
export function businessFolderRoot(documentsDir: string, businessName: string): string {
  return join(documentsDir, safeFolderName(businessName, FALLBACK_BUSINESS));
}

/**
 * `~/Documents/<Business name>/<Folder>` for one agent's folder name.
 *
 * Throws if the result would land outside the business folder. The cleaning
 * above already makes that impossible; this is the check that proves it, kept
 * because a folder path is exactly where a quiet mistake does lasting damage.
 */
export function defaultAgentFolder(documentsDir: string, businessName: string, folderName: string): string {
  const root = businessFolderRoot(documentsDir, businessName);
  const path = join(root, safeFolderName(folderName));
  if (!isInside(root, path)) throw new Error(`Folder "${folderName}" would land outside ${root}`);
  return path;
}

export type EnsureFolderResult = { ok: true; path: string; created: boolean } | { ok: false; path: string; reason: string };

/**
 * Make sure a folder exists, creating it (and its parents) only if it is missing.
 * Never touches an existing folder's contents. Reasons are plain English: they
 * are shown to the owner during setup.
 */
export function ensureFolder(path: string): EnsureFolderResult {
  if (!isAbsolute(path)) return { ok: false, path, reason: 'The folder location is incomplete.' };
  try {
    const st = statSync(path);
    return st.isDirectory()
      ? { ok: true, path, created: false }
      : { ok: false, path, reason: 'A file with that name is already there. Pick a different folder.' };
  } catch {
    /* missing: create it below */
  }
  try {
    mkdirSync(path, { recursive: true });
    return { ok: true, path, created: true };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      ok: false,
      path,
      reason: code === 'EACCES' || code === 'EPERM'
        ? 'The app isn\'t allowed to create a folder there. Pick a folder you own.'
        : 'The folder couldn\'t be created. Pick a different location.'
    };
  }
}

/** True when `child` is `parent` itself or somewhere below it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
