/**
 * What Settings → "Reset & start over" erases (app:resetAll in index.ts), so
 * the next launch is a true first run: the setup a new owner sees, with
 * nothing from the office before it.
 *
 * Only what the app itself created goes. The office folder stays, and so does
 * anything else in it: the owner may have picked a folder that holds their own
 * files. roster-backups/ stays too, because a roster is archived on reset,
 * never deleted (roster.ts archive()). The business folder, the Claude Code
 * sign-in and ~/.claude belong to the owner and to Claude Code, not the app.
 *
 * In the app's data folder, config.json is put back to first-run defaults by
 * resetConfig(), and what describes this install rather than the office stays:
 * the updater's log and version stamp, the anonymous usage id, and the hero,
 * model and skill catalog caches.
 */
import { existsSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { officeRecordPath, readOfficeRecord } from './officeFile';
import { AGENT_TMP_DIR } from '../shared/folderAccess';
import { RESEARCH_DESK_DIR } from '../shared/research';
import { privateRoot } from '../shared/agentPrivatePaths';

/** Created by the app in the office folder. office.json and private/ have
 *  plain names an owner could use too, so they are handled on their own below. */
export const OFFICE_FOLDER_ENTRIES = [
  'hive',
  'palace',
  'agent-settings',
  AGENT_TMP_DIR,
  RESEARCH_DESK_DIR,
  'hallways.json',
  'tunnels.json'
] as const;

/** What the app keeps in `<office>/private/` (shared/agentPrivatePaths.ts and
 *  hive.ts). The folder itself goes only when nothing else is left in it. */
export const PRIVATE_ENTRIES = [
  'agent-mcp',
  'owner',
  'card-guard.json',
  'house-rules-seen.json',
  'ask-list-since.json',
  'research-stamp.key',
  'research-threads.json',
  'research-outbox',
  'research-pending.json',
  'research-pending-lost.json',
  'research-mined',
  // The outbox journal: ids the router chose, until each file is archived.
  'outbox-routing',
  // Pulse's held list: subjects and openings of held messages (2026-10-16).
  'held.jsonl',
  // Pulse's questions and answers lists and their archive (eng D3: a reset
  // erases both; nothing else deletes the archive).
  'checked.jsonl',
  'checked-archive',
  'checked-backfill.json',
  // Company foundations: the record the app alone writes (office-foundations.md),
  // and the ids of the owner's messages it takes as the owner's words.
  'foundations.json',
  'owner-said.jsonl'
] as const;

/** The privacy and standing approval checks' own empty folders (index.ts). */
export const STANDING_CHECK_DIR = 'standing-check';
export const TRUST_CHECK_DIR = 'trust-check';
export const CHECK_FOLDERS = [STANDING_CHECK_DIR, TRUST_CHECK_DIR] as const;

/** Created by the app in its own data folder for the office it runs. */
export const APP_DATA_ENTRIES = [
  'harness.db',
  'harness.db-wal',
  'harness.db-shm',
  'knowledge',
  'integration-secrets.json',
  'mail-send-journal.json',
  'broker-write-journal.json',
  'mail-proposals.json',
  'quickbooks-approvals.json',
  'trigger-history.json',
  'owner-dock-keys.json',
  'slack-reply.json',
  'slack-done-notified.json',
  'slack-files',
  'pastes',
  ...CHECK_FOLDERS
] as const;

/** In the app's data folder and kept by a reset: they describe this install,
 *  not the office (test/factory-reset.test.cjs checks every name is in one list). */
export const APP_DATA_KEPT = [
  'config.json', 'hero.json', 'model-catalog.json', 'skill-catalog.json', 'last-run-version', 'updater.log',
  // The anonymous usage id and its version stamp (analytics.ts).
  'telemetry-install-id', 'telemetry-last-version'
] as const;

/** Is this folder an office the app made, and not the owner's home folder or a
 *  disk's root? Only then are its app-made entries removed. */
function isBroad(abs: string): boolean {
  return abs === resolve(homedir()) || abs === parse(abs).root;
}

function isOfficeFolder(home: string): boolean {
  const abs = resolve(home);
  if (isBroad(abs)) return false;
  // The registry, the office record, or the roster backups the reset itself
  // just wrote (roster.ts archive), so a damaged office is still cleared.
  return existsSync(join(abs, 'hive', 'registry.json')) || readOfficeRecord(abs) !== null
    || existsSync(join(abs, 'roster-backups'));
}

/** Is this a Company knowledge store kg-core made: a docs folder and an index
 *  whose first line is one of its entries? Never the home folder or a root. */
export function isKnowledgeStore(root: string): boolean {
  const abs = resolve(root);
  if (isBroad(abs)) return false;
  try {
    if (!statSync(join(abs, 'docs')).isDirectory()) return false;
    const first = readFileSync(join(abs, 'index.jsonl'), 'utf8').split('\n', 1)[0].trim();
    if (!first) return true;
    const row = JSON.parse(first) as Record<string, unknown>;
    return typeof row.docId === 'string' && typeof row.chunkIdx === 'number';
  } catch { return false; }
}

/** Damaged write journals the broker moved aside; they hold app answers. */
function setAsideJournals(userData: string): string[] {
  try {
    return readdirSync(userData).filter((n) => /^broker-write-journal\.damaged-\d+\.json$/.test(n)).map((n) => join(userData, n));
  } catch { return []; }
}

/** Erase the office's data. `extra` adds folders that live elsewhere (the
 *  hive and palace where they resolve, Research's and the checks' Claude Code
 *  conversations). Returns the paths it could not remove; a reset carries on
 *  past them rather than stopping half way. */
export function eraseOfficeData(p: { home: string | null; userData: string; extra?: string[]; knowledgeRoot?: string | null }): string[] {
  const home = p.home && isOfficeFolder(p.home) ? p.home : null;
  // Company knowledge the owner moved out of the app's data folder: its store's
  // own entries, and only when it really is one.
  const kg = p.knowledgeRoot && isKnowledgeStore(p.knowledgeRoot) ? p.knowledgeRoot : null;
  const targets = [
    ...(kg ? knowledgeStoreEntries(kg) : []),
    // Isolated agents' git worktrees (index.ts), each with any work left in it.
    ...(home ? appWorktrees(home) : []),
    ...(home ? OFFICE_FOLDER_ENTRIES.map((n) => join(home, n)) : []),
    ...(home ? PRIVATE_ENTRIES.map((n) => join(privateRoot(home), n)) : []),
    // Only the app's own office record, never an owner's file of that name.
    ...(home && readOfficeRecord(home) ? [officeRecordPath(home)] : []),
    ...APP_DATA_ENTRIES.map((n) => join(p.userData, n)),
    // A damaged connected app write journal the broker set aside (brokerWriteOnce.ts).
    ...setAsideJournals(p.userData),
    ...(p.extra ?? []).filter(Boolean)
  ];
  const failed: string[] = [];
  for (const t of targets) {
    // Retried for up to about half a second (100, 200, 300 ms): a file a
    // stopping process still holds open (Windows) or is closing gets the time
    // to let go, without freezing the window for long.
    try { rmSync(t, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { failed.push(t); }
  }
  // A folder the app made goes once nothing of the owner's is left in it.
  const emptied = [
    ...(home ? [privateRoot(home), join(home, 'worktrees')] : []),
    ...(kg ? [join(kg, 'docs'), join(kg, 'meaning')] : [])
  ];
  for (const dir of emptied) {
    try { if (readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* absent, or the owner's things stay */ }
  }
  return failed;
}

/** The store's own entries: its index, and each document folder and meaning
 *  file it names (or that holds kg-core's meta.json). Nothing else in docs/ or
 *  meaning/ is touched, so an owner's own files there stay. */
function knowledgeStoreEntries(kg: string): string[] {
  const ids = new Set<string>();
  try {
    for (const line of readFileSync(join(kg, 'index.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const row = JSON.parse(line) as { docId?: unknown }; if (typeof row.docId === 'string') ids.add(row.docId); } catch { /* not a row */ }
    }
  } catch { /* no index */ }
  try { for (const d of readdirSync(join(kg, 'docs'))) if (existsSync(join(kg, 'docs', d, 'meta.json'))) ids.add(d); } catch { /* no docs */ }
  const safe = [...ids].filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
  return [
    join(kg, 'index.jsonl'),
    ...safe.map((id) => join(kg, 'docs', id)),
    ...safe.map((id) => join(kg, 'meaning', `${id}.md`))
  ];
}

/** The git worktrees the app made for isolated agents: each child of
 *  `<office>/worktrees` whose `.git` is a file (a worktree's pointer), never a
 *  folder the owner keeps there. */
function appWorktrees(home: string): string[] {
  const root = join(home, 'worktrees');
  try {
    return readdirSync(root).map((d) => join(root, d)).filter((d) => {
      try { return statSync(join(d, '.git')).isFile(); } catch { return false; }
    });
  } catch { return []; }
}
