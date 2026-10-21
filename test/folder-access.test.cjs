'use strict';

/**
 * Who may open and change which folder (owner, 2026-09-25;
 * src/shared/folderAccess.ts):
 *  - Every agent's folder is private to that agent (and anyone sharing it) and
 *    anyone above it. Michael's is private to him and the owner.
 *  - Michael works in the business folder, which holds every team member's
 *    folder, and reads them but does not change them.
 *  - No folder is shared: company knowledge lives in the knowledge feature.
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

const { folderPolicy, folderDecision, folderToolTarget } = loadTs('src/shared/folderAccess.ts');
const { folderLayoutFor } = loadTs('src/main/officeFile.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

// Absolute on this platform (D:\Users\me\... on Windows), so the expected
// paths match what the path helpers give back there.
const abs = (p) => path.resolve(p);
const B = abs('/Users/me/Documents/Pho');
const SALES = abs('/Users/me/Dropbox/Sales');
const layout = {
  business: B,
  teamFolders: [path.join(B, 'Finance'), path.join(B, 'Admin'), SALES]
};
/** A Claude Code rule for everything under a folder: `//` then the path with forward slashes. */
const ruleFor = (tool, folder) => `${tool}(//${folder.replace(/\\/g, '/').replace(/^\//, '')}/**)`;
const oscar = { isGod: false, cwd: path.join(B, 'Finance') };
const michael = { isGod: true, cwd: B };

test('a team member opens its own folder and nothing else of the office', () => {
  const allow = (tool, p) => folderDecision(oscar, layout, tool, p, true).deny === false;
  assert.ok(allow('Read', path.join(B, 'Finance', 'statements', 'june.pdf')));
  assert.ok(allow('Write', path.join(B, 'Finance', 'summary.md')));
  assert.ok(!allow('Read', path.join(B, 'Admin', 'contracts.docx')), 'a peer\'s folder is private');
  assert.ok(!allow('Grep', SALES), 'even when the owner put it outside the business folder');
  assert.ok(!allow('Read', path.join(B, 'plan.md')), 'Michael\'s own files are his');
  assert.ok(!allow('Read', path.join(B, 'Office', 'Company profile.md')), 'the retired Office folder is just part of Michael\'s');
  assert.ok(allow('Read', abs('/Users/me/Downloads/rates.csv')), 'places outside the office are not this rule\'s business');
  // Case differs from the disk on macOS: the registry once held "SunriseBakery" for "SunRiseBakery".
  assert.ok(!allow('Read', path.join(B.toLowerCase(), 'admin', 'x')));
});

test('the refusal tells the agent what to do instead', () => {
  const d = folderDecision(oscar, layout, 'Read', path.join(B, 'Admin', 'x.md'), true, 'Michael');
  assert.equal(d.deny, true);
  assert.match(d.reason, /only they and Michael can open it/);
  assert.match(d.reason, /ask Michael/);
  assert.doesNotMatch(d.reason, /[–—]/, 'no dashes in agent-facing text');
});

test('agents sharing a folder (same role) both open it', () => {
  const kevin = { isGod: false, cwd: path.join(B, 'Finance') };
  assert.equal(folderDecision(kevin, layout, 'Read', path.join(B, 'Finance', 'june.pdf'), true).deny, false);
});

test('Michael reads everything and changes only what is his', () => {
  const allow = (tool, p) => folderDecision(michael, layout, tool, p, true).deny === false;
  assert.ok(allow('Read', path.join(B, 'Finance', 'june.pdf')));
  assert.ok(allow('Read', path.join(SALES, 'leads.csv')));
  assert.ok(!allow('Write', path.join(B, 'Finance', 'june.pdf')), 'a team member\'s folder is theirs to change');
  assert.ok(!allow('Edit', path.join(SALES, 'leads.csv')));
  assert.ok(allow('Write', path.join(B, 'notes.md')), 'his own folder');
});

