/**
 * KnowledgeManager — the Electron-main façade over the file-backed enterprise
 * Knowledge Graph store. Owns ingestion (in-app, over IPC) and exposes the same
 * keyword search the agent CLI uses; agents themselves query out-of-process via
 * `resources/kg.cjs` (see docs/design/knowledge-graph.md).
 *
 * All heavy lifting lives in the pure-JS `kg-core.cjs` sidecar (no native deps),
 * required the same way `slack.ts` requires `slack-trigger.cjs`. Mirrors the
 * MemoryManager surface (`active()` / `env()` / `status()`) so it slots into the
 * existing spawn-injection flow.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config';
import { extractDocumentText, type DocExtraction } from './docText';
import { extractDocumentTextApart } from './docTextProcess';

// Pure-JS core, copied to out/main at build (like slack-trigger.cjs) and shipped
// to process.resourcesPath for the agent CLI (electron-builder extraResources).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('./kg-core.cjs') as KgCore;

interface KgMeta {
  id: string; title: string; source: string; modality: string; mime: string | null;
  origExt: string; bytes: number; tags: string[]; caption: string | null;
  chunkCount: number; addedAt: string; extractor: string; truncated: boolean;
  /** When the owner's edit was last read in (Settings, open and save). */
  updatedAt?: string;
}
interface KgHit {
  docId: string; title: string; source: string; modality: string;
  chunkIdx: number; score: number; snippet: string;
}
interface KgIngestInput {
  srcPath?: string; text?: string; title?: string; tags?: string[];
  caption?: string; modality?: string; source?: string;
  /** How the text was produced, when it was converted before ingest. */
  extractor?: string; mime?: string;
}
interface KgCore {
  ingest(root: string, input: KgIngestInput): { docId: string; chunkCount: number; meta: KgMeta };
  search(root: string, query: string, opts?: { limit?: number }): KgHit[];
  list(root: string): KgMeta[];
  getDoc(root: string, docId: string): { meta: KgMeta; text: string } | null;
  removeDoc(root: string, docId: string): boolean;
  reindex(root: string, docId: string, input: { text?: string; bytes?: number; extractor?: string }): KgMeta | null;
  docFile(root: string, docId: string): { path: string; kind: 'original' | 'text'; meta: KgMeta } | null;
  extractText(input: { srcPath?: string; modality?: string; title?: string; caption?: string | null; tags?: string[]; source?: string }): { text?: string; extractor?: string };
  stats(root: string): { docCount: number; chunkCount: number; byModality: Record<string, number> };
}

export interface KnowledgeStatus {
  root: string;
  docCount: number;
  chunkCount: number;
  byModality: Record<string, number>;
}

export class KnowledgeManager {
  /** Whether the store holds any document: members are pointed at it only
   *  then, so nobody spends a step searching an empty store. */
  hasDocuments(): boolean {
    const docs = join(this.root(), 'docs');
    try { return readdirSync(docs).some((id) => existsSync(join(docs, id, 'meta.json'))); } catch { return false; }
  }

  /** The store directory (config override or <userData>/knowledge). */
  root(): string {
    const override = readConfig().knowledgeGraph?.rootPath;
    if (override && override.trim()) return override;
    return join(app.getPath('userData'), 'knowledge');
  }

