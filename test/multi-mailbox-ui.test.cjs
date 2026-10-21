'use strict';

/**
 * Multi-mailbox UI wiring (docs/designs/multi-mailbox.md, design review):
 * Capabilities is a tab after Profile on every agent and on Michael (D2, E3);
 * Mailboxes leads Settings > Connections with the Team email switch (1A, 2A);
 * the Email & Calendar row left the server list; a new office never gets the
 * upgrade note (4A); the restart-on-enable watcher has its 10 minute ceiling (E5).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('Capabilities is the tab after Profile, for team members and for Michael', () => {
  const side = read('src/renderer/src/components/SidebarTabs.tsx');
  assert.ok(side.indexOf("key: 'capabilities'") > side.indexOf("key: 'profile'"));
  assert.ok(side.indexOf("key: 'capabilities'") < side.indexOf("key: 'messages'"));
  assert.match(read('src/renderer/src/components/AgentDetailPanel.tsx'), /sidebarTab === 'capabilities' && \(\s*<CapabilitiesTab agent=\{agent\} \/>/);
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  // On Michael, ASK ME stays second (owner, 2026-09-25); Capabilities follows it.
  assert.ok(cc.indexOf("key: 'capabilities'") > cc.indexOf("key: 'human'") && cc.indexOf("key: 'capabilities'") < cc.indexOf("key: 'terminal'"));
  assert.match(cc, /tab === 'capabilities' && <CapabilitiesTab agent=\{agent\} \/>/);
});

test('Claude connectors lead Connections, then Mailboxes; Gmail on the Claude account is a connector row, not a mailbox (E4)', () => {
  const settings = read('src/renderer/src/components/SettingsModal.tsx');
  assert.ok(settings.indexOf('<ClaudeConnectorsSettings />') < settings.indexOf('<MailboxesSettings />'), 'connectors first (design D2)');
  assert.ok(settings.indexOf('<MailboxesSettings />') < settings.indexOf('<IntegrationsRegistry />'));
  const mb = read('src/renderer/src/components/MailboxesSettings.tsx');
  assert.equal((mb.match(/<Toggle /g) || []).length, 0, 'no Claude account switch among the mailboxes');
  assert.doesNotMatch(mb, /email-calendar|claudeAccess/);
  assert.match(mb, /t\('mailboxes\.gmailIsConnector'\)/, 'the info icon says where Gmail went');
  assert.match(read('src/renderer/src/components/McpDefaultsSettings.tsx'), /e\.id !== 'email-calendar'/);
});

test('Email is a list of the mailboxes a member uses; watching starts Draft only (6A); Sending is a radio group (7A)', () => {
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  // Owner, 2026-10-07: no on/off switch. Each address the member uses is a row
  // with its Inbox (who watches it) and its Sending; Add a mailbox asks Watch
  // the inbox or Send only. Watching never starts beyond Draft only.
  assert.match(cap, /void save\(\{ enabled: true, mailboxes: \[id\], send: false, sending: 'draft' \}, !!mailboxHolder\(config\.agentCapabilities, id, agent\.id\)\);/);
  assert.match(cap, /const stopWatching = \(\): void => \{ void save\(\{ enabled: false, mailboxes: \[\], send: false, sending: 'draft' \}\); \};/);
  assert.match(cap, /void saveGrant\(\{ mailbox: addId, sending: 'draft' \}\)/, 'Send only starts Draft only too');
  assert.doesNotMatch(cap, /mailboxes\[0\]\?\.id/);
  assert.match(cap, /role="radiogroup"/);
  assert.match(cap, /ArrowUp/);
  assert.match(cap, /t\('capabilities\.inboxWatches', \{ name \}\)/);
  assert.match(cap, /t\('capabilities\.inboxSendOnly', \{ holder: nameOf\(grantHolder\), name \}\)/);
  // Picked from a list, with a prompt until one is chosen; a choice that can't be made is greyed with its reason.
  assert.match(cap, /<option value="">\{t\('capabilities\.pickMailbox'\)\}<\/option>/);
  assert.match(cap, /value: 'watch', label: t\('capabilities\.addWatch'\), disabled: !canWatch,/);
  assert.match(cap, /value: 'send', label: t\('capabilities\.addSendOnly'\), disabled: !canSendOnly,/);
  assert.match(cap, /aria-disabled="true"/);
  assert.match(cap, /mailboxes\.length === 0 \? \(/, 'no mailbox set up: the Settings link instead');
  assert.match(cap, /<button type="button" onClick=\{openSettings\} style=\{\{ \.\.\.link, marginInlineStart: 'auto' \}\}>\{t\('capabilities\.addMailbox'\)\}<\/button>/, 'add new mailbox beside the list');
  // No switch in the Email header now; Claude connectors keep one switch per row (design D4).
  assert.equal((cap.match(/<Toggle /g) || []).length, 1, 'the connector row switch only');
  assert.doesNotMatch(cap, /action=\{<Toggle on=\{email\.enabled\}/);
  assert.doesNotMatch(cap, /PROVIDER_PRESETS/, 'no service name under the address');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const c = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).capabilities;
    for (const k of ['emailSummary', 'emailSummaryNone', 'emailNone', 'removeMailbox', 'inbox', 'inboxWatches', 'inboxSendOnly', 'inboxNobody', 'sendingFrom', 'addMailboxUse', 'addMailboxInfo', 'removeWatchedSure', 'addWatch', 'addWatchTaken', 'addWatchMoves', 'addSendOnly', 'addSendOnlyNobody', 'addSendOnlyTaken', 'addIt', 'cancelAdd']) {
      assert.equal(typeof c[k], 'string', `${loc}: capabilities.${k}`);
      assert.doesNotMatch(c[k], /[–—]| - /, `${loc}: capabilities.${k} has a dash`);
    }
  }
});

test('removing a used mailbox names who loses it (8A)', () => {
  assert.match(read('src/renderer/src/components/MailboxesSettings.tsx'), /t\('mailboxes\.removeAffects', \{ names: list\(losing\) \}\)/);
});

test('no Ask me card announces per-member email (owner, 2026-09-26)', () => {
  assert.doesNotMatch(read('src/main/index.ts'), /Email is now set per team member|email-per-team-member/);
});

test('restart on enable waits for idle, with a 10 minute ceiling (E2, E5)', () => {
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /const CEILING_MS = 10 \* 60_000;/);
  // Restart now (entry.now) skips the wait (eng D2).
  assert.match(hive, /if \(BUSY\.has\(a\.status\) && !overdue && !entry\.now\) continue;/);
  assert.match(hive, /respawnResumed\(a, a\.ptyId\)/);
  // Ship audit: an agent that is not running is dropped from the queue (its next start attaches mail),
  // a failed restart stays queued, and one restart runs per agent at a time.
  assert.match(hive, /if \(!a \|\| !a\.ptyId\) \{ setPendingRestart\(agentId, undefined\); continue; \}/);
  assert.match(hive, /if \(inFlight\.has\(agentId\)\) continue;/);
  assert.match(hive, /if \(res\.ok\) \{\s*setPendingRestart\(agentId, undefined\);/);
  // Only a running agent is queued; turning email off clears a queued email restart.
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(cap, /if \(res\.restartNeeded && agent\.ptyId\) useStore\.getState\(\)\.setPendingRestart\(agent\.id, \{ at: Date\.now\(\), reason: 'email' \}\);/);
  assert.match(cap, /if \(!next\.enabled && !grant && pending\?\.reason === 'email'\) useStore\.getState\(\)\.setPendingRestart\(agent\.id, undefined\);/);
  assert.match(read('src/renderer/src/store/store.ts'), /next\[agentId\] = prev \? \{ \.\.\.entry, at: prev\.at, reason: prev\.reason === 'connectors' \? 'connectors' : entry\.reason \} : entry;/);
  // Add mailbox: nothing is saved until main tests the login; a thrown IPC is a plain failure, not a crash.
  const dlg = read('src/renderer/src/components/AddMailboxDialog.tsx');
  assert.match(dlg, /\.catch\(\(e: unknown\) => \(\{ ok: false as const, kind: 'unknown'/);
  assert.match(dlg, /disabled=\{busy \|\| !address\.trim\(\) \|\| !password\.trim\(\)\}/);
  assert.match(dlg, /if \(e\.key === 'Escape' && !e\.nativeEvent\.isComposing\)/);
  // MB-7 in main: a status change raises or closes one Ask me card, and a repeat of the same status writes nothing.
  const main = read('src/main/index.ts');
  assert.match(main, /if \(!rec \|\| \(rec\.status === status && rec\.statusReason === reason\)\) return;/);
  assert.match(main, /closeMailboxCard\(id, `\$\{rec\.address\} is connected again\.`\)/);
  assert.match(main, /ipcMain\.handle\('mail:save', async \(_evt, input: unknown\) => \{\s*if \(!input \|\| typeof input !== 'object'\) return \{ ok: false, kind: 'invalid'/);
});

test('md-mail is attached at spawn only for agents with email, as the last arguments', () => {
  const main = read('src/main/index.ts');
  const at = main.indexOf("opts.args = [...(opts.args ?? []), '--mcp-config', file];");
  assert.ok(at > 0);
  assert.ok(at < main.indexOf('const res = ptyManager.spawn(opts, owner);', at), 'right before the spawn');
  assert.match(main, /hasMailTools\(readConfig\(\)\.agentCapabilities\?\.\[agentId\]\)/, 'own mailbox or a Send only grant');
  assert.match(main, /mdMailMcpPath\(home, agentId\)/, 'token file under harnessHome/private (#63)');
  assert.match(read('electron-builder.yml'), /from: resources\/md-mail-mcp\.cjs/);
});

test('schedules live in Capabilities: Email and On a schedule fold separately, closed by default (owner, 2026-09-26)', () => {
  const cap = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.ok(cap.indexOf("title={t('capabilities.email')}") < cap.indexOf("title={t('capabilities.schedules')}"), 'Email first, then schedules');
  assert.equal((cap.match(/onToggle=\{\(open\) => setFold\('(email|connectors|schedules)', open\)\}/g) || []).length, 3, 'every section folds');
  assert.match(cap, /<AgentSchedules key=\{agent\.id\} agentId=\{agent\.id\} agentName=\{name\} businessType=\{config\.businessType\} sourceCard=\{agent\.sourceCard\} \/>/);
  assert.match(cap, /useState<Record<SectionKey, boolean>>\(\{ email: true, connectors: true, schedules: true \}\)/, 'all start closed');
  assert.match(read('src/renderer/src/components/triggers/ui.tsx'), /aria-expanded=\{open\}/);
  assert.doesNotMatch(read('src/renderer/src/components/SidebarTabs.tsx'), /key: 'schedules'/);
  assert.doesNotMatch(read('src/renderer/src/components/AgentDetailPanel.tsx'), /sidebarTab === 'schedules'/);
});

test('the office schedule lists Michael\'s jobs too, as plain rows', () => {
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /if \(v === 'schedules'\) return 'capabilities';/, 'a saved Schedules tab opens Capabilities');
  // Office schedule rows are plain text: no arrow, no jump (owner, 2026-09-26).
  assert.doesNotMatch(store, /openAgentSchedule|scheduleFocus/);
  assert.doesNotMatch(read('src/renderer/src/components/triggers/ScheduleList.tsx'), /onJump|openAgentSchedule/);
  assert.match(read('src/renderer/src/components/triggers/ScheduleList.tsx'), /const others = missions\.filter\(\(m\) => m\.enabled\);/, 'only jobs that are on');
  assert.doesNotMatch(read('src/renderer/src/components/triggers/TriggersTab.tsx'), /AgentSchedules/);
});

test('every section on every agent tab starts closed (owner, 2026-09-26)', () => {
  const comps = path.resolve(__dirname, '../src/renderer/src/components');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.tsx')) files.push(p); } };
  walk(comps);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /<TriggerCard[^>]*\sdefaultOpen(\s|>|=\{true\})/, `${path.basename(f)} opens a section by default`);
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /useState<\{ card: AdvancedCard \| null; seq: number \}>\(\{ card: null, seq: 0 \}\)/, 'Advanced opens with no card open');
});

test('a schedule row shows it opens and closes, and the editor has a way out (owner, 2026-09-26)', () => {
  const ui = read('src/renderer/src/components/triggers/ui.tsx');
  assert.match(ui, /export function Disclosure/);
  assert.match(ui, /<Disclosure open=\{open\} \/>/, 'sections use the shared sign');
  const rows = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  assert.match(rows, /\{!readOnly && <Disclosure open=\{open\} \/>\}/, 'editable rows show the sign');
  assert.match(rows, /\{dirty \? t\('common\.cancel'\) : t\('common\.close'\)\}/, 'cancel or close beside save');
});

test('the office schedule is the one section on its tab, so it does not fold (owner, 2026-09-26)', () => {
  const tab = read('src/renderer/src/components/triggers/TriggersTab.tsx');
  assert.match(tab, /<Muted>\{t\('triggersTab\.officeBlurb', \{ godName \}\)\}<\/Muted>\s*<OfficeSchedules \/>/);
  assert.doesNotMatch(tab, /title=\{t\('schedulesSection\.officeSchedule'\)\}/);
});

test('fixing a mailbox, or removing one that needed the owner, closes its Ask me card (MB-7)', () => {
  const main = read('src/main/index.ts');
  // Any successful fix closes it: the card can open during the login test, after `before` was read.
  assert.match(main, /if \(res\.ok && before\) closeMailboxCard\(res\.record\.id,/);
  assert.match(main, /if \(res\.ok && rec\?\.status === 'needs-attention'\) closeMailboxCard\(id,/);
  // Only an open card is closed, so one already done keeps its result.
  assert.match(main, /t\?\.id === cardId && t\.status !== 'done'\);\s*if \(open\) hive\.patchTask\(cardId, \{ status: 'done', result \}\);/);
  const dialog = read('src/renderer/src/components/AddMailboxDialog.tsx');
  assert.match(dialog, /button:not\(\[disabled\]\):not\(\[tabindex="-1"\]\)/, 'the Tab trap ends on the chosen service, not a skipped tile');
  assert.match(read('src/renderer/src/components/MailboxesSettings.tsx'), /refocus\(ok \? 'add' : `remove-\$\{id\}`\);/);
});

test('the schedule picker offers 4h between 2h and 6h (owner, 2026-09-27)', () => {
  const ui = read('src/renderer/src/components/triggers/ui.tsx');
  assert.match(ui, /label: '2h' \},\s*\{ ms: 4 \* HOUR, label: '4h' \},\s*\{ ms: 6 \* HOUR, label: '6h' \}/);
});

test('many mailboxes fold into one header line (owner, 2026-10-01)', () => {
  // docs/designs/mailboxes-fold.md: the list shows and hides, starts closed,
  // opens by itself when a mailbox needs you, broken ones first then A to Z.
  const mb = read('src/renderer/src/components/MailboxesSettings.tsx');
  assert.match(mb, /const \[open, setOpen\] = useState\(false\);/, 'starts closed');
  assert.match(mb, /if \(decided\.current \|\| !config\) return;\s*decided\.current = true;\s*if \(\(config\.mailboxes \?\? \[\]\)\.some\(\(m\) => m\.status === 'needs-attention'\)\) setOpen\(true\);/, 'opens once, when one needs you');
  assert.match(mb, /\.sort\(\(a, b\) => needsFirst\(a\) - needsFirst\(b\) \|\| a\.address\.localeCompare\(b\.address\)\)/);
  assert.match(mb, /<button type="button" aria-expanded=\{open\} aria-controls=\{listId\}/);
  // Add a mailbox works while closed. The Claude account's Gmail moved to
  // Claude connectors (E4), so the fold holds only mailboxes added here.
  const fold = mb.indexOf('<div id={listId}>');
  assert.ok(fold > 0);
  assert.ok(mb.indexOf('<span data-focus="add">') < fold, 'Add works while closed');
  assert.ok(mb.indexOf('<div role="list">') > fold);
  // Explanations live behind info icons, not paragraphs.
  assert.match(mb, /<InfoTip label=\{t\('mailboxes\.title'\)\} text=\{`\$\{t\('mailboxes\.intro'\)\}\$\{mailboxes\.length \? '' : ` \$\{t\('mailboxes\.empty'\)\}`\} \$\{t\('mailboxes\.gmailIsConnector'\)\}`\} \/>/);
  assert.doesNotMatch(mb, /<div style=\{hint\}>\{t\('mailboxes\.intro'\)\}<\/div>/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const m = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).mailboxes;
    for (const k of ['summaryOne', 'summaryCount', 'summaryNone', 'gmailIsConnector']) assert.ok(m[k], `${loc} ${k}`);
    assert.equal(m.claudeAccessDesc, undefined, `${loc}: the Claude account row is gone`);
  }
});

// Value: protects=the 10 minute restart ceiling (E5) never resets when a second reason arrives, while the newer reason and Restart now still apply; fails_when=setPendingRestart overwrites the entry (an agent kept busy by repeated grant changes never restarts) or keeps the old entry whole (Restart now on a waiting email restart is lost); why_new=the only check of setPendingRestart is a regex over store.ts; seam=none
test('a second restart reason keeps the first queued time but takes the new reason and Restart now (E5, connectors D2)', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    const mem = {};
    const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    globalThis.localStorage = storage;
    const store = require(${JSON.stringify(path.join(__dirname, 'load-ts.cjs'))})('src/renderer/src/store/store.ts').useStore;
    const s = () => store.getState();
    s().setPendingRestart('pam', { at: 1000, reason: 'email' });
    s().setPendingRestart('pam', { at: 9000, reason: 'connectors', now: true });
    s().setPendingRestart('oscar', { at: 5000, reason: 'connectors' });
    const both = JSON.parse(JSON.stringify(s().pendingRestart));
    s().setPendingRestart('pam', undefined);
    s().setPendingRestart('pam', { at: 7000, reason: 'email' });
    process.stdout.write(JSON.stringify({ both, after: s().pendingRestart }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
  assert.deepEqual(r.both, { pam: { at: 1000, reason: 'connectors', now: true }, oscar: { at: 5000, reason: 'connectors' } });
  assert.deepEqual(r.after, { oscar: { at: 5000, reason: 'connectors' }, pam: { at: 7000, reason: 'email' } }, 'once cleared, a new queue starts its own clock');
});
