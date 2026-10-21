'use strict';

/**
 * A file tool call too big for one hook frame (ship review pass 2): the hook
 * program sends it with its path kept and resolved, so the app still judges
 * where it reads or saves; one it can't fit is refused. Plus the walls this
 * pass added: each agent's session scratch folder is its own, the shared temp
 * check reads the path as the file it names, a name that reads as Pete is his.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { HOOK_PATH_UNCHECKED, MAX_HOOK_FRAME_BYTES } = loadTs('src/shared/hookEvents.ts');
const F = loadTs('src/shared/folderAccess.ts');
const R = loadTs('src/shared/research.ts');

const unix = { skip: process.platform === 'win32' ? 'unix socket paths' : false };

async function office(t) {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-frame-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  server.start();
  t.after(() => server.stop());
  await new Promise((r) => setTimeout(r, 50));
  const shim = (payload, env = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, [hive.shimPath()], { env: { PATH: process.env.PATH, AGENT_ID: 'pam', HIVE_SOCK: hive.sockPath(), HIVE_HOOK_SEAL: hive.mintHookToken('pam'), ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out ? JSON.parse(out).hookSpecificOutput ?? {} : {}));
    p.stdin.end(JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd: home, ...payload }));
  });
  return { home, server, shim };
}

test('a big save keeps its path, padded or not, and the app still refuses another agent\'s folder', unix, async (t) => {
  // Value: protects=a save over the frame limit is judged on where it goes; fails_when=the hook program drops a long path when it trims, or the app allows a trimmed call with no path; why_new=red team pass 2 (reproduced: a padded path came through empty and was allowed); seam=none
  const { home, shim } = await office(t);
  const other = path.join(home, 'agent-tmp', 'jim') + '/./'.repeat(700) + 'x.md';
  const big = 'x'.repeat(300_000);
  const save = await shim({ tool_name: 'Write', tool_input: { file_path: other, content: big } });
  assert.equal(save.permissionDecision, 'deny', 'Jim\'s scratch folder, however the path is padded');
  assert.match(save.permissionDecisionReason, /scratch folder/);
  const own = await shim({ tool_name: 'Write', tool_input: { file_path: path.join(home, 'agent-tmp', 'pam') + '/./'.repeat(700) + 'x.md', content: big } });
  assert.equal(own.permissionDecision, undefined, 'its own scratch folder takes a big save');
  // A search too big to send whole went through unchecked before: the app dropped the frame.
  const grep = await shim({ tool_name: 'Grep', tool_input: { pattern: 'y'.repeat(300_000), path: path.join(home, 'agent-tmp', 'jim') } });
  assert.equal(grep.permissionDecision, 'deny');
  // '~' is the home folder, not a folder named ~ in the agent's own.
  const tilde = await shim({ tool_name: 'Write', tool_input: { file_path: '~/agent-tmp/jim/x.md', content: big } }, { HOME: home });
  assert.equal(tilde.permissionDecision, 'deny', 'a big save to ~/... is judged where it really goes');
  // A path that can't fit even alone is refused by the hook program itself.
  const huge = await shim({ tool_name: 'Read', tool_input: { file_path: 'a/'.repeat(150_000) + 'x.md' } });
  assert.equal(huge.permissionDecisionReason, HOOK_PATH_UNCHECKED);
});

test('a finished batch too big for one frame goes out with only its call ids, and the panel gets every one', unix, async (t) => {
  // Value: protects=the panel hears every batch end, refused calls included; fails_when=the hook program sends the batch's inputs and outputs, so a few big reads pass the frame limit and the app drops it; why_new=maintainer review of #401; seam=a plain socket in place of the app's
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-batch-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', cwd: home });
  const sock = path.join(home, 'b.sock');
  const frames = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => {});
    conn.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) { frames.push(buf.slice(0, buf.indexOf('\n'))); conn.end('{}'); }
    });
  });
  await new Promise((r) => server.listen(sock, r));
  t.after(() => server.close());
  const send = (payload) => new Promise((resolve) => {
    const p = spawn(process.execPath, [hive.shimPath()], { env: { PATH: process.env.PATH, AGENT_ID: 'pam', HIVE_SOCK: sock } });
    p.on('close', () => resolve(frames.pop()));
    p.stdin.end(JSON.stringify({ session_id: 's', cwd: home, ...payload }));
  });
  const big = 'x'.repeat(100_000);
  const ids = ['toolu_bash', 'toolu_r1', 'toolu_r2', 'toolu_r3'];
  const calls = ids.map((id, i) => ({ tool_name: i ? 'Read' : 'Bash', tool_input: { file_path: `/a/${i}.md` }, tool_use_id: id, tool_response: i ? big : 'This command requires approval' }));
  assert.ok(Buffer.byteLength(JSON.stringify({ hook_event_name: 'PostToolBatch', tool_calls: calls })) > MAX_HOOK_FRAME_BYTES, 'too big as the engine sends it');
  const batch = await send({ hook_event_name: 'PostToolBatch', tool_calls: calls });
  assert.ok(Buffer.byteLength(batch) <= MAX_HOOK_FRAME_BYTES, 'under the limit');
  assert.deepEqual(JSON.parse(batch).tool_calls, ids.map((id) => ({ tool_use_id: id })), 'every id and nothing else');
  // The app forwards the ids to the panel.
  const sent = [];
  const app = new HookServer(hive, () => ({ send: (c, p) => sent.push({ c, p }) }), () => ({ harnessHome: home }));
  app.handle(JSON.parse(batch));
  assert.deepEqual(sent.filter((x) => x.c === 'hive:hookEvent').pop()?.p.toolUseIds, ids);
  // A finished or failed call goes without its output; its input stays for the breaker and the Read hook.
  const post = JSON.parse(await send({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/a/1.md' }, tool_use_id: 'toolu_r1', tool_response: big.repeat(3) }));
  assert.equal(post.tool_response, undefined);
  assert.equal(post.tool_use_id, 'toolu_r1');
  assert.deepEqual(post.tool_input, { file_path: '/a/1.md' });
  const failed = JSON.parse(await send({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_bash', error: big.repeat(3) }));
  assert.equal(failed.error, undefined);
  assert.equal(failed.tool_use_id, 'toolu_bash');
  // A missing list goes out as no ids.
  assert.deepEqual(JSON.parse(await send({ hook_event_name: 'PostToolBatch' })).tool_calls, []);
});

test('the app refuses a trimmed file call that arrives without its path', async (t) => {
  // Value: protects=a path lost on the way is never read as "no folder to check"; fails_when=folderCheck allows a call with no target; why_new=red team pass 2; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-frame-srv-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  for (const tool_name of ['Write', 'Read', 'Glob']) {
    const r = server.handle({ agent_id: 'pam', hook_event_name: 'PreToolUse', cwd: undefined, tool_name, tool_input: {}, tool_input_trimmed: true });
    assert.equal(r.hookSpecificOutput?.permissionDecisionReason, HOOK_PATH_UNCHECKED, tool_name);
  }
  const grep = server.handle({ agent_id: 'pam', hook_event_name: 'PreToolUse', cwd: home, tool_name: 'Grep', tool_input: {}, tool_input_trimmed: true });
  assert.notEqual(grep.hookSpecificOutput?.permissionDecision, 'deny', 'a search of the folder it runs in needs no path');
});

test('each agent\'s session scratch folder is its own; Michael reads them all', { skip: process.platform === 'win32' ? 'posix paths' : false }, () => {
  // Value: protects=one teammate can't read another's command output; fails_when=agent-tmp is left out of the walls; why_new=red team pass 2; seam=none
  const home = '/Users/x/.dbm';
  const d = (id, isGod, tool, target) => F.agentTmpDecision(home, id, isGod, tool, target, true).deny;
  assert.equal(d('pam', false, 'Read', '/Users/x/.dbm/agent-tmp/jim/out.txt'), true);
  assert.equal(d('pam', false, 'Grep', '/Users/x/.dbm/agent-tmp'), true, 'the whole scratch area');
  assert.equal(d('pam', false, 'Write', '/Users/x/.dbm/agent-tmp/pam/a.md'), false);
  assert.equal(d('god', true, 'Read', '/Users/x/.dbm/agent-tmp/jim/out.txt'), false);
  assert.equal(d('pam', false, 'Bash', '/Users/x/.dbm/agent-tmp/jim'), false, 'shell commands are the sandbox\'s');
  const base = { sandbox: { denyWrite: [], denyRead: ['/a'], allowRead: [] }, deny: [], sandboxOnly: true };
  const walled = F.withAgentTmpWall(base, home, 'pam', false);
  assert.deepEqual(walled.sandbox.denyRead, ['/a', '/Users/x/.dbm/agent-tmp']);
  assert.deepEqual(walled.sandbox.allowRead, ['/Users/x/.dbm/agent-tmp/pam']);
  assert.equal(F.withAgentTmpWall(base, home, 'god', true), base);
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(idx, /const walled = withMemberWall\(withAgentTmpWall\(withResearchWall\(base, researchFolders\(\)\), home, opts\.hive!\.id, !!opts\.hive!\.isGod\),\n\s+hiveRoot \?\? '', opts\.hive!\.id, Object\.keys\(hive\.registry\(\)\.agents \?\? \{\}\)\);/);
});

test('the shared temp check reads a save\'s path as the file it names', { skip: process.platform === 'win32' ? 'posix paths' : false }, () => {
  // Value: protects=the fail closed temp rule can't be dodged by how a path is written; fails_when=it tests the raw string; why_new=both pass 2 reviewers; seam=none
  for (const file_path of ['/tmp/a.md', '//tmp/a.md', '/./tmp/a.md', '/Users/x/../../tmp/a.md', '/private/var/folders/T/a']) {
    assert.equal(F.isSharedTempSave('Write', { file_path }, '/Users/x'), true, file_path);
  }
  assert.equal(F.isSharedTempSave('Write', { file_path: 'a.md' }, '/tmp/w'), true, 'relative, run in /tmp');
  assert.equal(F.isSharedTempSave('Write', { file_path: 'a.md' }, '/Users/x'), false);
  assert.equal(F.isSharedTempSave('Read', { file_path: '/tmp/a' }, '/'), false);
});

test('a name that reads as Pete is his, and "pete" reaches him only when nobody else has the name', () => {
  // Value: protects=office content never goes to the internet facing member by a name mix up; fails_when=Michael or a teammate named Pete loses mail to Research, or a lookalike name passes; why_new=specialist and red team pass 2; seam=none
  for (const n of ['Pete', ' pete ', 'P\u0435te', 'Pe\u200Bte', '\uFF30\uFF45\uFF54\uFF45', '\u0420ete', 'Pe\u0163e', '\u1D18ete', '\u13E2ete', 'Pete.', 'P e t e']) assert.equal(R.isReservedName(n), true, JSON.stringify(n));
  for (const n of ['Peter', 'Petra', 'Pam', '\u0628\u064A\u062A', '\u76AE\u7279']) assert.equal(R.isReservedName(n), false, JSON.stringify(n));
  assert.equal(R.isReservedName('Peter'), false);
  assert.equal(R.isReservedName('Pete', 'research'), false);
  assert.equal(R.addressedToResearch('pete', { god: { name: 'Michael' }, research: { name: 'Pete' } }), true);
  assert.equal(R.addressedToResearch('pete', { god: { name: 'Pete' }, research: { name: 'Research' } }), false, 'Michael renamed Pete');
  assert.equal(R.addressedToResearch('Pete', { 'pete-1': { name: 'Pete' } }), false);
  assert.equal(R.addressedToResearch('pete', { pete: { name: 'P' } }), false);
  assert.equal(R.addressedToResearch('research', { god: { name: 'Pete' } }), true, 'his id always');
});

test('a path with spaces around it is judged as Claude Code reads it, trimmed', { skip: process.platform === 'win32' ? 'posix paths' : false }, async (t) => {
  // Value: protects=Pete can't search the whole disk, nor a teammate another's scratch, by padding a path with a space; fails_when=folderToolTarget or the hook program read " /abs" as relative to the agent's folder; why_new=red team pass 3 (reproduced on the app side); seam=none
  assert.equal(F.folderToolTarget('Grep', { path: ' /Users/x/Office' }, '/w/desk'), '/Users/x/Office');
  assert.equal(F.folderToolTarget('Glob', { pattern: '\t/Users/x/**' }, '/w/desk'), '/Users/x');
  assert.equal(F.folderToolTarget('Read', { file_path: '/Users/x/a.md ' }, '/w'), '/Users/x/a.md');
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-frame-ws-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  const call = (agent_id, cwd, tool_input) => server.handle({ agent_id, hook_event_name: 'PreToolUse', cwd, tool_name: 'Grep', tool_input }).hookSpecificOutput?.permissionDecision;
  for (const p of [' ' + home, '\t' + os.homedir(), os.homedir() + ' ']) assert.equal(call('research', path.join(home, 'research-desk'), { pattern: 'token', path: p }), 'deny', `Pete: ${JSON.stringify(p)}`);
  for (const p of [' ' + path.join(home, 'agent-tmp', 'jim'), path.join(home, 'agent-tmp') + ' ']) assert.equal(call('pam', home, { pattern: 'x', path: p }), 'deny', `Pam: ${JSON.stringify(p)}`);
});

test('a folder check that fails refuses the call; it never falls open', async (t) => {
  // Value: protects=a passing config or disk error can't reopen the folder walls; fails_when=a throwing guard lets a file tool through; why_new=Codex adversarial review, second ship; seam=throwing config
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-frame-throw-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  const server = new HookServer(hive, () => null, () => { throw new Error('config unreadable'); });
  for (const tool_name of ['Read', 'Write', 'Grep']) {
    const r = server.handle({ agent_id: 'pam', hook_event_name: 'PreToolUse', cwd: home, tool_name, tool_input: { file_path: path.join(home, 'a.md'), path: home } });
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny', tool_name);
    assert.equal(r.hookSpecificOutput?.permissionDecisionReason, R.RESEARCH_UNCHECKED_TOOL);
  }
});

test('a Claude agent with no scratch folder of its own does not start, in any office', () => {
  // Value: protects=session files never fall back to the shared /tmp Pete's shell reads; fails_when=the spawn carries on without CLAUDE_CODE_TMPDIR; why_new=Codex adversarial review, second ship; seam=source pin, the spawn needs Electron
  const idx = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(idx, /if \(opts\.hive && claudeProvider && !sessionTmp\) \{[\s\S]{0,200}?return \{ ok: false, error: 'This team member\\'s scratch folder could not be made/);
});

test('every agent gets a scratch folder of its own, a long or odd id included', () => {
  // Value: protects=a hire with a long name still starts in a business office, and no id reaches outside agent-tmp; fails_when=ids over 64 characters or with dots get no folder, or two ids share one; why_new=Codex adversarial review, second ship; seam=none
  assert.equal(F.agentTmpName('pam'), 'pam');
  const long = 'a-very-long-name-for-a-new-hire-who-does-the-books-and-the-taxes-k9x2';
  const name = F.agentTmpName(long);
  assert.match(name, /^[\w-]{1,64}$/);
  assert.notEqual(name, F.agentTmpName(long + 'z'));
  for (const odd of ['..', '../god', 'a/b']) assert.match(F.agentTmpName(odd), /^[\w-]+$/, odd);
  for (const dev of ['con', 'NUL', 'com1']) assert.notEqual(F.agentTmpName(dev), dev, `${dev}: a Windows device name`);
  if (process.platform !== 'win32') {
    const home = '/Users/x/.dbm';
    assert.equal(F.agentTmpDecision(home, long, false, 'Read', `${home}/agent-tmp/${name}/a`, true).deny, false, 'its own');
    assert.deepEqual(F.withAgentTmpWall({ sandbox: { denyWrite: [], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: true }, home, long, false).sandbox.allowRead, [`${home}/agent-tmp/${name}`]);
  }
});