test('the spawn settings hold the same rules for shell commands and file tools', () => {
  const w = folderPolicy(oscar, layout, true);
  assert.deepEqual(w.sandbox.denyRead, [B, path.join(B, 'Admin'), SALES]);
  assert.deepEqual(w.sandbox.allowRead, [path.join(B, 'Finance')], 'its own folder reopened inside Michael\'s');
  assert.deepEqual(w.sandbox.denyWrite, []);
  assert.ok(w.deny.includes(ruleFor('Read', path.join(B, 'Admin'))));
  assert.ok(!w.deny.some((r) => r.includes('/Finance')), 'never locks the agent out of its own folder');

  assert.equal(w.sandboxOnly, true, 'a team member can\'t switch the sandbox off');
  const g = folderPolicy(michael, layout, true);
  assert.equal(g.sandboxOnly, false, 'Michael keeps it');
  assert.deepEqual(g.sandbox.denyRead, []);
  assert.deepEqual(g.sandbox.denyWrite, [path.join(B, 'Finance'), path.join(B, 'Admin'), SALES]);
  assert.ok(g.deny.every((r) => r.startsWith('Edit(')), 'Michael is never denied a read');
});

test('the path a file tool touches', () => {
  assert.equal(folderToolTarget('Read', { file_path: 'june.pdf' }, path.join(B, 'Finance')), path.join(B, 'Finance', 'june.pdf'));
  assert.equal(folderToolTarget('Grep', { pattern: 'x', path: path.join(B, 'Admin') }, path.join(B, 'Finance')), path.join(B, 'Admin'));
  assert.equal(folderToolTarget('Glob', { pattern: path.join(B, 'Admin', '**', '*.md') }, path.join(B, 'Finance')), path.join(B, 'Admin'));
  assert.equal(folderToolTarget('Grep', { pattern: 'x' }, path.join(B, 'Finance')), null, 'no path: its own folder');
  const home = process.env.HOME || process.env.USERPROFILE;
  assert.equal(folderToolTarget('Read', { file_path: '~/test.txt' }, path.join(B, 'Finance')), path.resolve(home, 'test.txt'));
  assert.equal(folderToolTarget('Read', { file_path: '~\\test.txt' }, path.join(B, 'Finance')), path.resolve(home, 'test.txt'));
  assert.equal(folderToolTarget('Read', { file_path: '~' }, path.join(B, 'Finance')), home);
});

test('the layout drops folders that are not a team member\'s own place', () => {
  const docs = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-folders-')));
  const biz = path.join(docs, 'Pho');
  for (const f of ['Finance', 'Admin']) fs.mkdirSync(path.join(biz, f), { recursive: true });
  const app = path.join(docs, 'HarnessAgents');
  fs.mkdirSync(app);
  const l = folderLayoutFor(biz, [
    path.join(biz, 'Finance'), path.join(biz, 'Admin'), path.join(biz, 'Finance'),
    docs, // an agent started in Documents doesn't hide Documents
    app, // the app's own folder
    os.homedir()
  ], app);
  assert.equal(l.business, biz);
  assert.deepEqual(l.teamFolders, [path.join(biz, 'Finance'), path.join(biz, 'Admin')]);
});

test('a Claude agent\'s settings file carries the folder rules', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-folder-settings-'));
  const hive = new HiveManager(() => home);
  const inj = await hive.ensureAgent(
    { id: 'oscar', name: 'Oscar', provider: 'claude', cwd: oscar.cwd },
    { folderPolicy: folderPolicy(oscar, layout, true) }
  );
  const settings = JSON.parse(fs.readFileSync(inj.args[inj.args.indexOf('--settings') + 1], 'utf8'));
  assert.deepEqual(settings.sandbox.filesystem.denyRead, [B, path.join(B, 'Admin'), SALES]);
  assert.deepEqual(settings.sandbox.filesystem.allowRead, [path.join(B, 'Finance')]);
  assert.ok(settings.permissions.deny.includes(ruleFor('Read', path.join(B, 'Admin'))));
  assert.ok(Array.isArray(settings.permissions.additionalDirectories), 'the write allowances are still there');
  // Windows has no Claude Code sandbox, so the lock is left off there (owner, 2026-10-09).
  assert.equal(settings.sandbox.allowUnsandboxedCommands, process.platform === 'win32' ? undefined : false, 'no shell command runs outside the sandbox');
});

