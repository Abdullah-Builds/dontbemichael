'use strict';
/**
 * The Memory tab reads like notes, not the raw index
 * (docs/designs/memory-tab-readable.md, owner 2026-09-25).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { memoryView, procedurePointer, isProcedureSlug, expiryState, MAX_PROCEDURE_CHARS } = loadTs('src/shared/memoryIndex.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

// The shape of Michael's real index, including a hand-written line the parser skips.
const MICHAEL = [
  '# Memory, Michael (god)',
  '',
  '<!-- memory index v1 -->',
  'The app keeps this file. Add notes to memory/inbox.md; they are sorted in here in the background.',
  '',
  '- [m1] fact | Work routing: email goes to Pam first | task | 2026-09-25',
  '- [m3] reference | Office folder: ~/Documents/SunriseBakery/Office | task | 2026-09-25',
  '- [m4] preference | Never email a customer without asking | owner | 2026-09-24',
  '- [m5] fact | Cloud Scheduler retryCount=0 | tool | 2026-09-25 | expires 2026-10-30',
  '- [m11] procedure | Shutdown protocol: steps in memory/procedures/shutdown-protocol.md | task | 2026-09-25',
  '- LESSON: agents can\'t wake on a date.',
  ''
].join('\n');

test('entries group by kind, owner preferences first, and the file chrome is dropped', () => {
  const v = memoryView(MICHAEL);
  assert.equal(v.isIndex, true);
  assert.deepEqual(v.groups.map((g) => g.kind), ['preference', 'procedure', 'fact', 'reference']);
  assert.equal(v.groups.find((g) => g.kind === 'fact').entries.length, 2);
  assert.deepEqual(v.other, ["LESSON: agents can't wake on a date."], 'the hand-written line is kept, the heading, marker and note are not');
});

test('empty groups are left out; an empty index has nothing to show', () => {
  const v = memoryView('# Memory, Pam (pam)\n\n<!-- memory index v1 -->\nThe app keeps this file.\n');
  assert.deepEqual(v.groups, []);
  assert.deepEqual(v.other, []);
});

test('an older free-form memory is not an index (the tab renders it as markdown)', () => {
  const v = memoryView('# Memory\n\n- likes tea\n');
  assert.equal(v.isIndex, false);
  assert.deepEqual(v.other, []);
});

test('procedure pointers give a name and a slug; anything else is null', () => {
  assert.deepEqual(procedurePointer('Shutdown protocol: steps in memory/procedures/shutdown-protocol.md'), { name: 'Shutdown protocol', slug: 'shutdown-protocol' });
  assert.equal(procedurePointer('Shutdown protocol'), null);
  assert.equal(procedurePointer('x: steps in memory/procedures/../../secrets.md'), null);
});

test('only app-written slugs are readable', () => {
  assert.equal(isProcedureSlug('weekly-money-summary'), true);
  for (const bad of ['../x', 'a/b', '', 'A', 'a..b', 'a.md', 'x'.repeat(61), null]) assert.equal(isProcedureSlug(bad), false, String(bad));
});

test('expiry: ahead, passed, or none', () => {
  assert.equal(expiryState('2026-10-30', '2026-09-25'), 'future');
  assert.equal(expiryState('2026-10-30', '2026-10-30'), 'future', 'the day itself still counts');
  assert.equal(expiryState('2026-09-01', '2026-09-25'), 'passed');
  assert.equal(expiryState(undefined, '2026-09-25'), 'none');
});

async function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memory-tab-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const dir = path.join(home, 'hive', 'agents', 'pam');
  fs.mkdirSync(path.join(dir, 'memory', 'procedures'), { recursive: true });
  return { hive, home, dir };
}

test('memoryDetail counts the notes waiting in memory/inbox.md', async (t) => {
  const { hive, dir } = await office(t);
  fs.writeFileSync(path.join(dir, 'memory', 'inbox.md'), '- one\n- two\n\nthree\n');
  const d = hive.memoryDetail('pam');
  assert.equal(d.waiting, 3);
  assert.equal(typeof d.index, 'string');
  assert.deepEqual(hive.memoryDetail('../pam'), { index: '', waiting: 0 });
});

test('procedure reads stay inside the agent folder, capped, null when missing', async (t) => {
  const { hive, home, dir } = await office(t);
  fs.writeFileSync(path.join(dir, 'memory', 'procedures', 'shutdown-protocol.md'), '# Shutdown protocol\n\n1. Broadcast\n');
  fs.writeFileSync(path.join(dir, 'memory', 'procedures', 'huge.md'), 'x'.repeat(MAX_PROCEDURE_CHARS + 500));
  fs.writeFileSync(path.join(home, 'secret.md'), 'nope');
  assert.match(hive.procedure('pam', 'shutdown-protocol'), /1\. Broadcast/);
  assert.equal(hive.procedure('pam', 'huge').length, MAX_PROCEDURE_CHARS);
  assert.equal(hive.procedure('pam', 'missing'), null);
  assert.equal(hive.procedure('pam', '../../../secret'), null);
  assert.equal(hive.procedure('../..', 'secret'), null);
});

test('the tab shows the memory first and one search box below it', () => {
  const src = read('src/renderer/src/components/CommandCenterPanel.tsx');
  const tab = src.slice(src.indexOf('function MemoryTab('), src.indexOf('const srOnly'));
  assert.ok(tab.indexOf('<MemoryNotes') > 0 && tab.indexOf('<MemoryNotes') < tab.indexOf("memoryNotes.searchTitle')}</h3>"), 'notes before search');
  assert.equal((tab.match(/<input/g) || []).length, 1, 'one search box');
  // Exact words only: search by meaning covers company knowledge, in Settings (owner, 2026-10-19).
  assert.doesNotMatch(tab, /role="radiogroup"/);
  assert.match(tab, /aria-pressed=\{showFile\}/, 'Show the file toggles the raw text');
  assert.match(tab, /<MarkdownPreview source=\{detail\.index\} variant="card" \/>/, 'free-form memory falls back to markdown');
});

test('the notes view uses list semantics, a disclosure for steps, and the divided-list rule', () => {
  const src = read('src/renderer/src/components/MemoryNotes.tsx');
  assert.match(src, /<h3/);
  assert.match(src, /<ul style/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /window\.cth\.hiveProcedure\(agentId, slug\)/);
  assert.match(src, /! \$\{t\('memoryNotes\.outOfDate'/, 'a passed date is not color only');
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-memory-row \+ \.cth-memory-row \{ border-top: 1px solid var\(--cth-ink-100\); \}/);
});

test('strings exist in every language, Michael by godName, no dashes', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).memoryNotes;
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).memoryNotes;
    assert.deepEqual(keys(d).sort(), keys(en).sort(), loc);
    assert.match(d.source.michael, /\{\{godName\}\}/, loc);
    for (const k of keys(d)) {
      const v = k.split('.').reduce((o, x) => o[x], d);
      assert.doesNotMatch(v, /[–—]| - /, `${loc} ${k}`);
      assert.doesNotMatch(v, /Michael/, `${loc} ${k}`);
    }
  }
});

test('every agent has its own Memory tab; Michael keeps the picker and the office search', () => {
  const panel = read('src/renderer/src/components/AgentDetailPanel.tsx');
  assert.match(panel, /\{sidebarTab === 'memory' && \(\s*<MemoryTab key=\{agent\.id\} godId=\{agent\.id\} ownOnly \/>/);
  const src = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(src, /const who = ownOnly \? godId : \(controlledWho \?\? internalWho\);/, 'a team member sees only its own memory');
  assert.match(src, /\{!ownOnly && \(\s*<label/, 'no picker on a team member tab');
  assert.match(src, /\{!ownOnly && <section/, 'no office search on a team member tab');
  assert.match(src, /<MemoryTab godId=\{agent\.id\} who=\{selectedMemoryAgent \?\? undefined\} onWho=\{setSelectedMemoryAgent\} \/>/, "Michael's tab unchanged");
  for (const loc of ['en', 'zh-CN', 'ar']) assert.ok(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).sidebar.memory, loc);
});

test('every slug the app writes can be read back', () => {
  const { procedureSlug } = loadTs('src/shared/memoryIndex.ts');
  for (const name of ['-foo', 'Shutdown protocol', 'Weekly money: summary!', '  spaced  out  ']) {
    const slug = procedureSlug(name);
    assert.equal(isProcedureSlug(slug), true, `${name} -> ${slug}`);
    assert.deepEqual(procedurePointer(`${name.trim()}: steps in memory/procedures/${slug}.md`)?.slug, slug);
  }
});

test('procedures named with no Latin letters each keep their own file', () => {
  const { procedureSlug, applyOps } = loadTs('src/shared/memoryIndex.ts');
  const names = ['每周财务汇总', '库存盘点', 'إغلاق نهاية اليوم', 'साप्ताहिक रिपोर्ट'];
  const slugs = names.map(procedureSlug);
  assert.equal(new Set(slugs).size, names.length, slugs.join(', '));
  for (const [i, slug] of slugs.entries()) {
    assert.equal(isProcedureSlug(slug), true, slug);
    assert.equal(procedureSlug(` ${names[i]} `), slug, 'the same name always gives the same file');
  }
  const ops = names.map((name, i) => ({ op: 'procedure', name, steps: `1. step ${i}`, source: 'task' }));
  const r = applyOps([], ops, '2026-10-12');
  assert.equal(r.entries.length, names.length, 'one pointer each, none replaced');
  assert.deepEqual(r.entries.map((e) => procedurePointer(e.text)?.slug), slugs);
});

test('a name with letters NFKD turns uppercase still gives a readable slug', () => {
  const { procedureSlug } = loadTs('src/shared/memoryIndex.ts');
  for (const name of ['ℍow to ship', 'Deploy ℝ']) assert.equal(isProcedureSlug(procedureSlug(name)), true, procedureSlug(name));
});
