'use strict';

/**
 * Decision 48 symlink & dangling-link confinement bypass tests.
 *
 * These tests create real symlinks on disk and verify that harnessWriteDecision
 * correctly denies writes that follow symlinks from a workspace into the
 * harness/hive folder, including dangling symlinks and intra-hive symlink tricks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');
const { posixOnly } = require('./platform.cjs');

const { harnessWriteDecision, resolveCanonicalPath } = loadTs('src/main/harnessGuard.ts');

/**
 * Create a temp directory tree for symlink tests:
 *   <root>/workspace/
 *   <root>/harness/
 *   <root>/harness/hive/
 *   <root>/harness/hive/agents/<agentId>/memory/
 *   <root>/harness/hive/agents/<agentId>/outbox/
 *   <root>/harness/hive/agents/<agentId>/inbox/
 *   <root>/harness/hive/triage/
 */
function makeTree(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const workspace = path.join(root, 'workspace');
  const harness = path.join(root, 'harness');
  const hive = path.join(harness, 'hive');
  const agentDir = path.join(hive, 'agents', 'dwight');
  const outbox = path.join(agentDir, 'outbox');
  const inbox = path.join(agentDir, 'inbox');
  const memory = path.join(agentDir, 'memory');
  const triage = path.join(hive, 'triage');
  const scratch = path.join(harness, 'agent-tmp', 'dwight');

  for (const d of [workspace, hive, outbox, inbox, memory, triage, scratch]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { root, workspace, harness, hive, agentDir, outbox, inbox, memory, triage, scratch };
}

function decide(overrides) {
  return harnessWriteDecision({
    tool: 'Write',
    toolInput: { file_path: overrides.file_path },
    cwd: overrides.cwd,
    agentId: overrides.agentId || 'dwight',
    isGod: overrides.isGod || false,
    harnessHome: overrides.harnessHome,
    hiveRoot: overrides.hiveRoot,
    caseInsensitive: false,
    ...overrides,
  });
}

// ── 1. Workspace symlink -> existing board.md / tasks.json / memory.md is DENIED ──

test('workspace symlink to existing board.md in hive is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'symlink-existing-');
    // Create the target file in the hive
    fs.writeFileSync(path.join(tree.hive, 'board.md'), '# Board');
    // Create a symlink from workspace into hive
    fs.symlinkSync(path.join(tree.hive, 'board.md'), path.join(tree.workspace, 'innocent.md'));

    const res = decide({
      file_path: 'innocent.md',
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'symlink to board.md must be denied');
    assert.ok(
      res.reason.includes(`Save documents, drafts and other work in your own folder (${tree.workspace}) instead.`),
      `reason should mention the workspace folder, got: ${res.reason}`
    );
  }
);

test('workspace symlink to existing tasks.json in hive is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'symlink-tasks-');
    fs.writeFileSync(path.join(tree.hive, 'tasks.json'), '{}');
    fs.symlinkSync(path.join(tree.hive, 'tasks.json'), path.join(tree.workspace, 'draft.json'));

    const res = decide({
      file_path: 'draft.json',
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'symlink to tasks.json must be denied');
  }
);

test('workspace symlink to memory.md is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'symlink-memory-');
    fs.writeFileSync(path.join(tree.memory, 'memory.md'), '# Memory');
    // This targets memory.md (the index), which only the app may write
    fs.symlinkSync(
      path.join(tree.hive, 'agents', 'dwight', 'memory.md'),
      path.join(tree.workspace, 'notes.md')
    );

    // Note: agents/dwight/memory.md is NOT a plumbing file (only memory/inbox.md is)
    const res = decide({
      file_path: 'notes.md',
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'symlink to memory.md must be denied');
  }
);

// ── 2. Workspace DANGLING symlink -> non-existent harness file is DENIED ──

test('workspace dangling symlink to non-existent tasks.json is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'dangling-tasks-');
    // tasks.json does NOT exist in the hive
    fs.symlinkSync(path.join(tree.hive, 'tasks.json'), path.join(tree.workspace, 'dangling.json'));

    const res = decide({
      file_path: 'dangling.json',
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'dangling symlink to tasks.json must be denied');
  }
);

test('workspace dangling symlink to non-existent agent-settings file is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'dangling-settings-');
    // Create a dangling symlink pointing to a non-existent file inside harness (not hive)
    fs.symlinkSync(
      path.join(tree.harness, 'agent-settings', 'claude.json'),
      path.join(tree.workspace, 'config.json')
    );

    const res = decide({
      file_path: 'config.json',
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'dangling symlink to agent-settings must be denied');
  }
);

// ── 3. Intra-hive outbox symlink -> board.md or outside harnessHome is DENIED ──

test('intra-hive outbox symlink to board.md is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'outbox-escape-');
    fs.writeFileSync(path.join(tree.hive, 'board.md'), '# Board');
    // Create a symlink from agents/dwight/outbox/ that follows .. up to board.md
    fs.symlinkSync(
      path.join(tree.hive, 'board.md'),
      path.join(tree.outbox, 'escape.json')
    );

    const res = decide({
      file_path: path.join(tree.outbox, 'escape.json'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'outbox symlink to board.md must be denied');
  }
);

test('intra-hive outbox symlink to file outside harnessHome is DENIED',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'outbox-outside-');
    fs.writeFileSync(path.join(tree.workspace, 'secret.txt'), 'secret');
    // Create a symlink from outbox that points outside harnessHome
    fs.symlinkSync(
      path.join(tree.workspace, 'secret.txt'),
      path.join(tree.outbox, 'outside.json')
    );

    const res = decide({
      file_path: path.join(tree.outbox, 'outside.json'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'outbox symlink pointing outside harness must be denied');
  }
);

// ── 4. Triage dangling symlink overwrite is DENIED ──

test('triage dangling symlink is DENIED even though existsSync returns false',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'triage-dangling-');
    // Create a dangling symlink in triage/ pointing to tasks.json (which does not exist)
    fs.symlinkSync(
      path.join(tree.hive, 'tasks.json'),
      path.join(tree.triage, '2026-dwight.json')
    );

    // existsSync follows symlinks, so it returns false for a dangling symlink
    assert.equal(fs.existsSync(path.join(tree.triage, '2026-dwight.json')), false, 'precondition: existsSync is false for dangling symlink');
    // but lstatSync sees the symlink itself
    assert.ok(fs.lstatSync(path.join(tree.triage, '2026-dwight.json')).isSymbolicLink(), 'precondition: lstatSync sees the symlink');

    const res = decide({
      file_path: path.join(tree.triage, '2026-dwight.json'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'dangling symlink in triage/ must be denied');
  }
);

// ── 5. Normal legitimate writes still PASS (deny: false) ──

test('normal write to workspace is allowed',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'normal-workspace-');
    const res = decide({
      file_path: path.join(tree.workspace, 'proposal.md'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, false, 'writing to workspace should be allowed');
  }
);

test('writing to own memory/inbox.md (real non-symlink path) is allowed',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'normal-inbox-');
    const res = decide({
      file_path: path.join(tree.hive, 'agents', 'dwight', 'memory', 'inbox.md'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, false, 'writing to own memory/inbox.md should be allowed');
  }
);

test('writing to own outbox (real non-symlink path) is allowed',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'normal-outbox-');
    const res = decide({
      file_path: path.join(tree.outbox, 'msg-1.json'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, false, 'writing to own outbox should be allowed');
  }
);

test('writing a brand-new triage filing (real non-symlink path) is allowed',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'normal-triage-');
    const res = decide({
      file_path: path.join(tree.triage, 'filing-1-dwight.json'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, false, 'writing a new triage filing should be allowed');
  }
);

// ── 6. Agent scratch folder symlink tests (ship review D6.1) ──

test('a link in the agent\'s scratch folder pointing at hive/board.md is refused',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'scratch-escape-');
    fs.writeFileSync(path.join(tree.hive, 'board.md'), '# Board');
    // Symlink inside dwight's scratch folder pointing to hive/board.md
    fs.symlinkSync(
      path.join(tree.hive, 'board.md'),
      path.join(tree.scratch, 'sneak.md')
    );

    const res = decide({
      file_path: path.join(tree.scratch, 'sneak.md'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, true, 'symlink in scratch pointing at hive/board.md must be denied');
  }
);

test('a plain file in the agent\'s scratch folder is allowed',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const tree = makeTree(t, 'scratch-plain-');
    const res = decide({
      file_path: path.join(tree.scratch, 'notes.md'),
      cwd: tree.workspace,
      agentId: 'dwight',
      isGod: false,
      harnessHome: tree.harness,
      hiveRoot: tree.hive,
    });
    assert.equal(res.deny, false, 'plain file in scratch folder should be allowed');
  }
);

// ── resolveCanonicalPath unit tests ──

test('resolveCanonicalPath follows a real symlink on disk',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rcp-real-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const realFile = path.join(root, 'real.txt');
    fs.writeFileSync(realFile, 'hello');
    const link = path.join(root, 'link.txt');
    fs.symlinkSync(realFile, link);

    const result = resolveCanonicalPath(link);
    assert.equal(result.symlinkLoop, false);
    // The result should point to the real file, not the symlink
    assert.equal(result.path, fs.realpathSync(realFile));
  }
);

test('resolveCanonicalPath follows a dangling symlink',
  posixOnly('symlinks are POSIX'),
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rcp-dangle-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const target = path.join(root, 'subdir', 'nonexistent.txt');
    fs.mkdirSync(path.join(root, 'subdir'), { recursive: true });
    const link = path.join(root, 'dangle.txt');
    fs.symlinkSync(target, link);

    const result = resolveCanonicalPath(link);
    assert.equal(result.symlinkLoop, false);
    // Should resolve to the real path of the target (resolving the existing parent)
    const expectedParent = fs.realpathSync(path.join(root, 'subdir'));
    assert.equal(result.path, path.join(expectedParent, 'nonexistent.txt'));
  }
);

test('resolveCanonicalPath returns lexical path for non-existent paths (test compatibility)',
  () => {
    // This tests that synthetic paths used in unit tests (like /Users/me/HarnessAgents)
    // that don't exist on disk still work — they just return the resolved lexical path.
    const fakePath = '/Users/me/HarnessAgents/hive/agents/oscar/memory/inbox.md';
    const result = resolveCanonicalPath(fakePath);
    assert.equal(result.symlinkLoop, false);
    assert.equal(result.path, path.resolve(fakePath));
  }
);
