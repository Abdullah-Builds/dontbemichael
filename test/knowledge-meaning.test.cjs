'use strict';

/**
 * Company knowledge searched by meaning (owner, 2026-09-25) through MemPalace,
 * the local vector store the app already drives for agents' memory: a mirror of
 * the store, one file per document with its title and id on top, is indexed
 * into the palace's "company" section, and removed documents are pruned.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { posixOnly } = require('./platform.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-meaning-'));
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: {
    app: { getPath: () => userData, isPackaged: false, getAppPath: () => path.resolve(__dirname, '..') },
    Notification: class { show() {} static isSupported() { return false; } }
  }
};

const { KnowledgeManager } = loadTs('src/main/knowledge.ts');
const { MemoryManager } = loadTs('src/main/memory.ts');
const { companyKnowledgeLine } = loadTs('src/main/hive.ts');

test('the mirror holds one file per document, titled, and drops removed ones', () => {
  const k = new KnowledgeManager();
  const a = k.ingestText('Refunds are given within 30 days with a receipt.', { title: 'Refund policy' });
  const b = k.ingestText('Open 9am to 6pm.', { title: 'Opening hours' });
  const m = k.meaningMirror();
  const text = fs.readFileSync(path.join(m.dir, `${a.docId}.md`), 'utf8');
  assert.match(text, /^Title: Refund policy\nDocument id: [\w-]+\n\nRefunds are given/);
  assert.ok(fs.existsSync(path.join(m.dir, `${b.docId}.md`)));
  k.remove(b.docId);
  const m2 = k.meaningMirror();
  assert.ok(!fs.existsSync(path.join(m.dir, `${b.docId}.md`)), 'a removed document leaves the mirror');
  assert.notEqual(m2.signature, m.signature, 'so it gets indexed again');
});

test('the palace indexes the mirror into "company", prunes, and skips an unchanged store', posixOnly('fakes the mempalace binary with a #!/bin/sh script'), async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-palace-'));
  const log = path.join(home, 'calls.log');
  const bin = path.join(home, 'mempalace');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  let src = { dir: '/store/meaning', signature: 'a,b' };
  const memory = new MemoryManager(() => home, () => ({ enabled: true, model: 'minilm' }), () => src);
  memory.bin = () => bin;
  t.after(() => memory.stop());
  await memory.mineNow();
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(calls(), [
    'mine /store/meaning --wing company --agent company',
    'sync --wing company --apply /store/meaning'
  ]);
  await memory.mineNow();
  assert.equal(calls().length, 2, 'unchanged: not indexed again');
  src = { dir: '/store/meaning', signature: 'a' };
  await memory.mineNow();
  assert.equal(calls().length, 4, 'a document removed: indexed and pruned');
});

test('agents are told to search by meaning when MemPalace is there, and by words either way', () => {
  const withMeaning = companyKnowledgeLine('/n', '/kg.cjs', '/store', { bin: '/bin/mempalace', palace: '/h/palace' });
  assert.ok(withMeaning.includes('Search by meaning with `"/bin/mempalace" --palace "/h/palace" search "<question>" --wing company`'));
  assert.ok(withMeaning.includes('"/n" "/kg.cjs" search "<words>" --root "/store"'));
  const without = companyKnowledgeLine('/n', '/kg.cjs', '/store');
  assert.doesNotMatch(without, /by meaning/);
  assert.doesNotMatch(withMeaning, /[–—]/);
});
