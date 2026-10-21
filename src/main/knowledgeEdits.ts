/**
 * Company knowledge documents the owner opened from Settings (owner,
 * 2026-10-19): each opens in the owner's own app from the store's copy, and a
 * save there is read in again, so agents search what the owner wrote.
 *
 *   Settings ─ Open ─► open(id) ─► the stored copy in the default app
 *                                   └─ watched: a save with new content ─► reindex ─► changed()
 *   Company foundations ─► a read only copy, never watched: the app rewrites it.
 *   A file that is not a document (OPEN_EXTENSIONS) ─► its text, as a read only copy.
 */
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, unwatchFile, watchFile, type StatWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { OPEN_EXTENSIONS, extensionOf } from '../shared/askFiles';
import { isFoundationsDoc } from '../shared/foundations';

export interface KnowledgeEditsDeps {
  /** The file to open for a document, and its tags. */
  docFile: (id: string) => { path: string; meta: { title?: string; tags?: string[] } } | null;
  /** The document's extracted text, for a read only copy. */
  textFile?: (id: string) => string | null;
  /** Read the document in again; throws a plain reason when it can't, and
   *  resolves null when the document is not in the store. */
  reindex: (id: string) => Promise<unknown>;
  /** Open a path in the owner's default app; '' when it opened, else the reason. */
  openPath: (path: string) => Promise<string>;
  /** Where read only copies go. */
  tempDir: () => string;
  /** A document was read in again (search by meaning and the list refresh). */
  changed: (id: string, error?: string) => void;
  intervalMs?: number;
  /** Quiet time after the last change before a save is read in, so an
   *  editor's autosave while the owner types reads in once. */
  settleMs?: number;
}

/** Read only copies are made in folders named so, in the temp folder. */
const COPY_PREFIX = 'company-knowledge-';

/** At most this many opened documents are watched; the oldest stops first. */
export const MAX_WATCHED = 25;

const hashOf = (path: string): string | null => {
  try { return createHash('sha1').update(readFileSync(path)).digest('hex'); } catch { return null; }
};

export class KnowledgeEdits {
  private watched = new Map<string, { path: string; hash: string | null; busy: boolean; again: boolean; timer?: ReturnType<typeof setTimeout>; listener: () => void; watcher: StatWatcher }>();
  /** The read only copies' folders this run made (removed by clearCopies). */
  private copies: string[] = [];

  constructor(private readonly d: KnowledgeEditsDeps) {}

  /** The Company foundations copy is the app's own (office-foundations.md):
   *  the owner reads it; editing it comes in a later release. */
  static readOnly(meta: { tags?: string[] }): boolean {
    return isFoundationsDoc(meta);
  }

  async open(id: string): Promise<{ ok: true; readOnly: boolean } | { ok: false; error: string }> {
    const f = this.d.docFile(id);
    if (!f) return { ok: false, error: 'missing' };
    // Only a document type opens as itself; anything else (an app, a script, a
    // launcher) opens as its text, read only, so Open never runs a file.
    const document = OPEN_EXTENSIONS.has(extensionOf(f.path));
    if (KnowledgeEdits.readOnly(f.meta) || !document) {
      const source = document ? f.path : this.d.textFile?.(id);
      if (!source) return { ok: false, error: 'missing' };
      // A fresh folder each time: a link planted at a fixed name can't redirect the copy.
      const dir = mkdtempSync(join(this.d.tempDir(), COPY_PREFIX));
      this.copies.push(dir);
      const copy = join(dir, `${(f.meta.title ?? id).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80)}.md`);
      copyFileSync(source, copy);
      try { chmodSync(copy, 0o444); } catch { /* best effort */ }
      const err = await this.d.openPath(copy);
      return err ? { ok: false, error: err } : { ok: true, readOnly: true };
    }
    const err = await this.d.openPath(f.path);
    if (err) return { ok: false, error: err };
    this.watch(id, f.path);
    return { ok: true, readOnly: false };
  }

  private watch(id: string, path: string): void {
    const had = this.watched.get(id);
    if (had?.path === path) return;
    if (had) this.stop(id);
    while (this.watched.size >= MAX_WATCHED) this.stop(this.watched.keys().next().value as string);
    const entry: { path: string; hash: string | null; busy: boolean; again: boolean; timer?: ReturnType<typeof setTimeout>; listener: () => void; watcher: StatWatcher } = {
      path, hash: hashOf(path), busy: false, again: false, watcher: undefined as unknown as StatWatcher,
      // Each change restarts the wait: the save is read in once the file is quiet.
      listener: () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => { entry.timer = undefined; void this.check(id); }, this.d.settleMs ?? 3000);
        entry.timer.unref?.();
      }
    };
    entry.watcher = watchFile(path, { interval: this.d.intervalMs ?? 1500, persistent: false }, entry.listener);
    this.watched.set(id, entry);
  }

  /** A save with new content is read in; the same bytes (an editor touching
   *  the file, or our own write) are not. */
  async check(id: string): Promise<void> {
    const e = this.watched.get(id);
    if (!e) return;
    // A save while one is being read in is read in right after it.
    if (e.busy) { e.again = true; return; }
    const hash = hashOf(e.path);
    if (hash === null) { this.stop(id); return; }
    if (hash === e.hash) return;
    e.busy = true;
    try {
      if ((await this.d.reindex(id)) === null) throw new Error('This document is no longer in company knowledge.');
      e.hash = hash;
      this.d.changed(id);
    } catch (err) {
      // Not marked read: the next save, even of the same bytes, tries again.
      this.d.changed(id, err instanceof Error ? err.message : String(err));
    } finally {
      e.busy = false;
    }
    if (e.again) { e.again = false; await this.check(id); }
  }

  stop(id: string): void {
    const e = this.watched.get(id);
    if (!e) return;
    unwatchFile(e.path, e.listener);
    if (e.timer) clearTimeout(e.timer);
    this.watched.delete(id);
  }

  /** Remove the read only copies: this run's, and with `all`, any an earlier
   *  run left (they hold the office's text; at launch, on quit and at a reset).
   *  A copy still open in an editor that locks it (Windows) stays until next time. */
  clearCopies(all = false): void {
    const dirs = new Set(this.copies);
    if (all) {
      try {
        const root = this.d.tempDir();
        for (const n of readdirSync(root)) if (n.startsWith(COPY_PREFIX)) dirs.add(join(root, n));
      } catch { /* no temp folder */ }
    }
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true, force: true }); this.copies = this.copies.filter((d) => d !== dir); } catch { /* in use */ }
    }
  }

  stopAll(): void {
    for (const id of [...this.watched.keys()]) this.stop(id);
  }

  watching(): string[] {
    return [...this.watched.keys()];
  }
}
