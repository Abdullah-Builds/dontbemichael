'use strict';

/**
 * Agent memory that improves instead of piling up (owner, 2026-09-25):
 *  - memory.md is an index of one-line entries only the app writes;
 *  - agents add notes to memory/inbox.md;
 *  - a background tidy-up on Haiku turns notes into itemised changes (never a
 *    whole-file rewrite), archives what it replaces, writes procedures;
 *  - nothing is forgotten for being unused.
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

const mi = loadTs('src/shared/memoryIndex.ts');
const { MemoryTidy, extractJson } = loadTs('src/main/memoryTidy.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

const e = (id, kind, text, source = 'task', date = '2026-09-01', expires) => ({ id, kind, text, source, date, ...(expires ? { expires } : {}) });

test('an index round-trips, and an older free-form file is recognised as not one', () => {
  const entries = [e('m1', 'preference', 'Weekly money summary goes out Monday 9am', 'owner'), e('m2', 'fact', 'Supplier cutoff is Thursday noon', 'task', '2026-09-02', '2026-12-31')];
  const text = mi.renderIndex('Oscar', 'oscar', entries);
  assert.deepEqual(mi.parseIndex(text), { isIndex: true, entries });
  assert.equal(mi.parseIndex('# Memory — Oscar (oscar)\n\n## 2026-09-24 — Closing time\n- State: idle').isIndex, false);
  assert.match(mi.entryLine(entries[1]), /\| expires 2026-12-31$/);
});

test('notes: each bullet or paragraph is one; the old header is not a note', () => {
  assert.deepEqual(mi.parseInbox('- one\n- two\n  continued\n\nthree'), ['one', 'two continued', 'three']);
  assert.deepEqual(mi.legacyNotes('# Memory — Oscar (oscar)\n\n_Append durable facts, decisions, and context below._\n\n## 2026-09-24 — Closing time\n- State: idle'), ['State: idle']);
});

test('the model\'s ops are checked: unknown ids, kinds and ops are dropped, text stays one line', () => {
  const entries = [e('m1', 'fact', 'a')];
  const { ops, dropped } = mi.validateOps({ ops: [
    { op: 'add', kind: 'fact', text: 'x | y\nz', source: 'owner' },
    { op: 'add', kind: 'secret', text: 'no' },
    { op: 'update', id: 'm9', text: 'no' },
    { op: 'delete', id: 'm1', reason: 'wrong' },
    { op: 'rewrite', text: 'everything' },
    { op: 'procedure', name: 'Weekly money summary', steps: '1. a\n2. b' }
  ] }, entries);
  assert.deepEqual(ops.map((o) => o.op), ['add', 'delete', 'procedure']);
  assert.equal(ops[0].text, 'x / y z');
  assert.deepEqual(dropped, { 'bad-kind': 1, 'unknown-id': 1, 'unknown-op': 1 });
});

test('dropped ops are counted by reason, and an all-clean reply reports none', () => {
  const entries = [e('m1', 'fact', 'a')];
  const { ops, dropped } = mi.validateOps({ ops: [
    { op: 'add', kind: 'fact', text: '', source: 'task' },
    { op: 'add', kind: 'fact', text: 'ok', source: 'task' },
    { op: 'delete', id: 'm9', reason: 'no' },
    null
  ] }, entries);
  assert.deepEqual(ops.map((o) => o.op), ['add']);
  assert.deepEqual(dropped, { 'missing-text': 1, 'unknown-id': 1, malformed: 1 });
  assert.deepEqual(mi.validateOps({ ops: [{ op: 'add', kind: 'fact', text: 'fine', source: 'task' }] }, entries).dropped, {});
});

test('changes are itemised: add, update, delete, procedure; replaced entries are archived', () => {
  const entries = [e('m1', 'fact', 'Price list is v1'), e('m2', 'preference', 'Summaries in bullet points', 'owner')];
  const out = mi.applyOps(entries, [
    { op: 'update', id: 'm1', text: 'Price list is v2' },
    { op: 'update', id: 'm2', repeat: true },
    { op: 'add', kind: 'reference', text: 'Invoices live in Finance/Invoices', source: 'task' },
    { op: 'procedure', name: 'Weekly money summary', steps: '1. a', source: 'task' }
  ], '2026-09-25');
  assert.deepEqual(out.entries.map((x) => x.id), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(out.entries[0].text, 'Price list is v2');
  assert.deepEqual(out.archived.map((a) => a.entry.text), ['Price list is v1'], 'the replaced fact is kept in the archive');
  assert.equal(out.procedures[0].slug, 'weekly-money-summary');
  assert.equal(out.entries[3].text, 'Weekly money summary: steps in memory/procedures/weekly-money-summary.md');
  assert.deepEqual(out.stats, { added: 1, updated: 2, deleted: 0, procedures: 1, repeats: 1, dupes: 0 });
  const del = mi.applyOps(out.entries, [{ op: 'delete', id: 'm3', reason: 'moved' }], '2026-09-26');
  assert.equal(del.entries.length, 3);
  assert.match(mi.archiveLines(del.archived, '2026-09-26'), /archived 2026-09-26: moved$/);
});

test('duplicate adds are skipped and counted, by normalized text and within one batch', () => {
  const entries = [e('m1', 'fact', 'Supplier cutoff is Thursday noon')];
  const out = mi.applyOps(entries, [
    { op: 'add', kind: 'fact', text: 'Weekly payroll runs Friday', source: 'task' },
    { op: 'add', kind: 'fact', text: 'weekly payroll runs friday', source: 'task' },
    { op: 'add', kind: 'fact', text: '  Weekly   payroll runs Friday ', source: 'task' }
  ], '2026-10-13');
  assert.equal(out.stats.added, 1);
  assert.equal(out.stats.dupes, 2);
  assert.equal(out.entries.length, 2, 'the existing entry plus one add');
  assert.equal(out.entries[1].text, 'Weekly payroll runs Friday');
});

test('an add matches the index as it stands: a delete, a merge or an update frees the text up', () => {
  const text = 'Rent is due on the 1st';
  const gone = mi.applyOps([e('m1', 'fact', text, 'owner')], [
    { op: 'delete', id: 'm1', reason: 'wrong kind' },
    { op: 'add', kind: 'preference', text, source: 'owner' }
  ], '2026-10-18');
  assert.deepEqual(gone.entries.map((x) => [x.id, x.kind, x.text]), [['m2', 'preference', text]], 'the deleted entry and its add-back is one entry, not none');
  assert.deepEqual(gone.stats, { added: 1, updated: 0, deleted: 1, procedures: 0, repeats: 0, dupes: 0 });

  const merged = mi.applyOps([e('m1', 'fact', 'Rent is due on the 1st', 'owner'), e('m2', 'fact', 'Rent is due on the 1st.', 'owner')], [
    { op: 'delete', id: 'm1', reason: 'merged' },
    { op: 'delete', id: 'm2', reason: 'merged' },
    { op: 'add', kind: 'fact', text: 'Rent is due on the 1st', source: 'owner' }
  ], '2026-10-18');
  assert.deepEqual(merged.entries.map((x) => x.text), ['Rent is due on the 1st'], 'merging two near duplicates keeps the one line');
  assert.deepEqual(merged.stats, { added: 1, updated: 0, deleted: 2, procedures: 0, repeats: 0, dupes: 0 });

  const moved = mi.applyOps([e('m1', 'fact', text, 'owner')], [
    { op: 'update', id: 'm1', text: 'Rent is due on the 5th' },
    { op: 'add', kind: 'fact', text, source: 'owner' }
  ], '2026-10-18');
  assert.deepEqual(moved.entries.map((x) => x.text), ['Rent is due on the 5th', text], 'the old text is no longer in the index, so it can be re-added');
  assert.equal(moved.stats.added, 1);
  assert.equal(moved.stats.dupes, 0);
});

function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memtidy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'oscar');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const log = [];
  let idle = false;
  const tidy = new MemoryTidy(() => home, () => 'claude', () => ({}), () => idle, () => 'Oscar', (ev) => log.push(ev));
  const asked = [];
  let reply = { ops: [] };
  tidy.askModel = async (_home, entries, notes) => { asked.push({ entries, notes }); return reply; };
  return { home, dir, tidy, log, asked, setReply: (r) => { reply = r; }, setIdle: (v) => { idle = v; } };
}

test('an old free-form memory is migrated once: lessons kept, the original backed up', async (t) => {
  const f = office(t);
  fs.writeFileSync(path.join(f.dir, 'memory.md'), '# Memory — Oscar (oscar)\n\n_Append durable facts, decisions, and context below._\n\n## 2026-09-24 — Closing time\n- State: idle, nothing assigned.\n- scheduler is not an addressable agent.\n');
  f.setReply({ ops: [{ op: 'add', kind: 'fact', text: 'scheduler is not an addressable agent', source: 'task' }] });
  const [r] = await f.tidy.tidyNow();
  assert.equal(r.reason, 'migrated');
  assert.deepEqual(f.asked[0].notes, ['State: idle, nothing assigned.', 'scheduler is not an addressable agent.']);
  const idx = mi.parseIndex(fs.readFileSync(path.join(f.dir, 'memory.md'), 'utf8'));
  assert.equal(idx.isIndex, true);
  assert.deepEqual(idx.entries.map((x) => x.text), ['scheduler is not an addressable agent']);
  const backups = fs.readdirSync(path.join(f.home, 'hive', 'backups'));
  assert.equal(backups.length, 1, 'the original is backed up');
  assert.equal(f.log[0].kind, 'memory-tidy');
});

test('notes wait until there are 10, a day has passed, or the office is idle', async (t) => {
  const f = office(t);
  fs.writeFileSync(path.join(f.dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', []));
  fs.writeFileSync(path.join(f.dir, 'memory', 'state.json'), JSON.stringify({ lastTidyAt: Date.now() }));
  fs.writeFileSync(path.join(f.dir, 'memory', 'inbox.md'), '- one note\n');
  assert.deepEqual(await f.tidy.tidyNow(), [], 'one note, a busy office, tidied recently: wait');
  f.setIdle(true);
  const [r] = await f.tidy.tidyNow();
  assert.equal(r.tidied, true, 'the office went quiet');
  assert.equal(fs.existsSync(path.join(f.dir, 'memory', 'inbox.md')), false, 'processed notes leave the inbox');
});

test('if the model call fails, the notes go back into the inbox untouched', async (t) => {
  const f = office(t);
  fs.writeFileSync(path.join(f.dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', []));
  fs.writeFileSync(path.join(f.dir, 'memory', 'inbox.md'), Array.from({ length: 10 }, (_, i) => `- note ${i}`).join('\n'));
  f.tidy.askModel = async () => { throw new Error('offline'); };
  const [r] = await f.tidy.tidyNow();
  assert.equal(r.tidied, false);
  assert.equal(mi.parseInbox(fs.readFileSync(path.join(f.dir, 'memory', 'inbox.md'), 'utf8')).length, 10);
  assert.equal(f.log[0].kind, 'memory-tidy-abort');
});

test('a reply without a list of changes puts the notes back', async (t) => {
  const f = office(t);
  fs.writeFileSync(path.join(f.dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', []));
  fs.writeFileSync(path.join(f.dir, 'memory', 'inbox.md'), Array.from({ length: 10 }, (_, i) => `- note ${i}`).join('\n'));
  f.setReply({ op: 'add', kind: 'fact', text: 'x', source: 'task' });
  const [r] = await f.tidy.tidyNow();
  assert.equal(r.tidied, false);
  assert.equal(mi.parseInbox(fs.readFileSync(path.join(f.dir, 'memory', 'inbox.md'), 'utf8')).length, 10);
});

test('a replaced procedure is backed up, and a long name keeps its path', async (t) => {
  const f = office(t);
  fs.writeFileSync(path.join(f.dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', []));
  fs.mkdirSync(path.join(f.dir, 'memory', 'procedures'), { recursive: true });
  const name = 'Weekly summary';
  const slug = mi.procedureSlug(name);
  fs.writeFileSync(path.join(f.dir, 'memory', 'procedures', `${slug}.md`), 'old steps');
  fs.writeFileSync(path.join(f.dir, 'memory', 'inbox.md'), Array.from({ length: 10 }, (_, i) => `- note ${i}`).join('\n'));
  f.setReply({ ops: [{ op: 'procedure', name, steps: '1. new', source: 'task' }] });
  await f.tidy.tidyNow();
  const stamp = fs.readdirSync(path.join(f.home, 'hive', 'backups'))[0];
  assert.equal(fs.readFileSync(path.join(f.home, 'hive', 'backups', stamp, 'oscar', 'procedures', `${slug}.md`), 'utf8'), 'old steps');
  const long = 'x'.repeat(190);
  const a = mi.applyOps([], [{ op: 'procedure', name: long, steps: '1. a', source: 'task' }], '2026-09-25');
  const b = mi.applyOps(a.entries, [{ op: 'procedure', name: long, steps: '1. b', source: 'task' }], '2026-09-25');
  assert.equal(b.entries.length, 1, 'updated in place, not duplicated');
  assert.match(b.entries[0].text, /memory\/procedures\/.+\.md$/);
});

test('JSON is found in a fenced or chatty reply', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"ops":[]}\n```'), { ops: [] });
  assert.equal(extractJson('nothing'), undefined);
});

test('a new agent starts with an empty index, and the index reaches it once per session', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memidx-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  const file = path.join(home, 'hive', 'agents', 'oscar', 'memory.md');
  assert.equal(mi.parseIndex(fs.readFileSync(file, 'utf8')).isIndex, true);
  assert.equal(hive.memoryIndexFor('oscar'), null, 'nothing to give yet');
  fs.writeFileSync(file, mi.renderIndex('Oscar', 'oscar', [e('m1', 'preference', 'Bullet points please', 'owner')]));
  assert.match(hive.memoryIndexFor('oscar'), /^YOUR MEMORY\.[\s\S]*- \[m1\] preference \| Bullet points please \| owner/);
  const hooks = fs.readFileSync(path.resolve(__dirname, '../src/main/hooks.ts'), 'utf8');
  assert.match(hooks, /if \(event === 'SessionStart' \|\| this\.deliveredMemoryByAgent\.get\(agentId\) !== sessionId\)/);
});

test('agents are told to add notes, not logs, and closing time no longer writes to memory', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memprompt-'));
  const hive = new HiveManager(() => home);
  const inj = await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home });
  const prompt = inj.args[inj.args.indexOf('--append-system-prompt') + 1];
  assert.match(prompt, /add at most three short notes to .*memory.inbox\.md/);
  assert.match(prompt, /Don't write session logs or status updates/);
  assert.doesNotMatch(prompt, /append what you learned to memory\.md/);
  const closing = fs.readFileSync(path.resolve(__dirname, '../src/main/closingTime.ts'), 'utf8');
  assert.doesNotMatch(closing, /append (its|your) (current state|shift summary)[^']*memory\.md/);
});

test('the tidy up runs with no tools and no MCP servers', () => {
  const tidy = fs.readFileSync(path.resolve(__dirname, '../src/main/memoryTidy.ts'), 'utf8');
  const hidden = fs.readFileSync(path.resolve(__dirname, '../src/main/hiddenClaude.ts'), 'utf8');
  assert.match(tidy, /noTools: true,/);
  assert.match(hidden, /opts\.noTools \? \['--tools', '', '--strict-mcp-config'\]/);
});

test('a pass reports only the notes new to the index: an edit, a repeat or a replaced procedure is not new', () => {
  // Value: protects=Pulse's Learning count (owner, 2026-10-18: 4 notes today were 3 new and 1 edit); fails_when=an update, a repeat or an existing procedure is reported as added, a new procedure pointer is missed, or a note added and deleted in one pass is reported; why_new=the count moved from note dates to add events; seam=none; no_claim=what the notes say
  const base = [
    { id: 'm1', kind: 'fact', text: 'Invoices go to the shared box', source: 'owner', date: '2026-10-01' },
    { id: 'm2', kind: 'procedure', text: 'Close the month: steps in memory/procedures/close-the-month.md', source: 'task', date: '2026-10-02' }
  ];
  const out = mi.applyOps(base, [
    { op: 'update', id: 'm1', text: 'Invoices go to the shared box, copy Oscar' },
    { op: 'update', id: 'm1', repeat: true },
    { op: 'procedure', name: 'Close the month', steps: '1. Reconcile', source: 'task' },
    { op: 'add', kind: 'fact', text: 'Rent is due on the 1st', source: 'michael' },
    { op: 'procedure', name: 'Weekly money summary', steps: '1. Totals', source: 'owner' },
    { op: 'add', kind: 'fact', text: 'A note that is gone at once', source: 'task' },
    { op: 'delete', id: 'm5', reason: 'wrong' }
  ], '2026-10-18');
  assert.deepEqual(out.added, [{ id: 'm3', source: 'michael' }, { id: 'm4', source: 'owner' }]);
});

function addedOffice(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-memadded-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'oscar');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory.md'), mi.renderIndex('Oscar', 'oscar', [{ id: 'm1', kind: 'fact', text: 'Old fact', source: 'task', date: '2026-10-01' }]));
  fs.writeFileSync(path.join(dir, 'memory', 'inbox.md'), '- a note\n');
  const reported = [];
  const tidy = new MemoryTidy(() => home, () => 'claude', () => ({}), () => true, () => 'Oscar', () => {}, () => ({}), (id, added) => reported.push([id, added]));
  return { dir, tidy, reported };
}

test('the tidy pass hands its new notes on once the index is written', async (t) => {
  // Value: protects=the note-added record Pulse counts from (owner, 2026-10-18); fails_when=added notes are not reported or an edit is reported; why_new=the count moved from note dates to the app's own record; seam=temp hive, model stubbed; no_claim=the telemetry store itself
  const f = addedOffice(t);
  f.tidy.askModel = async () => ({ ops: [{ op: 'update', id: 'm1', text: 'Old fact, edited' }, { op: 'add', kind: 'fact', text: 'New fact', source: 'owner' }] });
  await f.tidy.tidyNow();
  assert.deepEqual(f.reported, [['oscar', [{ id: 'm2', source: 'owner' }]]]);
  assert.ok(fs.readFileSync(path.join(f.dir, 'memory.md'), 'utf8').includes('New fact'), 'reported after the index holds it');
});

test('a pass whose state write fails after the index landed counts its notes once and never hands them back', async (t) => {
  // Value: protects=one note, one count, one index line; fails_when=a failed step after the index write restores the inbox, so the next pass adds and counts the note again; why_new=ship review (state machine and QA probe); seam=state.json made a folder
  const f = addedOffice(t);
  const state = path.join(f.dir, 'memory', 'state.json');
  fs.mkdirSync(state);
  f.tidy.askModel = async () => ({ ops: [{ op: 'add', kind: 'fact', text: 'New fact', source: 'owner' }] });
  await f.tidy.tidyNow();
  fs.rmdirSync(state);
  await f.tidy.tidyNow();
  assert.deepEqual(f.reported, [['oscar', [{ id: 'm2', source: 'owner' }]]]);
  assert.equal(fs.readFileSync(path.join(f.dir, 'memory.md'), 'utf8').split('\n').filter((l) => l.includes('New fact')).length, 1);
});

test('held notes that cannot be removed after going back to the inbox come back only once', { skip: process.platform === 'win32' }, async (t) => {
  // Value: protects=a locked processing file never adds the same notes again each pass; fails_when=the stranded recovery appends and then leaves the file full; why_new=ship review cycle 3; seam=a read only memory folder blocks the delete, not the inbox append
  const f = addedOffice(t);
  const mem = path.join(f.dir, 'memory');
  fs.writeFileSync(path.join(mem, 'inbox.md'), '');
  fs.writeFileSync(path.join(mem, 'inbox.processing.md'), '- a stranded note\n');
  fs.chmodSync(mem, 0o500);
  t.after(() => { try { fs.chmodSync(mem, 0o700); } catch { /* gone */ } });
  f.tidy.askModel = async () => { throw new Error('no model'); };
  await f.tidy.tidyNow();
  await f.tidy.tidyNow();
  fs.chmodSync(mem, 0o700);
  const inbox = fs.readFileSync(path.join(mem, 'inbox.md'), 'utf8');
  assert.equal(inbox.split('a stranded note').length - 1, 1, 'back once');
});