test('on Windows a team member keeps its shell: no sandbox only lock, the file tool deny rules stay', async (t) => {
  // Value: protects=Windows team members can run commands (inbox clearing, knowledge search, Word and Excel) while Read and Edit stay held (owner, 2026-10-09); fails_when=the lock is written on Windows, where Claude Code then blocks every command ("Shell command execution is blocked by policy"), or the deny rules or other platforms change with it; why_new=Pam and Dwight were blocked on every command on a Windows office; seam=process.platform
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-folder-win-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  let inj;
  try {
    inj = await new HiveManager(() => home).ensureAgent(
      { id: 'oscar', name: 'Oscar', provider: 'claude', cwd: oscar.cwd },
      { folderPolicy: folderPolicy(oscar, layout, true) }
    );
  } finally {
    Object.defineProperty(process, 'platform', real);
  }
  const settings = JSON.parse(fs.readFileSync(inj.args[inj.args.indexOf('--settings') + 1], 'utf8'));
  assert.equal(settings.sandbox.allowUnsandboxedCommands, undefined, 'commands may run where there is no sandbox');
  assert.equal(settings.sandbox.enabled, true, 'a sandbox still applies wherever Claude Code has one');
  assert.ok(settings.permissions.deny.includes(ruleFor('Read', path.join(B, 'Admin'))), 'the file tools stay held');
  assert.equal(folderPolicy(oscar, layout, true).sandboxOnly, true, 'the policy itself is unchanged');
});

test('a name starting with two dots is inside its folder; a relative Glob is judged by its folder', () => {
  const allow = (tool, p) => folderDecision(oscar, layout, tool, p, true).deny === false;
  assert.ok(allow('Read', path.join(B, 'Finance', '..notes')));
  assert.equal(folderToolTarget('Glob', { pattern: '../Admin/**' }, path.join(B, 'Finance')), path.join(B, 'Admin'));
  assert.ok(!allow('Glob', folderToolTarget('Glob', { pattern: '../Admin/**' }, path.join(B, 'Finance'))));
  assert.equal(folderToolTarget('Glob', { pattern: '**/*.md' }, path.join(B, 'Finance')), null, 'a pattern in its own folder names no other');
});

