'use strict';

/**
 * Issue #326 wiring and words: what the watch is fed, how a member is stopped,
 * Research's held questions, and the card's strings in every language. The
 * renderer has no DOM harness, so its placement is pinned in source; the look
 * is a live check against silent-engine-v2.html.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the main process feeds the watch every hook event, the fleet beat and the owner\'s keystrokes, and restores it after the store opens', () => {
  // Value: protects=the watch hears check ins, sees members and leaves typing alone; fails_when=one feed is dropped or the restore runs before the store opens; why_new=new wiring; seam=source pin; no_claim=runtime timing (e2e covers the socket path)
  const main = read('src/main/index.ts');
  assert.match(main, /workerWake\.noteHook\(agentId, event, message\);\n\s*\/\/ Any event, a Claude status tick included, is a check in \(issue #326\);\n[^\n]*\n\s*silentWatch\?\.noteHook\(agentId, event\);/);
  assert.match(main, /writeFleetSnapshot\(\);\n\s*try \{ silentBeat\(\); \}/);
  assert.match(main, /ptyInputAt\.set\(id, Date\.now\(\)\);\n\s*return ptyManager\.write\(id, data\);/);
  const open = main.indexOf('try { persist.open(); }');
  const restore = main.indexOf('silentWatch?.restore(persist.getKv<SilentEpisode[]>(SILENT_KV_KEY)');
  assert.ok(open > 0 && restore > open, 'restored after the store opens (SD8)');
  assert.match(main, /hive\.memberMail = \(agentId\) => mailFor\(silentWatch\?\.episode\(agentId\)\);/);
});

test('a stopped member keeps its place: only the process ends, never the teardown that archives it (R1)', () => {
  // Value: protects=a stopped member stays on its card and can resume; fails_when=the stop archives it (teardownPty) or leaves the process running; why_new=R1; seam=source pin; no_claim=the process actually dying (pty.ts kill is tested elsewhere)
  const main = read('src/main/index.ts');
  const stop = main.slice(main.indexOf('  stop: (m) =>'), main.indexOf('\n', main.indexOf('  stop: (m) =>')));
  assert.match(stop, /ptyManager\.kill\(m\.ptyId\)/);
  assert.doesNotMatch(stop, /teardownPty/);
});

test('the automatic restart shares the stuck path\'s once per 30 minutes limit, and is logged for Michael\'s activity (R4, SD11)', () => {
  // Value: protects=never two automatic restarts within 30 minutes; fails_when=the watch keeps its own limit or skips the stamp; why_new=R4; seam=source pin; no_claim=none beyond protects
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /mayAutoRestart\(agentId: string\): boolean \{\n\s*const last = this\.stuckRestartAt\.get\(agentId\);\n\s*return last === undefined \|\| this\.now\(\) - last >= STUCK_AGAIN_MS;/);
  assert.match(hooks, /noteAutoRestart\(agentId: string\): void \{ this\.stuckRestartAt\.set\(agentId, this\.now\(\)\); \}/);
  const main = read('src/main/index.ts');
  assert.match(main, /mayAutoRestart: \(agentId\) => hookServer\.mayAutoRestart\(agentId\),/);
  assert.match(main, /if \(auto\) \{\n\s*hookServer\.noteAutoRestart\(agentId\);/);
  assert.match(main, /kind: 'silent-auto-restart'/);
});

test('questions for a Research member that isn\'t reporting wait with Michael (SD16)', async (t) => {
  // Value: protects=Research is held like anyone; fails_when=the trust layer path skips the hold; why_new=SD16; seam=fake trust layer; no_claim=the trust layer itself
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
  const { HiveManager } = loadTs('src/main/hive.ts');
  HiveManager.TRUST_WAIT_MS = 0;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-silent-research-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'research', name: 'Pete', provider: 'claude', cwd: path.join(home, 'desk'), isResearch: true });
  hive.setResearchEnabled(() => true);
  hive.setTrustLayer({ inbound: async (m) => ({ decision: 'pass', subject: m.subject, body: m.body }), outbound: async (m) => ({ decision: 'pass', subject: m.subject, body: m.body }) });
  hive.memberMail = (id) => (id === 'research' ? 'hold' : null);
  fs.writeFileSync(path.join(hive.root(), 'agents', 'pam', 'outbox', 'q.json'), JSON.stringify({ to: 'research', act: 'query', subject: 'Flour prices', body: 'What does flour cost?' }));
  const dir = (id) => path.join(hive.root(), 'agents', id, 'inbox');
  const msgs = (id) => (fs.existsSync(dir(id)) ? fs.readdirSync(dir(id)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir(id), f), 'utf8'))) : []);
  const held = () => msgs('god').some((m) => /^\[held: "Pete" isn't reporting to the app/.test(m.subject));
  // Wait for the outcome, never a fixed time: the trust layer path is async.
  for (const end = Date.now() + 10_000; !held(); await new Promise((r) => setTimeout(r, 10))) {
    if (Date.now() > end) assert.fail('the question was never held for Michael');
    hive.routeOnce();
  }
  assert.equal(msgs('research').length, 0);
});

test('a member kept working unchecked gets its mail by its terminal, or Michael gets it when no window can hand it over; Michael\'s own mail is never held (SD5, SD12)', async (t) => {
  // Value: protects=the owner's keep reaches the member, and nothing is lost; fails_when=handoff mail lands in the inbox, a failed handoff drops or bounces it unseen, or Michael's own mail is held; why_new=the handoff branch of routeMessage had no test (the e2e covers hold only); seam=the hive's emit sink; no_claim=the renderer typing into the terminal
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-silent-keep-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let windowUp = true;
  const handed = [];
  const hive = new HiveManager(() => home, (channel, p) => { if (channel !== 'hive:terminalHandoff') return undefined; if (windowUp) handed.push([p.to, p.subject]); return windowUp; });
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'kelly', name: 'Kelly', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'pam', name: 'Pam', provider: 'claude', cwd: home });
  hive.memberMail = (id) => (id === 'kelly' ? 'handoff' : 'hold');
  const dir = (id) => path.join(hive.root(), 'agents', id, 'inbox');
  const msgs = (id) => (fs.existsSync(dir(id)) ? fs.readdirSync(dir(id)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir(id), f), 'utf8'))) : []);
  const post = (from, msg, name) => fs.writeFileSync(path.join(hive.root(), 'agents', from, 'outbox', name), JSON.stringify(msg));
  post('pam', { to: 'kelly', act: 'inform', subject: 'Invoice 4471', body: 'Paid' }, 'a.json');
  hive.routeOnce();
  assert.deepEqual(handed, [['kelly', 'Invoice 4471']], 'by its terminal');
  assert.equal(msgs('kelly').length, 0, 'never its inbox, which nothing checks');
  assert.ok(!msgs('god').some((m) => /Invoice 4471/.test(m.subject)), 'Michael is not given it as well');
  windowUp = false;
  post('pam', { to: 'kelly', act: 'inform', subject: 'Invoice 4472', body: 'Paid' }, 'b.json');
  hive.routeOnce();
  assert.ok(msgs('god').some((m) => /^\[held: "Kelly" isn't reporting to the app/.test(m.subject) && /Invoice 4472/.test(m.subject)), 'no window: held for Michael, not lost');
  post('pam', { to: 'god', act: 'inform', subject: 'For Michael', body: 'Hi' }, 'c.json');
  hive.routeOnce();
  assert.ok(msgs('god').some((m) => m.subject === 'For Michael'), 'Michael\'s own mail is never held, whatever the watch says');
});

test('the card, the tag and the panel line are placed where the design says (SD1, SD14)', () => {
  // Value: protects=placement on the board, the pods, the panel header and above the tabs; fails_when=a piece is dropped or All clear shows beside a card; why_new=new UI; seam=source pin; no_claim=the look (live check against silent-engine-v2.html)
  const ask = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(ask, /<OfficeBreakCard \/>\s*<SilentEngineCards \/>/);
  assert.match(ask, /!engineCard && !onBreak && !researchNotice && !knowledgeNotice && !silentShown &&/);
  assert.match(read('src/renderer/src/shell/PanelChrome.tsx'), /\{silent \? <NotReportingTag/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.equal((stage.match(/<NotReportingTag/g) ?? []).length, 2, 'member pods and Michael\'s');
  for (const f of ['src/renderer/src/components/AgentDetailPanel.tsx', 'src/renderer/src/components/CommandCenterPanel.tsx']) {
    assert.match(read(f), /<SilentPanelLine agentId=\{agent\.id\} name=\{agent\.name\} \/>/, f);
  }
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /const silent = silentCards\(merged\.silent\)\.length;\n\s*if \(silent\) feed = \{ \.\.\.feed, count: feed\.count \+ silent \};/);
});

test('the card\'s words exist in every language, with no dashes, names only (SD2, SD15)', () => {
  // Value: protects=plain words in three languages and no he or she; fails_when=a key is missing, a dash or a pronoun appears; why_new=new strings; seam=none; no_claim=translation quality
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).silent;
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).silent;
    assert.deepEqual(Object.keys(s).sort(), Object.keys(en).sort(), loc);
    for (const [k, v] of Object.entries(s)) assert.doesNotMatch(v, /[—–]| - /, `${loc} silent.${k}`);
  }
  for (const [k, v] of Object.entries(en)) assert.doesNotMatch(v, /\b(he|she|her|his|him)\b/i, `en silent.${k}`);
  assert.equal(en.title, "{{name}} isn't reporting to the app");
  assert.equal(en.stillWorking, "{{name}} is still working. The app can't check {{name}}'s folder and tool limits.");
  assert.equal(en.keep, 'Keep working unchecked');
  assert.match(en.info, /^While \{\{name\}\} works, \{\{name\}\}'s AI engine sends the app small reports\./);
});

// ── Ship review 2026-10-17 ──

test('the main process watches archived members as not running, stops without archiving, and resolves each engine to its binary for the version', () => {
  // Value: protects=cards survive a relaunch; a stopped member is not live to the breaker or the roster; versions are known so the never reports rule applies; fails_when=archived members are filtered out, the stop skips pausePty, or the bare command reaches the probe; why_new=red team and core review; seam=source pin; no_claim=runtime order at launch
  const main = read('src/main/index.ts');
  const beat = main.slice(main.indexOf('function silentBeat(): void {'), main.indexOf('silentWatch.beat(members);'));
  assert.match(beat, /\.filter\(\(\[, a\]\) => a && !a\.isAssistant && !\(a\.archived && a\.closedByOwner\)\)/, 'a member the owner closed or deleted is gone');
  assert.doesNotMatch(beat, /!a\.archived &&/);
  assert.match(beat, /const s = ptyId && !a\.archived \? sessions\.get\(ptyId\) : undefined;/);
  assert.match(beat, /running: !!s, pid: s\?\.pid,/);
  assert.match(beat, /isResearch: id === RESEARCH_ID,/);
  assert.match(main, /stop: \(m\) => \{ if \(m\.ptyId\) \{ try \{ ptyManager\.kill\(m\.ptyId\); \} catch \{ \/\* already gone \*\/ \} pausePty\(m\.ptyId\); \} \},/);
  const pause = main.slice(main.indexOf('function pausePty(id: string): void {'), main.indexOf('function teardownPty(id: string, opts'));
  assert.match(pause, /ptyToAgent\.delete\(id\);/);
  assert.match(pause, /breaker\.forget\(agentId\)/);
  assert.doesNotMatch(pause, /setArchived|removeWorktree/, 'not archived, its worktree kept');
  assert.match(pause, /pausedPty\.set\(id, agentId\);/);
  assert.match(pause, /closingTime\.refresh\(agentId\)/);
  assert.match(main, /const agentId = ptyToAgent\.get\(id\) \?\? pausedPty\.get\(id\);/, 'a later teardown still archives a paused member');
  assert.match(main, /ptyToAgent\.set\(opts\.id, opts\.hive\.id\);\n\s*pausedPty\.delete\(opts\.id\);/);
  // Every way a card ends tells Michael held mail is his to send or route.
  for (const type of ['resolved', 'dropped', 'removed']) assert.match(main, new RegExp(`type === '${type}' && !episode\\.isMichael\\) \\{\\n\\s*silentNoteToMichael\\([^\\n]*resendLine\\(name`), type);
  assert.match(main, /try \{ bin = ptyManager\.commandPath\(command\); \} catch \{ \/\* unknown \*\/ \}\n\s*if \(bin\) void claudeCliVersion\(bin\)/);
});

test('held copies for Michael: one per message naming every silent member, under its own id, and a silent Research costs no check', async (t) => {
  // Value: protects=no held copy replaces Michael's own broadcast copy or another held one; a question for a silent Research waits with Michael before any paid check and nobody is told it was sent; fails_when=held copies reuse the message id, one copy is made per member, or the inbound gate checks first; why_new=red team review; seam=fake trust layer
  const electron = require.resolve('electron');
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
  const { HiveManager } = loadTs('src/main/hive.ts');
  const R = loadTs('src/shared/research.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-silent-held-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name] of [['kelly', 'Kelly'], ['dwight', 'Dwight'], ['pam', 'Pam']]) await hive.ensureAgent({ id, name, provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'research', name: 'Pete', provider: 'claude', cwd: path.join(home, 'desk'), isResearch: true });
  hive.setResearchEnabled(() => true);
  let checks = 0;
  hive.setTrustLayer({ inbound: async (m) => { checks++; return { decision: 'pass', subject: m.subject, body: m.body }; }, outbound: async (m) => ({ decision: 'pass', subject: m.subject, body: m.body, flagged: false }) });
  hive.memberMail = (id) => (['kelly', 'dwight', 'research'].includes(id) ? 'hold' : null);
  const dir = (id) => path.join(hive.root(), 'agents', id, 'inbox');
  const msgs = (id) => (fs.existsSync(dir(id)) ? fs.readdirSync(dir(id)).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir(id), f), 'utf8')) })) : []);
  hive.send({ to: 'broadcast', act: 'inform', subject: 'Office closes early', body: 'At 3 pm today' }, 'human');
  const forMichael = msgs('god').filter((m) => /Office closes early/.test(m.subject));
  const held = forMichael.filter((m) => m.subject.startsWith('[held:'));
  assert.equal(held.length, 1, 'one held copy for the two silent members');
  assert.match(held[0].subject, /^\[held: "Kelly", "Dwight" aren't reporting to the app; route this to someone else, or send it to them again once they report\]/);
  assert.ok(held[0].id.endsWith('-held'));
  assert.ok(forMichael.some((m) => !m.subject.startsWith('[held:')), 'Michael\'s own copy of the broadcast is still there');
  assert.ok(msgs('pam').some((m) => m.subject === 'Office closes early'));
  fs.writeFileSync(path.join(hive.root(), 'agents', 'pam', 'outbox', 'q.json'), JSON.stringify({ to: 'research', act: 'query', subject: 'Flour', body: 'Flour prices' }));
  // The hold is decided at once, before any check could start, so one routing pass shows it.
  hive.routeOnce();
  assert.equal(checks, 0, 'no check paid for a question Research can\'t take now');
  assert.ok(msgs('god').some((m) => /^\[held: "Pete" isn't reporting to the app/.test(m.subject) && /Flour/.test(m.subject)));
  assert.equal(msgs('pam').filter((m) => m.subject === R.SENT_AS_SUBJECT).length, 0, 'Pam is not told it reached Pete');
  assert.equal(msgs('research').length, 0);
});

test('a restart keeps the member\'s worktree; closing or deleting removes it', () => {
  // Value: protects=an isolated member's uncommitted work survives Restart and Continue and the watch's restarts; fails_when=the restart's kill runs the full teardown; why_new=Codex adversarial review 2026-10-17; seam=source pin, the teardown needs Electron
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /await window\.cth\.killPty\(ptyId, \{ restart: true \}\);/);
  const main = read('src/main/index.ts');
  assert.match(main, /teardownPty\(id, \{ keepWorktree: restart \}\);/);
  assert.match(main, /const wtPath = opts\.keepWorktree \? undefined : worktreePaths\.get\(id\);/);
  assert.match(read('src/renderer/src/components/EditAgentModal.tsx'), /killPty: \(ptyId\) => window\.cth\.killPty\(ptyId\),/, 'delete still tears down fully');
  // Restart and Continue and the model switch restart in the worktree too.
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /const cwd = a\.worktreePath && \(await window\.cth\.gitIsRepo\(a\.worktreePath\)\) \? a\.worktreePath : a\.cwd;\n\s*const killed = await window\.cth\.killPty\(a\.ptyId, \{ restart: true \}\);/);
  // A worker's restart keeps its gated teardown for later.
  assert.match(main, /if \(!opts\.keepWorktree && liveWorkers\.has\(id\)\) liveWorkers\.delete\(id\);/);
});
