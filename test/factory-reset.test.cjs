'use strict';

/**
 * Settings → "Reset & start over" leaves a true first run (owner, 2026-10-14:
 * demos from a separate Mac user should reset in the app, not with rm -rf).
 * It used to erase only the hive and the palace, so Research's desk and
 * threads, Company knowledge, saved keys, the history database and mail and
 * Slack files carried into the next office.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { eraseOfficeData, isKnowledgeStore, OFFICE_FOLDER_ENTRIES, PRIVATE_ENTRIES, APP_DATA_ENTRIES, APP_DATA_KEPT } = loadTs('src/main/factoryReset.ts');
const { writeOfficeRecord } = loadTs('src/main/officeFile.ts');

function seed(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    if (/\.(json|db|db-wal|db-shm)$/.test(n)) fs.writeFileSync(p, '{}');
    else { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'inside.txt'), 'x'); }
  }
}

test('reset erases everything the app made for the office, and keeps the owner\'s files and the roster backups', (t) => {
  // Value: protects=a reset office starts as a new owner sees it; fails_when=an app-made entry is left behind or an owner file is removed; why_new=reset erased only the hive and palace; seam=fs; no_claim=the relaunch itself (index.ts)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md reset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'Harness Agents');
  const userData = path.join(root, 'app data');
  const elsewhere = path.join(root, 'claude', 'projects', 'trust-check');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  seed(home, OFFICE_FOLDER_ENTRIES);
  fs.mkdirSync(path.join(home, 'private'));
  seed(path.join(home, 'private'), PRIVATE_ENTRIES);
  writeOfficeRecord(home, { version: 1, businessName: 'Northside Bakery', team: [] });
  seed(userData, APP_DATA_ENTRIES);
  // What must stay: the owner's own file in the office folder, the archived
  // rosters, and what describes this install rather than the office.
  fs.writeFileSync(path.join(home, 'my notes.txt'), 'mine');
  seed(home, ['roster-backups']);
  for (const keep of ['config.json', 'updater.log', 'last-run-version', 'model-catalog.json']) fs.writeFileSync(path.join(userData, keep), 'keep');

  const failed = eraseOfficeData({ home, userData, extra: [elsewhere, ''] });

  assert.deepEqual(failed, []);
  for (const n of OFFICE_FOLDER_ENTRIES) assert.equal(fs.existsSync(path.join(home, n)), false, `office folder: ${n}`);
  assert.equal(fs.existsSync(path.join(home, 'private')), false, 'the emptied private folder goes too');
  assert.equal(fs.existsSync(path.join(home, 'office.json')), false, 'the app\'s office record');
  for (const n of APP_DATA_ENTRIES) assert.equal(fs.existsSync(path.join(userData, n)), false, `app data: ${n}`);
  assert.equal(fs.existsSync(elsewhere), false, 'a folder passed in extra');
  assert.equal(fs.readFileSync(path.join(home, 'my notes.txt'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(home, 'roster-backups', 'inside.txt')));
  for (const keep of ['config.json', 'updater.log', 'last-run-version', 'model-catalog.json']) assert.ok(fs.existsSync(path.join(userData, keep)), keep);
});

test('in a folder the owner chose, their own private folder and office.json stay', (t) => {
  // Value: protects=a reset never deletes the owner's files that share a plain name with the app's; fails_when=private/ or office.json is removed whole; why_new=ship coverage audit: these names are generic; seam=fs; no_claim=names the app does not use
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-own-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-own-data-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(userData, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, 'hive'));
  fs.writeFileSync(path.join(home, 'hive', 'registry.json'), '{}');
  fs.mkdirSync(path.join(home, 'private'));
  fs.writeFileSync(path.join(home, 'private', 'tax return.pdf'), 'mine');
  seed(path.join(home, 'private'), ['card-guard.json', 'owner']);
  fs.writeFileSync(path.join(home, 'office.json'), JSON.stringify({ desks: 4, plants: 2 }));
  assert.deepEqual(eraseOfficeData({ home, userData }), []);
  assert.equal(fs.readFileSync(path.join(home, 'private', 'tax return.pdf'), 'utf8'), 'mine');
  assert.equal(fs.existsSync(path.join(home, 'private', 'card-guard.json')), false, 'the app\'s own file in it goes');
  assert.equal(fs.existsSync(path.join(home, 'private', 'owner')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'office.json'), 'utf8')), { desks: 4, plants: 2 }, 'not the app\'s record, so it stays');
});

test('a folder that is not an office, or is the home folder, keeps everything in it', (t) => {
  // Value: protects=a reset with a broad or wrong office folder never deletes the owner's own folders of the same names; fails_when=isOfficeFolder is dropped or the home folder check goes; why_new=ship security review; seam=HOME env; no_claim=Windows home resolution
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-plain-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-plain-data-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const d of [plain, userData]) fs.rmSync(d, { recursive: true, force: true });
  });
  seed(plain, ['agent-tmp', 'research-desk']);
  assert.deepEqual(eraseOfficeData({ home: plain, userData }), []);
  assert.ok(fs.existsSync(path.join(plain, 'agent-tmp', 'inside.txt')), 'no office in it, so nothing goes');
  seed(plain, ['hive']);
  fs.writeFileSync(path.join(plain, 'hive', 'registry.json'), '{}');
  // HOME on a Mac and Linux, USERPROFILE on Windows.
  process.env.HOME = plain;
  process.env.USERPROFILE = plain;
  assert.equal(os.homedir(), plain);
  assert.deepEqual(eraseOfficeData({ home: plain, userData }), []);
  assert.ok(fs.existsSync(path.join(plain, 'agent-tmp', 'inside.txt')), 'the home folder is never cleared, office or not');
  assert.ok(fs.existsSync(path.join(plain, 'hive', 'registry.json')));
});

test('every app data file the main process names is erased by a reset or kept on purpose', () => {
  // Value: protects=a new app data file can't silently carry across a reset; fails_when=a join(app.getPath('userData'), name) is added to neither list; why_new=ship testing review; seam=none; no_claim=names built at run time
  const dir = path.join(__dirname, '..', 'src', 'main');
  const names = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/getPath\('userData'\),\s*'([^']+)'/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 10, 'the scan finds the app data files');
  // Files reached through a helper or a variable, which the scan can't see.
  for (const n of ['pastes', 'updater.log', 'last-run-version', 'telemetry-install-id', 'telemetry-last-version']) names.add(n);
  assert.match(fs.readFileSync(path.join(dir, 'pastes.ts'), 'utf8'), /return join\(userData, 'pastes'\);/);
  assert.match(fs.readFileSync(path.join(dir, 'analytics.ts'), 'utf8'), /join\(stateDir, 'telemetry-install-id'\)/);
  assert.match(fs.readFileSync(path.join(dir, 'analytics.ts'), 'utf8'), /const VERSION_STAMP_FILE = 'telemetry-last-version';/);
  for (const n of names) assert.ok(APP_DATA_ENTRIES.includes(n) || APP_DATA_KEPT.includes(n), `${n} is neither erased nor kept`);
});

test('every file the app keeps in an office\'s private folder is erased by a reset', () => {
  // Value: protects=a new private file can't silently carry across a reset; fails_when=a join(privateRoot(...), name) is added without a PRIVATE_ENTRIES row; why_new=ship maintainability review; seam=none; no_claim=names built at run time
  const dir = path.join(__dirname, '..', 'src', 'main');
  const names = new Set(['agent-mcp', 'owner']); // through agentPrivatePaths.ts helpers
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/privateRoot\((?:[^()]|\([^()]*\))*\),\s*'([^']+)'/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 8, `the scan finds the private files (${[...names].join(', ')})`);
  assert.ok(names.has('research-mined'), 'the old copy of Research\'s notes, which the palace clears, is erased too');
  for (const n of names) assert.ok(PRIVATE_ENTRIES.includes(n), `${n} is not erased`);
});

test('a path it cannot remove is reported and the rest is still erased', { skip: process.platform === 'win32' ? 'POSIX permissions' : false }, (t) => {
  // Value: protects=a reset never stops half way; fails_when=the per target try/catch is removed or failures are not returned; why_new=new helper (ship coverage audit); seam=fs permissions; no_claim=Windows (POSIX only)
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-locked-'));
  const locked = path.join(userData, 'locked');
  fs.mkdirSync(locked);
  const stuck = path.join(locked, 'inside');
  fs.mkdirSync(stuck);
  fs.writeFileSync(path.join(stuck, 'a.txt'), 'x');
  fs.chmodSync(locked, 0o555);
  t.after(() => { fs.chmodSync(locked, 0o755); fs.rmSync(userData, { recursive: true, force: true }); });
  seed(userData, ['knowledge']);
  const failed = eraseOfficeData({ home: null, userData, extra: [stuck] });
  if (process.getuid && process.getuid() === 0) return; // root ignores the permission
  assert.deepEqual(failed, [stuck]);
  assert.equal(fs.existsSync(path.join(userData, 'knowledge')), false, 'the others still went');
});

test('the lists name the office\'s private and Research folders, Company knowledge and saved keys', () => {
  // Value: protects=the entries an owner would see carry over; fails_when=one is dropped from the list; why_new=new lists; seam=none; no_claim=entries the app adds later (grep app.getPath('userData'))
  for (const n of ['hive', 'palace', 'research-desk', 'agent-settings']) assert.ok(OFFICE_FOLDER_ENTRIES.includes(n), n);
  for (const n of ['research-threads.json', 'research-pending.json', 'agent-mcp', 'owner']) assert.ok(PRIVATE_ENTRIES.includes(n), n);
  for (const n of ['private', 'office.json']) assert.ok(!OFFICE_FOLDER_ENTRIES.includes(n), `${n} is never removed whole`);
  for (const n of ['harness.db', 'knowledge', 'integration-secrets.json', 'mail-proposals.json', 'pastes']) assert.ok(APP_DATA_ENTRIES.includes(n), n);
  assert.ok(!OFFICE_FOLDER_ENTRIES.includes('roster-backups'), 'archived rosters are kept');
  assert.ok(!APP_DATA_ENTRIES.includes('config.json'), 'config is reset to defaults, not deleted');
});

test('a reset with no office folder still clears the app data and never throws', (t) => {
  // Value: protects=a reset before setup finished; fails_when=a null home throws; why_new=new helper; seam=fs; no_claim=none beyond protects
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-nohome-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  seed(userData, ['knowledge']);
  assert.deepEqual(eraseOfficeData({ home: null, userData }), []);
  assert.equal(fs.existsSync(path.join(userData, 'knowledge')), false);
});

test('a damaged write journal the broker set aside is erased by a reset too', (t) => {
  // Value: protects=app answers in a set-aside journal do not outlive a reset; fails_when=only the live journal's fixed name is erased; why_new=PR #212 sets damaged journals aside; seam=fs
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-aside-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  seed(userData, ['broker-write-journal.json', 'broker-write-journal.damaged-1792543090.json', 'notes.damaged-1.json']);
  assert.deepEqual(eraseOfficeData({ home: null, userData }), []);
  assert.equal(fs.existsSync(path.join(userData, 'broker-write-journal.json')), false);
  assert.equal(fs.existsSync(path.join(userData, 'broker-write-journal.damaged-1792543090.json')), false);
  assert.equal(fs.existsSync(path.join(userData, 'notes.damaged-1.json')), true, 'nothing else of that shape is touched');
});

test('app:resetAll erases the office data before it resets the config', () => {
  // Value: protects=the handler uses the helper while it still knows the office folder; fails_when=the call is dropped or moved after resetConfig(); why_new=new wiring; seam=none; no_claim=runtime order of the relaunch
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('app:resetAll'"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  const erase = body.indexOf('eraseOfficeData(');
  assert.ok(erase > 0, 'the reset calls eraseOfficeData');
  assert.ok(erase < body.indexOf('\n  resetConfig();'), 'before the config forgets the office folder');
  assert.match(body, /\.\.\.\(researchDesk\(\) \? projectDirs\(researchDesk\(\)!\) : \[\]\),/, 'Research\'s conversation too, in either folder spelling');
  assert.match(body, /\.\.\.CHECK_FOLDERS\.flatMap\(\(f\) => projectDirs\(join\(userData, f\)\)\)/);
  assert.match(body, /const kgRoot = knowledge\.root\(\);/, 'the knowledge store where it really is, read before the config resets');
  assert.match(body, /knowledgeRoot: resolve\(kgRoot\) !== resolve\(join\(userData, 'knowledge'\)\) \? kgRoot : null/);
  assert.ok(body.indexOf('const kgRoot') < body.indexOf('\n  resetConfig();'));
  assert.ok(body.indexOf('hive.stopAllProxyBridges()') > 0 && body.indexOf('stopWebhookServer()') > 0, 'proxy sidecars and the webhook server stop, as on quit');
  assert.doesNotMatch(body, /hive\.root\(\)|memory\.palacePath\(\)|researchFolders\(\)/, 'office folder paths come only through the office check');
});

test('the knowledge store layout the reset relies on, and both transcript folder spellings', () => {
  // Value: protects=a reset erases knowledge kept outside the app's data folder and every transcript folder for a path; fails_when=the store entries or the legacy spelling are dropped; why_new=Codex adversarial review; seam=CLAUDE_CONFIG_DIR; no_claim=the real Claude Code layout beyond these two spellings
  const kg = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'kg-core.cjs'), 'utf8');
  assert.match(kg, /path\.join\(kgRoot, 'docs'\)/);
  assert.match(kg, /path\.join\(kgRoot, 'index\.jsonl'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'knowledge.ts'), 'utf8'), /const dir = join\(root, 'meaning'\);/);
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/tmp/cc';
  try {
    const { projectDirs } = loadTs('src/main/transcript.ts');
    const dirs = projectDirs('/Users/me/My.Office');
    if (process.platform === 'win32') assert.equal(dirs.length, 1);
    else assert.deepEqual(dirs, [path.join('/tmp/cc', 'projects', '-Users-me-My-Office'), path.join('/tmp/cc', 'projects', 'Users-me-My.Office')]);
    assert.deepEqual(projectDirs('/'), [path.join('/tmp/cc', 'projects', '-')], 'no legacy candidate for the root');
  } finally { if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved; }
});

test('a moved knowledge store is erased only when it really is one, and a damaged office is still cleared', (t) => {
  // Value: protects=a stale knowledge setting can't delete someone's docs folder, and a reset clears an office whose registry is gone; fails_when=isKnowledgeStore is dropped or loosened, or roster-backups stops counting as an office; why_new=Codex adversarial pass 2; seam=fs; no_claim=a store that kg-core changes the layout of
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-kg-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-kg-data-'));
  t.after(() => { for (const d of [root, userData]) fs.rmSync(d, { recursive: true, force: true }); });
  const store = path.join(root, 'store');
  fs.mkdirSync(path.join(store, 'docs', 'd1'), { recursive: true });
  fs.writeFileSync(path.join(store, 'docs', 'd1', 'meta.json'), '{}');
  fs.mkdirSync(path.join(store, 'docs', 'd2'), { recursive: true });
  fs.writeFileSync(path.join(store, 'docs', 'd2', 'meta.json'), '{}');
  fs.mkdirSync(path.join(store, 'meaning'));
  fs.writeFileSync(path.join(store, 'meaning', 'd1.md'), 'x');
  fs.writeFileSync(path.join(store, 'index.jsonl'), JSON.stringify({ docId: 'd1', title: 't', source: 's', modality: 'text', chunkIdx: 0, text: 'x' }) + '\n');
  fs.writeFileSync(path.join(store, 'mine.txt'), 'mine');
  const notStore = path.join(root, 'project');
  seed(notStore, ['docs']);
  fs.writeFileSync(path.join(notStore, 'index.jsonl'), '{"event":"build"}\n');
  assert.equal(isKnowledgeStore(store), true);
  assert.equal(isKnowledgeStore(notStore), false);
  assert.deepEqual(eraseOfficeData({ home: null, userData, knowledgeRoot: notStore }), []);
  assert.ok(fs.existsSync(path.join(notStore, 'docs', 'inside.txt')), 'not a store, so its docs stay');
  // A store set up inside the owner's own folder that already held files in docs/ and meaning/.
  fs.writeFileSync(path.join(store, 'docs', 'contract.pdf'), 'mine');
  fs.writeFileSync(path.join(store, 'meaning', 'notes.txt'), 'mine');
  assert.deepEqual(eraseOfficeData({ home: null, userData, knowledgeRoot: store }), []);
  for (const n of ['index.jsonl', 'docs/d1', 'docs/d2', 'meaning/d1.md']) assert.equal(fs.existsSync(path.join(store, n)), false, n);
  assert.equal(fs.readFileSync(path.join(store, 'docs', 'contract.pdf'), 'utf8'), 'mine', 'only the store\'s own documents go');
  assert.equal(fs.readFileSync(path.join(store, 'meaning', 'notes.txt'), 'utf8'), 'mine');
  assert.equal(fs.readFileSync(path.join(store, 'mine.txt'), 'utf8'), 'mine', 'the folder it sits in keeps everything else');
  fs.rmSync(path.join(store, 'docs', 'contract.pdf')); fs.rmSync(path.join(store, 'meaning', 'notes.txt'));
  fs.mkdirSync(path.join(store, 'docs', 'd3')); fs.writeFileSync(path.join(store, 'docs', 'd3', 'meta.json'), '{}');
  fs.writeFileSync(path.join(store, 'index.jsonl'), '');
  assert.deepEqual(eraseOfficeData({ home: null, userData, knowledgeRoot: store }), []);
  assert.equal(fs.existsSync(path.join(store, 'docs')), false, 'an emptied docs folder goes');
  assert.equal(fs.existsSync(path.join(store, 'meaning')), false);
  const damaged = path.join(root, 'office');
  seed(damaged, ['roster-backups', 'agent-settings']);
  fs.mkdirSync(path.join(damaged, 'worktrees', 'pam'), { recursive: true });
  fs.writeFileSync(path.join(damaged, 'worktrees', 'pam', '.git'), 'gitdir: /x/.git/worktrees/pam');
  fs.mkdirSync(path.join(damaged, 'worktrees', 'my-repo', '.git'), { recursive: true });
  assert.deepEqual(eraseOfficeData({ home: damaged, userData }), []);
  assert.equal(fs.existsSync(path.join(damaged, 'agent-settings')), false, 'no registry, but the reset just archived its roster');
  assert.equal(fs.existsSync(path.join(damaged, 'worktrees', 'pam')), false, 'an agent\'s worktree goes');
  assert.ok(fs.existsSync(path.join(damaged, 'worktrees', 'my-repo', '.git')), 'a real repository the owner keeps there stays');
});
