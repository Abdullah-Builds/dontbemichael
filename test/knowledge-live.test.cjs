'use strict';

/**
 * Turning company knowledge on or off reaches running agents on their next
 * prompt, without a restart (owner, 2026-09-25). The search command carries
 * the store's folder, so it works without KG_ROOT in the agent's environment.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager, COMPANY_KNOWLEDGE_OFF } = loadTs('src/main/hive.ts');

test('an agent started with knowledge off is told once when it turns on, and once when it turns off', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-live-'));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home }, { knowledgeGraph: false });
  const on = { active: true, cliPath: '/App/kg.cjs', root: '/Store' };
  assert.equal(hive.knowledgeUpdate('oscar', { active: false }), null, 'nothing changed');
  const told = hive.knowledgeUpdate('oscar', on);
  assert.match(told, /COMPANY KNOWLEDGE: the owner keeps company wide information/);
  assert.ok(told.includes('"/App/kg.cjs" search "<words>" --root "/Store"'), 'the store rides on the command');
  assert.equal(hive.knowledgeUpdate('oscar', on), null, 'told once');
  assert.equal(hive.knowledgeUpdate('oscar', { active: false }), COMPANY_KNOWLEDGE_OFF);
  assert.equal(hive.knowledgeUpdate('ghost', on), null, 'agents this launch didn\'t start are left alone');
});

test('the hook carries the update alongside the roster and goal', () => {
  const hooks = fs.readFileSync(path.resolve(__dirname, '../src/main/hooks.ts'), 'utf8');
  assert.match(hooks, /this\.hive\.knowledgeUpdate\(agentId, this\.getKnowledge\(\)\)/);
  assert.match(hooks, /\[roster, profile, foundations, memoryIndex, handoff, goal, knowledgeNote, ownerRequests, ownerQuestions, stuckCards, steer\]\.filter\(Boolean\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8'), /\(\) => \(\{ \.\.\.knowledge\.agentAccess\(\), meaning: meaningSearch\(\) \}\),\n  companyProfileForAgents,\n/);
});

test('the search tool finds the store from --root, with no KG_ROOT set', () => {
  const core = require('../src/main/kg-core.cjs');
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-store-'));
  const doc = path.join(store, 'refunds.md');
  fs.writeFileSync(doc, '# Refund policy\n\nRefunds are given within 30 days with a receipt.');
  core.ingest(store, { srcPath: doc });
  const env = { ...process.env };
  delete env.KG_ROOT;
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../resources/kg.cjs'), 'search', 'refund receipt', '--root', store], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Refund/);
});

test('a member is told again when search by meaning turns on or its language changes, with the model on the command', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-kg-live-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  const meaning = { bin: '/bin/mempalace', palace: '/Palace', model: 'minilm' };
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home }, { knowledgeGraph: true, kgCliPath: '/App/kg.cjs', meaningSearch: meaning });
  const on = { active: true, cliPath: '/App/kg.cjs', root: '/Store' };
  assert.equal(hive.knowledgeUpdate('oscar', { ...on, meaning }), null, 'nothing changed');
  const switched = hive.knowledgeUpdate('oscar', { ...on, meaning: { ...meaning, model: 'embeddinggemma' } });
  assert.ok(switched.includes('MEMPALACE_EMBEDDING_MODEL=embeddinggemma "/bin/mempalace" --palace "/Palace" search'), switched);
  assert.equal(hive.knowledgeUpdate('oscar', { ...on, meaning: { ...meaning, model: 'embeddinggemma' } }), null, 'told once');
  const off = hive.knowledgeUpdate('oscar', on);
  assert.doesNotMatch(off, /mempalace/, 'search by meaning off: the line without it');
});

test('a language change clears the index so the next pass builds it with the new model', (t) => {
  const { MemoryManager } = loadTs('src/main/memory.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-palace-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const palace = path.join(home, 'palace');
  fs.mkdirSync(palace);
  fs.writeFileSync(path.join(palace, 'mempalace_embedder.json'), '{}');
  const m = new MemoryManager(() => home, () => ({ enabled: true, model: 'embeddinggemma' }));
  m.binCache = null; // not installed here: the rebuild waits for a pass
  m.modelChanged();
  assert.equal(m.rebuildPending, true, 'kept for the next pass');
  assert.ok(fs.existsSync(palace));
  m.rebuild();
  assert.equal(fs.existsSync(palace), false);
  assert.equal(m.rebuildPending, false);
  assert.equal(m.companySignature, null, 'company knowledge indexed again');
});
