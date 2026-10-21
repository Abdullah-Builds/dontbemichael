'use strict';

/**
 * Company knowledge documents in Settings (owner, 2026-10-19): the list, Open
 * in the owner's own app, and a save there read in again so agents search the
 * new version. Company foundations opens as a read only copy.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const kg = require('../src/main/kg-core.cjs');
const { KnowledgeEdits, MAX_WATCHED } = loadTs('src/main/knowledgeEdits.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a stored copy opens and a reindex replaces the text and index lines, keeping the copy', (t) => {
  const dir = tmp(t);
  const root = path.join(dir, 'kg');
  const src = path.join(dir, 'prices.md');
  fs.writeFileSync(src, 'Large pizza costs 14 dollars.');
  const { docId } = kg.ingest(root, { srcPath: src, title: 'Price list' });
  const other = kg.ingest(root, { text: 'Opening hours are noon to ten.', title: 'Hours' }).docId;
  const f = kg.docFile(root, docId);
  assert.equal(f.kind, 'original');
  assert.equal(path.basename(f.path), 'original.md');
  assert.equal(kg.docFile(root, other).kind, 'text', 'pasted text opens its text');
  assert.equal(kg.docFile(root, 'nope'), null);

  fs.writeFileSync(f.path, 'Large pizza costs 16 dollars now.');
  const meta = kg.reindex(root, docId, { text: fs.readFileSync(f.path, 'utf8'), bytes: 33 });
  assert.ok(meta.updatedAt);
  assert.equal(meta.bytes, 33);
  assert.equal(kg.search(root, '16 dollars')[0].docId, docId);
  assert.equal(kg.search(root, '14').length, 0, 'the old lines are gone');
  assert.equal(kg.search(root, 'noon')[0].docId, other, 'other documents untouched');
  assert.ok(fs.existsSync(f.path), 'the edited copy stays');
  assert.equal(kg.reindex(root, 'nope', { text: 'x' }), null);
});

function edits(t, over = {}) {
  const dir = tmp(t);
  const file = path.join(dir, 'original.md');
  fs.writeFileSync(file, 'v1');
  const appFile = path.join(dir, 'original.command');
  fs.writeFileSync(appFile, 'echo hi');
  const textFile = path.join(dir, 'text.md');
  fs.writeFileSync(textFile, 'echo hi');
  const calls = { opened: [], reindexed: [], changed: [] };
  const e = new KnowledgeEdits({
    docFile: (id) => (id === 'doc' ? { path: file, meta: { title: 'Price list', tags: [] } } : id === 'found' ? { path: file, meta: { title: 'Company foundations', tags: ['foundations'] } } : id === 'app' ? { path: appFile, meta: { title: 'Setup', tags: [] } } : null),
    textFile: (id) => (id === 'app' ? textFile : null),
    reindex: async (id) => { calls.reindexed.push(id); if (over.fail) throw new Error('The file could not be opened.'); },
    openPath: async (p) => { calls.opened.push(p); return ''; },
    tempDir: () => dir,
    changed: (id, error) => calls.changed.push({ id, error }),
    intervalMs: 50
  });
  t.after(() => e.stopAll());
  return { e, file, dir, calls };
}

test('Open watches the copy: new content is read in once, the same bytes never', async (t) => {
  const o = edits(t);
  assert.deepEqual(await o.e.open('doc'), { ok: true, readOnly: false });
  assert.deepEqual(o.calls.opened, [o.file]);
  await o.e.check('doc');
  assert.deepEqual(o.calls.reindexed, [], 'unchanged: nothing read in');
  fs.writeFileSync(o.file, 'v2');
  await o.e.check('doc');
  await o.e.check('doc');
  assert.deepEqual(o.calls.reindexed, ['doc'], 'once per change');
  assert.deepEqual(o.calls.changed, [{ id: 'doc', error: undefined }]);
  assert.deepEqual(await o.e.open('nope'), { ok: false, error: 'missing' });
  o.e.stop('doc');
  assert.deepEqual(o.e.watching(), []);
});

test('a save that cannot be read says why and keeps watching', async (t) => {
  const o = edits(t, { fail: true });
  await o.e.open('doc');
  fs.writeFileSync(o.file, 'broken');
  await o.e.check('doc');
  assert.match(o.calls.changed[0].error, /could not be opened/);
  assert.deepEqual(o.e.watching(), ['doc']);
  // Codex pass 1: a failed read in is not marked done, so the same bytes are tried again.
  await o.e.check('doc');
  assert.equal(o.calls.reindexed.length, 2, 'tried again');
});

test('a save to a document no longer in the store says so and is tried again; a moved store stops the watchers; a failed mirror write retries', async (t) => {
  // Value: protects=no edit is reported saved into nothing, and search by meaning does not stay stale after a disk error (Codex pass 2, D12); fails_when=a null reindex counts as success, watchers outlive a root change, or the signature advances after a failed write; why_new=Codex findings; seam=none; no_claim=the real MemPalace index
  const o = edits(t);
  const e = new KnowledgeEdits({
    docFile: () => ({ path: o.file, meta: { title: 'Price list', tags: [] } }),
    reindex: async () => null,
    openPath: async () => '', tempDir: () => o.dir, changed: (id, error) => o.calls.changed.push({ id, error }), intervalMs: 60_000
  });
  t.after(() => e.stopAll());
  await e.open('doc');
  fs.writeFileSync(o.file, 'v9');
  await e.check('doc');
  assert.match(o.calls.changed.at(-1).error, /no longer in company knowledge/);
  const src = read('src/main/index.ts');
  assert.match(src, /'knowledgeGraph' in patch\) \{\n    memory\.companyKnowledgeChanged\(\);[\s\S]{0,140}knowledgeEdits\.stopAll\(\);/);
  assert.match(read('src/main/knowledge.ts'), /catch \{ failed = true; \}[\s\S]*retry@\$\{Date\.now\(\)\}/);
});

test('Company foundations opens as a read only copy and is never watched', async (t) => {
  const o = edits(t);
  assert.deepEqual(await o.e.open('found'), { ok: true, readOnly: true });
  const copy = o.calls.opened[0];
  assert.notEqual(copy, o.file);
  assert.equal(path.basename(copy), 'Company foundations.md');
  if (process.platform !== 'win32') assert.equal(fs.statSync(copy).mode & 0o222, 0, 'no write bits');
  assert.deepEqual(o.e.watching(), []);
  // Opening it again replaces the old read only copy.
  assert.deepEqual(await o.e.open('found'), { ok: true, readOnly: true });
  assert.ok(MAX_WATCHED >= 10);
});

test('Settings lists the documents with Open, and a removed document stops being watched', () => {
  const list = read('src/renderer/src/components/KnowledgeDocList.tsx');
  assert.match(list, /window\.cth\.kgList\(\)/);
  assert.match(list, /window\.cth\.kgOpen\?\.\(d\.id\)/);
  assert.match(list, /settings\.memory\.docs\.readOnly/);
  assert.match(read('src/renderer/src/components/SettingsModal.tsx'), /<KnowledgeDocList refreshKey=\{kgDocCount\} \/>/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('kg:open'/);
  assert.match(main, /if \(typeof id === 'string'\) knowledgeEdits\.stop\(id\);/);
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const docs = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`)).settings.memory.docs;
    for (const text of Object.values(docs)) assert.doesNotMatch(text, /[–—]| - /, `${lang}: ${text}`);
  }
});

test('an edited document is mirrored again for search by meaning, and its new time changes the signature', (t) => {
  const { KnowledgeManager } = loadTsWithElectron();
  const dir = tmp(t);
  const root = path.join(dir, 'kg');
  const m = new KnowledgeManager();
  m.root = () => root;
  assert.equal(m.hasDocuments(), false, 'empty: members are not pointed at it');
  const { docId } = kg.ingest(root, { text: 'Large pizza costs 14 dollars.', title: 'Price list' });
  assert.equal(m.hasDocuments(), true);
  const first = m.meaningMirror();
  const file = path.join(first.dir, `${docId}.md`);
  assert.match(fs.readFileSync(file, 'utf8'), /14 dollars/);
  fs.utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  kg.reindex(root, docId, { text: 'Large pizza costs 16 dollars.' });
  const second = m.meaningMirror();
  assert.match(fs.readFileSync(file, 'utf8'), /16 dollars/);
  assert.notEqual(second.signature, first.signature);
});

function loadTsWithElectron() {
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false } } };
  return loadTs('src/main/knowledge.ts');
}

test('Open: an app that will not open is not watched, the oldest stops past the cap, a save mid read in is read once, and a deleted copy stops being watched', async (t) => {
  // Value: protects=the watcher's limits: no watch without an open app, at most MAX_WATCHED pollers, one reindex per save, no polling of a gone file; fails_when=a failed open is watched,
  //   the cap or its oldest first order goes, the busy guard goes (two reindexes rewrite index.jsonl together), or a deleted copy keeps polling; why_new=only the happy path and a
  //   failing reindex are tested; seam=none; no_claim=fs.watchFile timing (check called directly; reindex and openPath stubbed)
  const dir = tmp(t);
  const files = {};
  for (let i = 0; i <= MAX_WATCHED; i++) { files[`d${i}`] = path.join(dir, `d${i}.md`); fs.writeFileSync(files[`d${i}`], 'v1'); }
  let openErr = 'No application knows how to open it.';
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const reindexed = [];
  const e = new KnowledgeEdits({
    docFile: (id) => (files[id] ? { path: files[id], meta: { title: id, tags: [] } } : null),
    reindex: async (id) => { reindexed.push(id); if (id === 'd1') await gate; },
    openPath: async () => openErr,
    tempDir: () => dir,
    changed: () => {},
    intervalMs: 60_000
  });
  t.after(() => e.stopAll());
  assert.deepEqual(await e.open('d0'), { ok: false, error: openErr });
  assert.deepEqual(e.watching(), [], 'not opened: not watched');
  openErr = '';
  for (let i = 0; i <= MAX_WATCHED; i++) await e.open(`d${i}`);
  await e.open('d3'); // opened again: still one watch
  assert.equal(e.watching().length, MAX_WATCHED);
  assert.ok(!e.watching().includes('d0'), 'the oldest stops first');
  assert.ok(e.watching().includes(`d${MAX_WATCHED}`));

  fs.writeFileSync(files.d1, 'v2');
  const first = e.check('d1');
  const second = e.check('d1'); // a poll while the first read in is running
  release();
  await Promise.all([first, second]);
  await e.check('d1');
  assert.deepEqual(reindexed, ['d1'], 'one save, one read in');

  fs.rmSync(files.d2);
  await e.check('d2');
  assert.ok(!e.watching().includes('d2'), 'a gone copy stops being watched');
  assert.deepEqual(reindexed, ['d1']);
});

test('a reindex of an emptied document keeps it findable by its title, and one whose record is broken is left alone', (t) => {
  // Value: protects=kg reindex edges: empty text falls back to the title as at ingest, and a broken meta.json returns null before touching text.md or index.jsonl; fails_when=the title fallback
  //   goes (the document drops out of search), or the index is rewritten before meta is read (its lines vanish); why_new=only a normal text edit is tested; seam=none; no_claim=the extractors for Word, PDF and images (text input only)
  const dir = tmp(t);
  const root = path.join(dir, 'kg');
  const { docId } = kg.ingest(root, { text: 'Large pizza costs 14 dollars.', title: 'Price list' });
  const other = kg.ingest(root, { text: 'Opening hours are noon to ten.', title: 'Hours' }).docId;
  const meta = kg.reindex(root, docId, { text: '   ' });
  assert.equal(meta.chunkCount, 1);
  assert.equal(kg.search(root, 'pizza').length, 0, 'the old text is gone');
  assert.equal(kg.search(root, 'price')[0]?.docId, docId, 'still found by its title');

  const idx = fs.readFileSync(path.join(root, 'index.jsonl'), 'utf8');
  const textFile = path.join(root, 'docs', other, 'text.md');
  const text = fs.readFileSync(textFile, 'utf8');
  fs.writeFileSync(path.join(root, 'docs', other, 'meta.json'), '{broken');
  assert.equal(kg.reindex(root, other, { text: 'Closed on Mondays.' }), null);
  assert.equal(fs.readFileSync(path.join(root, 'index.jsonl'), 'utf8'), idx, 'the index is untouched');
  assert.equal(fs.readFileSync(textFile, 'utf8'), text, 'its text is untouched');
  assert.equal(kg.docFile(root, other), null);
  assert.equal(kg.reindex(root, '', { text: 'x' }), null);
});

test('Open never runs a file: a type that is not a document opens as its text, read only, in a fresh folder each time', async (t) => {
  // Value: protects=the Open allowlist and the fresh temp folder (security review 2026-10-20); fails_when=a .command or app opens as itself, or the read only copy goes to a fixed path a link could redirect; why_new=review findings; seam=none; no_claim=what the OS does with the copy
  const o = edits(t);
  assert.deepEqual(await o.e.open('app'), { ok: true, readOnly: true });
  const first = o.calls.opened.at(-1);
  assert.equal(path.extname(first), '.md');
  assert.equal(fs.readFileSync(first, 'utf8'), 'echo hi');
  assert.deepEqual(o.e.watching(), [], 'not watched');
  await o.e.open('found');
  await o.e.open('found');
  const [a, b] = o.calls.opened.slice(-2);
  assert.notEqual(path.dirname(a), path.dirname(b), 'a fresh folder each time');
});

test('a save that lands while one is being read in is read in right after it', async (t) => {
  // Value: protects=no lost update while a read in runs (testing and state reviews); fails_when=check returns while busy and nothing reruns it; why_new=review findings 2026-10-20; seam=none; no_claim=the file watcher's own timing
  const o = edits(t);
  let release;
  const gate = new Promise((r) => { release = r; });
  const seen = [];
  o.e.d.reindex = async () => { seen.push(fs.readFileSync(o.file, 'utf8')); if (seen.length === 1) await gate; };
  await o.e.open('doc');
  fs.writeFileSync(o.file, 'v2');
  const first = o.e.check('doc');
  fs.writeFileSync(o.file, 'v3');
  await o.e.check('doc');
  release();
  await first;
  assert.deepEqual(seen, ['v2', 'v3']);
});

test('read only copies go at launch, quit and reset; an editor\'s burst of saves is read in once it is quiet; the index is replaced whole', async (t) => {
  // Value: protects=the office's text never outlives the run in the temp folder, autosave does not reindex every tick, a reader never sees half an index (pass 3 red team and performance reviews); fails_when=copies stay, each change reindexes at once, or the index is written in place; why_new=review findings; seam=none; no_claim=a copy an editor holds locked on Windows
  const o = edits(t);
  await o.e.open('found');
  const copy = o.calls.opened.at(-1);
  fs.mkdirSync(path.join(o.dir, 'company-knowledge-earlier'));
  o.e.clearCopies();
  assert.ok(!fs.existsSync(path.dirname(copy)), 'this run\'s copy is gone');
  assert.ok(fs.existsSync(path.join(o.dir, 'company-knowledge-earlier')), 'an earlier run\'s only with all');
  o.e.clearCopies(true);
  assert.ok(!fs.existsSync(path.join(o.dir, 'company-knowledge-earlier')));
  const src = read('src/main/index.ts');
  assert.match(src, /knowledgeEdits\.clearCopies\(true\);\napp\.on\('will-quit', \(\) => \{ knowledgeEdits\.stopAll\(\); knowledgeEdits\.clearCopies\(\); \}\);/);
  assert.match(src, /knowledgeEdits\.stopAll\(\);\n  knowledgeEdits\.clearCopies\(true\);\n  const failed = eraseOfficeData/);

  const e = new KnowledgeEdits({
    docFile: () => ({ path: o.file, meta: { title: 'Price list', tags: [] } }),
    reindex: async (id) => { o.calls.reindexed.push(id); },
    openPath: async () => '', tempDir: () => o.dir, changed: () => undefined, intervalMs: 20, settleMs: 150
  });
  t.after(() => e.stopAll());
  await e.open('doc');
  o.calls.reindexed.length = 0;
  for (let i = 0; i < 4; i++) { fs.writeFileSync(o.file, `v${i + 2}`); await new Promise((r) => setTimeout(r, 40)); }
  assert.equal(o.calls.reindexed.length, 0, 'not while the saves keep coming');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(o.calls.reindexed.length, 1, 'once, after the file is quiet');

  assert.doesNotMatch(read('src/main/kg-core.cjs'), /fs\.writeFileSync\(idxPath/, 'the index is renamed into place');
});