  /** Absolute path to the agent CLI (dev: repo resources/; packaged: resourcesPath). */
  private cliPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'kg.cjs')
      : join(app.getAppPath(), 'resources', 'kg.cjs');
  }

  /** Absolute path to the pure-JS core for the out-of-process CLI to require. */
  private corePath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'kg-core.cjs')
      : join(app.getAppPath(), 'src', 'main', 'kg-core.cjs');
  }

  /** Env merged into each agent's spawn so its `kg` CLI hits this store.
   *  Company knowledge is always on (owner, 2026-10-19: no switch). */
  env(): Record<string, string> {
    return { KG_ROOT: this.root(), KG_CLI: this.cliPath(), KG_CORE: this.corePath() };
  }

  /**
   * Company knowledge searched by meaning (owner, 2026-09-25): MemPalace, the
   * local vector store the app already drives for agents' memory, indexes a
   * mirror of the store, one file per document named by its id, with the title
   * and id on top so every search result says which document to `get`.
   * Brought up to date here (missing files written, removed documents' files
   * deleted); MemoryManager indexes the folder into the palace's "company"
   * section. Null when its folder can't be made. `signature` changes whenever
   * a document is added, removed or edited, so an unchanged store isn't
   * indexed again.
   */
  meaningMirror(): { dir: string; signature: string } | null {
    const root = this.root();
    const dir = join(root, 'meaning');
    try { mkdirSync(dir, { recursive: true }); } catch { return null; }
    const docs = existsSync(root) ? core.list(root) : [];
    const ids = new Set<string>();
    const versions: string[] = [];
    // A file that could not be written or removed: the signature then changes
    // on every pass, so the next pass tries again instead of calling it done.
    let failed = false;
    for (const meta of docs) {
      const id = String(meta.id ?? '');
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue;
      // An edited document carries updatedAt: its mirror file is written again,
      // and the new time changes the signature, so it is indexed again.
      const version = meta.updatedAt ? `edited ${meta.updatedAt}` : String(meta.addedAt ?? '');
      ids.add(id);
      versions.push(`${id}@${version}`);
      const file = join(dir, `${id}.md`);
      const changed = !!meta.updatedAt && (() => { try { return statSync(file).mtimeMs < Date.parse(meta.updatedAt!); } catch { return true; } })();
      if (existsSync(file) && !changed) continue;
      const doc = core.getDoc(root, id);
      if (!doc) continue;
      try {
        writeFileSync(file, `Title: ${meta.title ?? id}\nDocument id: ${id}\n\n${doc.text}\n`, 'utf8');
      } catch { failed = true; }
    }
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { /* none */ }
    for (const f of files) {
      if (f.endsWith('.md') && !ids.has(f.slice(0, -3))) {
        try { rmSync(join(dir, f), { force: true }); } catch { failed = true; }
      }
    }
    return { dir, signature: versions.sort().join(',') + (failed ? `,retry@${Date.now()}` : '') };
  }

  /** What a running agent needs to search the store: whether it's on, the CLI,
   *  and the store's folder (passed as --root, so no restart is needed). */
  agentAccess(): { active: boolean; cliPath?: string; root?: string } {
    if (!this.hasDocuments()) return { active: false };
    return { active: true, cliPath: this.cliPath(), root: this.root() };
  }

  status(): KnowledgeStatus {
    const root = this.root();
    const s = existsSync(root)
      ? core.stats(root)
      : { docCount: 0, chunkCount: 0, byModality: {} };
    return { root, docCount: s.docCount, chunkCount: s.chunkCount, byModality: s.byModality };
  }

  /** Ingest a file from disk. No-op-safe when off (callers gate on status).
   *
   *  Word, Excel, PowerPoint and PDF are converted to text first (docText.ts);
   *  kg-core keeps the original file either way. A file that can't be read
   *  THROWS with a plain-English reason rather than being stored: storing it
   *  anyway is what used to index a .docx as zip bytes and report success. */
  async ingestFile(srcPath: string, opts: { title?: string; tags?: string[]; caption?: string } = {}) {
    const ex = await this.readDocument(srcPath);
    if (ex.kind === 'unreadable') throw new Error(ex.reason);
    if (ex.kind === 'text') {
      return core.ingest(this.root(), {
        srcPath, ...opts, text: ex.text, modality: ex.modality, extractor: ex.extractor, mime: ex.mime
      });
    }
    return core.ingest(this.root(), { srcPath, ...opts });
  }

  /** Parsed in a process of its own: a big or crafted file parsed here would
   *  freeze every window. Without the built doc-text script, it is read here. */
  private readDocument(srcPath: string): Promise<DocExtraction> {
    const script = join(app.getAppPath(), 'out', 'main', 'docTextCli.js');
    if (!existsSync(script)) return extractDocumentText(srcPath);
    return extractDocumentTextApart(srcPath, { file: process.execPath, args: [script], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  }

  /** Ingest inline text (e.g. pasted content). */
  ingestText(text: string, opts: { title?: string; tags?: string[] } = {}) {
    return core.ingest(this.root(), { text, ...opts });
  }

  search(query: string, limit?: number): KgHit[] {
    if (!existsSync(this.root())) return [];
    return core.search(this.root(), query, { limit });
  }

  list(): KgMeta[] {
    if (!existsSync(this.root())) return [];
    return core.list(this.root());
  }

  get(docId: string): { meta: KgMeta; text: string } | null {
    return core.getDoc(this.root(), docId);
  }

  remove(docId: string): boolean {
    return core.removeDoc(this.root(), docId);
  }

  /** A document's extracted text file, or null for an unknown id. */
  textFile(docId: string): string | null {
    if (!/^[A-Za-z0-9_-]+$/.test(docId)) return null;
    const file = join(this.root(), 'docs', docId, 'text.md');
    return existsSync(file) ? file : null;
  }

  /** The file Settings opens for a document: its stored copy, else its text. */
  docFile(docId: string): { path: string; kind: 'original' | 'text'; meta: KgMeta } | null {
    return core.docFile(this.root(), docId);
  }

  /** Read a document again after the owner saved its stored copy: Word, Excel,
   *  PowerPoint and PDF are converted as at ingest. A file that can't be read
   *  keeps the old text and throws its plain reason. */
  async reindex(docId: string): Promise<KgMeta | null> {
    const f = this.docFile(docId);
    if (!f) return null;
    const bytes = (() => { try { return statSync(f.path).size; } catch { return undefined; } })();
    if (f.kind === 'text') return core.reindex(this.root(), docId, { text: readFileSync(f.path, 'utf8'), bytes, extractor: 'inline@1' });
    const ex = await this.readDocument(f.path);
    if (ex.kind === 'unreadable') throw new Error(ex.reason);
    if (ex.kind === 'text') return core.reindex(this.root(), docId, { text: ex.text, bytes, extractor: ex.extractor });
    // Plain text, markdown and images are read by the store itself, as at ingest.
    const own = core.extractText({ srcPath: f.path, modality: f.meta.modality, title: f.meta.title, caption: f.meta.caption, tags: f.meta.tags, source: f.meta.source });
    return core.reindex(this.root(), docId, { text: own.text ?? '', bytes, ...(own.extractor ? { extractor: own.extractor } : {}) });
  }
}