test('a processing file left after the index landed is never read back into the inbox', async (t) => {
  // Value: protects=a cleanup that failed (Windows can hold the file open) never adds or counts notes twice; fails_when=the stranded recovery appends notes the index already has; why_new=ship review cycle 2; seam=the processing file emptied as the fallback leaves it
  const f = addedOffice(t);
  f.tidy.askModel = async () => ({ ops: [{ op: 'add', kind: 'fact', text: 'New fact', source: 'owner' }] });
  await f.tidy.tidyNow();
  // What the fallback leaves when the file cannot be removed: an empty file.
  fs.writeFileSync(path.join(f.dir, 'memory', 'inbox.processing.md'), '');
  f.tidy.askModel = async () => ({ ops: [] });
  await f.tidy.tidyNow();
  assert.deepEqual(f.reported, [['oscar', [{ id: 'm2', source: 'owner' }]]]);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir, 'memory', 'inbox.md'), 'utf8').replace(/\s/g, ''), /\S/, 'nothing came back');
});

// POSIX only: a read only folder is how the write is made to fail, and Windows
// ignores those permission bits (platform-scoped tests, owner 2026-10-09).
test('a pass whose index write fails reports no new notes', { skip: process.platform === 'win32' }, async (t) => {
  // Value: protects=the count never includes a note that did not land; fails_when=the report happens before or without the index write; why_new=owner 2026-10-18; seam=read only agent folder; no_claim=Windows
  const f = addedOffice(t);
  fs.chmodSync(f.dir, 0o500);
  t.after(() => { try { fs.chmodSync(f.dir, 0o700); } catch { /* gone */ } });
  f.tidy.askModel = async () => ({ ops: [{ op: 'add', kind: 'fact', text: 'Never written', source: 'task' }] });
  const [r] = await f.tidy.tidyNow();
  fs.chmodSync(f.dir, 0o700);
  assert.equal(r.tidied, false, 'the index could not be written');
  assert.deepEqual(f.reported, []);
});