test('the hook judges the real path too, so a link out of an agent\'s folder is refused', () => {
  const hooks = fs.readFileSync(path.resolve(__dirname, '../src/main/hooks.ts'), 'utf8');
  assert.match(hooks, /const real = realPathOf\(target\);/);
  const { realPathOf } = loadTs('src/main/hooks.ts');
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-link-')));
  fs.mkdirSync(path.join(dir, 'Biz', 'Finance'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'Biz'), path.join(dir, 'Biz', 'Finance', 'biz'));
  const real = realPathOf(path.join(dir, 'Biz', 'Finance', 'biz', 'payroll.xlsx'));
  assert.equal(real, path.join(dir, 'Biz', 'payroll.xlsx'), 'a file not there yet takes its folder\'s real path');
  const l = { business: path.join(dir, 'Biz'), teamFolders: [path.join(dir, 'Biz', 'Finance')] };
  const me = { isGod: false, cwd: path.join(dir, 'Biz', 'Finance') };
  assert.equal(folderDecision(me, l, 'Read', real, true).deny, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a link to a file not there yet is judged by where it leads, so a Write cannot plant a file in a teammate\'s folder (#231)', () => {
  const { realPathOf } = loadTs('src/main/hooks.ts');
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-dangling link-')));
  const biz = path.join(dir, 'Biz'), sales = path.join(biz, 'Sales'), finance = path.join(biz, 'Finance');
  fs.mkdirSync(sales, { recursive: true });
  fs.mkdirSync(finance);
  fs.symlinkSync(path.join(finance, 'planted.txt'), path.join(sales, 'notes.txt'));
  fs.symlinkSync(path.join('..', 'Finance', 'rel.txt'), path.join(sales, 'rel.txt'));
  fs.symlinkSync(path.join(finance, 'new'), path.join(sales, 'drafts'));
  fs.mkdirSync(path.join(finance, 'deep'));
  fs.symlinkSync(path.join(finance, 'deep'), path.join(sales, 'sub'));
  fs.symlinkSync(['sub', '..', 'planted2.txt'].join(path.sep), path.join(sales, 'trick'));
  fs.symlinkSync(path.join(sales, 'b'), path.join(sales, 'a'));
  fs.symlinkSync(path.join(sales, 'a'), path.join(sales, 'b'));
  assert.equal(realPathOf(path.join(sales, 'notes.txt')), path.join(finance, 'planted.txt'));
  assert.equal(realPathOf(path.join(sales, 'rel.txt')), path.join(finance, 'rel.txt'), 'a relative link is read from its own folder');
  assert.equal(realPathOf(path.join(sales, 'drafts', 'june.txt')), path.join(finance, 'new', 'june.txt'), 'a link to a folder not there yet');
  assert.equal(realPathOf(path.join(sales, 'a')), null, 'links that go round end');
  assert.equal(realPathOf(path.join(sales, 'plain.txt')), path.join(sales, 'plain.txt'), 'a new file with no link stays where it is');
  const l = { business: biz, teamFolders: [sales, finance] };
  const me = { isGod: false, cwd: sales };
  assert.equal(folderDecision(me, l, 'Write', realPathOf(path.join(sales, 'notes.txt')), true).deny, true);
  // A link through another link is judged where the system really puts the
  // file: on macOS and Linux sub/.. goes up from where sub leads (Finance);
  // Windows reads the .. off the text first (Sales). Judged before the write,
  // checked against where the write lands.
  const judged = realPathOf(path.join(sales, 'trick'));
  fs.writeFileSync(path.join(sales, 'trick'), 'x');
  const landed = [path.join(finance, 'planted2.txt'), path.join(sales, 'planted2.txt')].find((f) => fs.existsSync(f));
  assert.equal(judged, landed, 'a link through another link is judged where the write lands');
  if (process.platform !== 'win32') assert.equal(landed, path.join(finance, 'planted2.txt'));
  assert.equal(folderDecision(me, l, 'Write', judged, true).deny, landed === path.join(finance, 'planted2.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a Glob with a path is judged by where its pattern points', () => {
  assert.equal(folderToolTarget('Glob', { pattern: '../Admin/**', path: path.join(B, 'Finance') }, path.join(B, 'Finance')), path.join(B, 'Admin'));
  assert.equal(folderToolTarget('Glob', { pattern: '**/*.md', path: path.join(B, 'Finance', 'docs') }, path.join(B, 'Finance')), path.join(B, 'Finance', 'docs'));
  assert.equal(folderToolTarget('Glob', { pattern: path.join(B, 'Admin', '*.pdf'), path: path.join(B, 'Finance') }, path.join(B, 'Finance')), path.join(B, 'Admin'));
});

test('an agent whose folder is reached through a link still opens its own files', () => {
  const { realPathOf } = loadTs('src/main/hooks.ts');
  const hooks = fs.readFileSync(path.resolve(__dirname, '../src/main/hooks.ts'), 'utf8');
  assert.match(hooks, /cwd: realPathOf\(me\.cwd\) \?\? me\.cwd/);
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-linkcwd-')));
  fs.mkdirSync(path.join(dir, 'Biz', 'Finance'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'Biz'), path.join(dir, 'BizLink'));
  const l = { business: path.join(dir, 'Biz'), teamFolders: [path.join(dir, 'Biz', 'Finance')] };
  const linkedCwd = path.join(dir, 'BizLink', 'Finance');
  const real = realPathOf(path.join(linkedCwd, 'june.pdf'));
  assert.equal(folderDecision({ isGod: false, cwd: realPathOf(linkedCwd) }, l, 'Read', real, true).deny, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── The engine's record of every session (TODOS: keep transcripts and history
//    out of agents' reach) ─────────────────────────────────────────────────

const PROJECTS = abs('/Users/me/.claude/projects');
const HISTORY = abs('/Users/me/.claude/history.jsonl');
const withRecords = { ...layout, engineRecords: { projects: PROJECTS, history: HISTORY } };

test('every agent, Michael too, is walled from the session records in shell and file tools', () => {
  // Value: protects=no agent reads a teammate's conversation or a hidden check's prompt; fails_when=the records drop out of the sandbox or the deny rules; why_new=TODOS, keep the engine's session records out of agents' reach; seam=none
  for (const agent of [{ isGod: false, cwd: path.join(B, 'Finance') }, { isGod: true, cwd: B }]) {
    const p = folderPolicy(agent, withRecords, false);
    for (const f of [PROJECTS, HISTORY]) {
      assert.ok(p.sandbox.denyRead.includes(f), `${agent.isGod ? 'Michael' : 'member'} shell reads ${f}`);
      assert.ok(p.sandbox.denyWrite.includes(f));
    }
    assert.ok(p.deny.includes(ruleFor('Read', PROJECTS)) && p.deny.includes(ruleFor('Edit', PROJECTS)));
    const history = `//${HISTORY.replace(/\\/g, '/').replace(/^\//, '')}`;
    assert.ok(p.deny.includes(`Read(${history})`) && p.deny.includes(`Edit(${history})`), 'the history file by its own name');
  }
});

test('file tools are refused on a transcript or the history, even for an agent whose folder holds them', () => {
  // Value: protects=the hook refuses the records before the own-folder rule lets them through; fails_when=the check moves after the own folder or misses the history file; why_new=same TODO; seam=none
  const transcript = path.join(PROJECTS, '-Users-me-Documents-Pho-Admin', 'abc.jsonl');
  for (const agent of [{ isGod: false, cwd: path.join(B, 'Finance') }, { isGod: true, cwd: B }, { isGod: false, cwd: abs('/Users/me') }]) {
    for (const [tool, target] of [['Read', transcript], ['Grep', PROJECTS], ['Read', HISTORY], ['Edit', HISTORY]]) {
      const d = folderDecision(agent, withRecords, tool, target, false);
      assert.equal(d.deny, true, `${agent.cwd} ${tool} ${target}`);
      assert.match(d.reason, /every team member's conversations/);
    }
  }
  assert.equal(folderDecision({ isGod: false, cwd: abs('/Users/me') }, withRecords, 'Read', abs('/Users/me/.claude/settings.json'), false).deny, false, 'only the records, not the rest of that folder');
});

test('the office layout carries the records, wherever CLAUDE_CONFIG_DIR puts them', (t) => {
  const before = process.env.CLAUDE_CONFIG_DIR;
  t.after(() => { if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before; });
  process.env.CLAUDE_CONFIG_DIR = abs('/Volumes/work/engine-config');
  assert.deepEqual(folderLayoutFor(undefined, []).engineRecords, {
    projects: path.join(abs('/Volumes/work/engine-config'), 'projects'),
    history: path.join(abs('/Volumes/work/engine-config'), 'history.jsonl')
  });
});

test('the records are walled by the folder they really are, when CLAUDE_CONFIG_DIR goes through a link', (t) => {
  // Value: protects=a dotfiles setup leaves no side door to the records; fails_when=the layout carries the link path, not the real one; why_new=review, the other folders are real paths and this one was not; seam=none
  const { realPathOf } = loadTs('src/main/hooks.ts');
  const before = process.env.CLAUDE_CONFIG_DIR;
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-linked config-')));
  t.after(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const real = path.join(dir, 'dotfiles', 'engine');
  const link = path.join(dir, 'engine');
  fs.mkdirSync(real, { recursive: true });
  try { fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('no links here'); return; }
  process.env.CLAUDE_CONFIG_DIR = link;
  const expected = { projects: path.join(real, 'projects'), history: path.join(real, 'history.jsonl') };
  assert.deepEqual(folderLayoutFor(undefined, []).engineRecords, expected, 'neither is there yet');
  fs.mkdirSync(path.join(real, 'projects', '-Users-me-Documents-Pho-Admin'), { recursive: true });
  fs.writeFileSync(expected.history, '');
  const l = folderLayoutFor(undefined, []);
  assert.deepEqual(l.engineRecords, expected);
  const transcript = ['projects', '-Users-me-Documents-Pho-Admin', 'abc.jsonl'];
  for (const agent of [oscar, michael]) {
    const p = folderPolicy(agent, l, false);
    assert.ok(p.sandbox.denyRead.includes(expected.projects) && p.sandbox.denyRead.includes(expected.history), 'the shell is walled from the real folder');
    // Judged as the hook does: by the file it really is.
    for (const target of [expected.history, path.join(real, ...transcript), path.join(link, 'history.jsonl'), path.join(link, ...transcript)]) {
      assert.equal(folderDecision(agent, l, 'Read', realPathOf(target), false).deny, true, target);
    }
  }
});
