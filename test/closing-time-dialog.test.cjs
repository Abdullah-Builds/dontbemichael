'use strict';

/**
 * The closing-time dialog's rows (owner, 2026-09-29). Structural checks: the
 * renderer has no DOM test harness here, so these pin the wiring that the
 * unit tests in closing-time-progress.test.cjs cannot see.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the dialog keeps its safety invariants: Michael by id, never excused, no terminal stopped', () => {
  // Value: protects=the owner can never close without Michael or stop a terminal from the dialog; fails_when=the dialog hard-codes Michael, excuses him, or calls a PTY kill; why_new=row wording moved to closing-time-rows.test.cjs; seam=none
  const src = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(src, /const godId = closing\.godId;/, "Michael's row comes from the event, never a hard-coded id");
  assert.match(src, /remindButton\(godId\)/, 'Michael can be reminded');
  assert.doesNotMatch(src, /closeWithout[^\n]*godId|closingTimeExcuse\(godId\)/, 'never close without Michael');
  assert.doesNotMatch(src, /ptyKill|pty:kill|killPty/, 'the dialog stops no terminal');
  // A double click cannot send twice; focus returns after a confirm closes;
  // an ended Michael gets no Remind (review pass 3, owner 2026-09-29).
  assert.match(src, /if \(busy\[id\]\) return;/);
  assert.match(src, /<MiniButton disabled=\{!!busy\[id\]\} onClick=\{\(\) => \{ void act\(id, 'remind'\); \}\}>/);
  assert.match(src, /const keepWaiting = \(id: string\): void => \{ setConfirming\(null\); setRefocus\(id\); \};/);
  assert.match(src, /\{!done && !godGone && <span/);
  assert.match(src, /const godGone = closing\.godLive === false;/);
  assert.match(src, /c\.phase === 'timeout' && c\.godLive !== false && \(/, 'no "keep waiting" advice once Michael is gone');
  // Focus comes back after Remind and after a refused Close without them (R23).
  assert.match(src, /setRefocus\(kind === 'excuse' \? 'keep' : id\)/);
  assert.match(src, /buttonRef=\{keepButton\}/);
  assert.match(src, /godGone \? t\('closingTime\.michaelEnded'\)/);
  assert.match(src, /\{godDone && !done && !godGone && \(/, "no stale tool line under an ended Michael");
  // While confirming, only the confirm's own Close without them shows (review R13).
  assert.match(src, /\{confirming !== id && <MiniButton [^\n]*?onClick=\{\(\) => setConfirming\(id\)\}>/);
  // A refusal is shown, never taken as success (review R1, owner 2026-09-29).
  assert.match(src, /const message = actionMessage\(res, t\('closingTime\.sendFailed'\)\);\n(?:\s*\/\/[^\n]*\n)*\s+if \(message\) \{ setFailed/);
  assert.match(src, /: headerLine\(c, t\);/, 'the counter strip comes from the tested headerLine()');
});

test('App passes the new event fields through to the dialog', () => {
  assert.match(read('src/renderer/src/App.tsx'), /const \{ phase, \.\.\.rows \} = ev;[\s\S]{0,200}setClosing\(\{ phase, \.\.\.rows \}\)/);
});

test('the tool detail and its clock are live-only: never saved, never a reason to save', () => {
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /'lastPrompt', 'actionDetail', 'actionAt'/, 'volatile: a tool call does not rewrite localStorage');
  assert.equal((store.match(/actionDetail, actionAt, \.\.\.rest/g) || []).length, 2, 'stripped from both saved rosters');
  assert.match(store, /'seedPrompt' \| 'actionDetail' \| 'actionAt'>/);
});

test('the clock restarts on hook events only, never from the terminal parser', () => {
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /action: `using \$\{e\.tool\}`, actionDetail: e\.detail, actionAt: Date\.now\(\)/);
  assert.doesNotMatch(read('src/renderer/src/hooks/usePtyParser.ts'), /actionAt|actionDetail/);
  // Value: protects=a row never shows a finished agent's old tool detail or clock; fails_when=an idle/stop/compact hook branch stops clearing them; why_new=only the PreToolUse set was checked; seam=none
  // Hook-event idle patches only (updateAgent(e.agentId, ...)); the silence
  // watchdog's guess (updateAgent(a.id, ...)) leaves the detail and clock alone.
  const idleSets = hive.match(/updateAgent\(e\.agentId, \{ status: 'idle', action: 'idle', carrying: undefined[^}]*\}/g) || [];
  assert.equal(idleSets.length, 3, 'PostInvocation, Stop and the idle Notification');
  for (const p of idleSets) assert.match(p, /actionDetail: undefined, actionAt: Date\.now\(\)/, p);
  // Value: protects=a compacting or prompt-parked agent never shows the last tool's detail or its old clock; fails_when=the compact or at-prompt hook patch stops clearing them; why_new=only the idle patches were checked; seam=none
  for (const re of [
    /status: 'compacting', action: 'compacting context', carrying: undefined, actionDetail: undefined, actionAt: Date\.now\(\) \}/,
    /status: 'working', action: 'resumed', carrying: undefined, actionDetail: undefined, actionAt: Date\.now\(\) \}/,
    /\{ status: 'waiting', action: ACTION_AT_PROMPT, actionDetail: undefined, actionAt: Date\.now\(\) \}/
  ]) assert.match(hive, re);
});

test('a terminal ending mid-close refreshes the rows, guarded for startup order', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /try \{ if \(agentId\) closingTime\.refresh\(agentId\); \} catch \(e\) \{ console\.error\('\[closing-time\] refresh:', e\); \}/, 'a refresh failure is logged, never hidden, and never breaks teardown');
  // And one that comes back is waited on again, once its terminal really started.
  assert.match(main, /try \{ if \(res\.ok && opts\.hive\?\.id\) closingTime\.revive\(opts\.hive\.id\); \} catch \(e\) \{ console\.error\('\[closing-time\] revive:', e\); \}/);
});

test('Remind and Close without them reach main on the channels main handles', () => {
  // Value: protects=the preload and main agree on the Remind/Close-without IPC channels; fails_when=one side renames a channel so the buttons only say "Didn't send"; why_new=nothing pinned the channels; seam=none
  const preload = read('src/preload/index.ts');
  const main = read('src/main/index.ts');
  for (const [channel, method] of [['app:closingTimeRemind', 'remind'], ['app:closingTimeExcuse', 'excuse']]) {
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}', id\\)`), channel);
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}', \\(_evt, id: unknown\\) => closingTime\\.${method}\\(id\\)\\)`), channel);
  }
});

test('every closing-time string the dialog shows exists in English', () => {
  // Value: protects=no row shows a raw "closingTime.x" key; fails_when=a t('closingTime.*') key is renamed or mistyped on one side; why_new=locale parity tests only compare locales, not what the code renders; seam=none
  const src = read('src/renderer/src/components/ClosingTimeBar.tsx') + read('src/renderer/src/components/closingTimeRows.ts');
  const used = [...new Set([...src.matchAll(/\bt\('closingTime\.([A-Za-z0-9_]+)'/g)].map((m) => m[1]))];
  assert.ok(used.includes('closeWithout') && used.includes('stillWorking'), 'sanity: both files are scanned');
  const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json')).closingTime;
  const missing = used.filter((k) => typeof en[k] !== 'string' || !en[k].trim());
  assert.deepEqual(missing, []);
});

test('a finished tool call leaves the row: its detail clears and the clock restarts', () => {
  // Value: protects=the owner never judges an agent by a tool call that already ended; fails_when=PostToolUse keeps the previous actionDetail; why_new=review run 2 pass B (red team); seam=none
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /e\.event === 'PostToolUse' \|\| e\.event === 'PostToolUseFailure' \|\| e\.event === 'PostToolBatch' \|\| e\.event === 'UserPromptSubmit'[\s\S]{0,400}updateAgent\(e\.agentId, \{ status: 'working', actionDetail: undefined, actionAt: Date\.now\(\) \}\)/);
  assert.match(hive, /action: 'thinking', actionDetail: undefined, actionAt: Date\.now\(\)/);
  // Value: protects=a finished tool is not named as still running; fails_when=PostToolUse with nothing running keeps "using <tool>"; why_new=TODOS "Row still names a finished tool"; seam=source pin
  assert.match(hive, /else if \(toolEnded && !breakerArmed\) updateAgent\(e\.agentId, \{ action: 'thinking' \}\);/);
});

test('the non-English "terminal ended" hint names the buttons as they appear on screen', () => {
  // Value: protects=a Chinese or Arabic owner is pointed at labels that exist; fails_when=the hint translates the English-only button names; why_new=review run 2 pass B; seam=none
  for (const lang of ['zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`));
    assert.ok(d.closingTime.michaelEnded.includes(d.quit.cancelBack), lang);
    assert.ok(d.closingTime.michaelEnded.includes(d.quit.forceQuit), lang);
  }
});

test('a tool call\'s detail and clock stay in memory: no save, and never in the saved roster (run for real)', () => {
  // Generated by /ship coverage audit (pass 1).
  // Value: protects=a tool call writes nothing to disk and a file name in the
  //   detail never lands in the saved roster; fails_when=actionDetail/actionAt
  //   leave VOLATILE_AGENT_FIELDS or slimAgents; why_new=the store was only
  //   regex-checked; seam=none
  const { execFileSync } = require('node:child_process');
  const script = `
    const mem = { 'cth.agents': JSON.stringify([{ id: 'pam', name: 'Pam' }]) };
    let writes = 0;
    const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { if (k === 'cth.agents') writes++; mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    globalThis.localStorage = storage;
    const store = require(${JSON.stringify(path.join(__dirname, 'load-ts.cjs'))})('src/renderer/src/store/store.ts').useStore;
    store.getState().updateAgent('pam', { status: 'working', action: 'using Read', actionDetail: 'salaries-2026.xlsx', actionAt: 123 });
    const live = store.getState().agents.find((a) => a.id === 'pam');
    const afterTool = writes;
    store.getState().updateAgent('pam', { description: 'Sales' });
    const saved = JSON.parse(mem['cth.agents']).find((a) => a.id === 'pam');
    store.getState().addAgent({ id: 'dwight', name: 'Dwight', status: 'working', action: 'using Bash', actionDetail: 'Run the tests', actionAt: 456 }, { select: false });
    const added = JSON.parse(mem['cth.agents']).find((a) => a.id === 'dwight');
    process.stdout.write(JSON.stringify({ afterTool, live: [live.actionDetail, live.actionAt], writes, saved, added }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
  assert.equal(r.afterTool, 0, 'a tool call alone is not a reason to save');
  assert.deepEqual(r.live, ['salaries-2026.xlsx', 123], 'the rows still see it in memory');
  assert.equal(r.saved.description, 'Sales', 'a durable change is saved');
  assert.ok(!('actionDetail' in r.saved) && !('actionAt' in r.saved), JSON.stringify(r.saved));
  assert.ok(r.added && !('actionDetail' in r.added) && !('actionAt' in r.added), JSON.stringify(r.added));
});

test('quitting starts closing time on the floor, with no dialog (owner, 2026-09-30)', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.doesNotMatch(app, /QuitWarningModal/);
  assert.match(app, /window\.cth\.onCloseRequested\(\(\) => \{\n\s+if \(closingOpenRef\.current\) return;\n\s+closingOpenRef\.current = true;[^\n]*\n\s+setClosingOpen\(true\);\n\s+void startClosingTimeRef\.current\(/);
  // The bar takes the bottom bar's place; Cancel calls closing time off and tells main.
  assert.match(app, /\{closingOpen && \(\n\s+<ClosingTimeBar/);
  assert.match(app, /if \(closing\?\.phase !== 'error'\) cancelClosingTime\(\);\n\s+window\.cth\.cancelClose\(\);/);
  assert.match(app, /onForceQuit=\{\(\) => \{ void window\.cth\.confirmClose\(\); \}\}/);
  // Force quit loses unsaved work, so it asks once.
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /onClick=\{\(\) => setConfirmForce\(true\)\}>\{t\('quit\.forceQuit'\)\}/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['title', 'starting', 'left', 'leftPlural', 'hideWho', 'confirmForce', 'keepClosing', 'tryAgain']) assert.ok(d.closingBar[k], `${loc}: closingBar.${k}`);
  }
});

test('the list that takes focus from code shows the focus ring to the keyboard, inside its scrolling panel', () => {
  // Value: protects=a keyboard user sees where focus went after Remind or a refused Close without them; fails_when=the list hides its outline again (an inline outline beats the global :focus-visible ring) or the ring is drawn outside the scrolling panel that would clip it; why_new=no test above looks at focus styling; seam=none
  const list = read('src/renderer/src/components/ClosingTimeBar.tsx').match(/<div ref=\{listRef\}[^\n]*/)[0];
  assert.match(list, /className="cth-closing-list"/);
  assert.doesNotMatch(list, /outline/, 'an inline outline would hide the ring from the keyboard');
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-closing-list:focus-visible \{ outline-offset: -2px; \}/);
});

test('focus falls back to the list when the row or its confirm is gone (issue 135)', () => {
  // Value: protects=keyboard focus always lands somewhere after Remind or a refused Close without them, even when that row has left; fails_when=the refocus effect drops its listRef fallback, or the list stops being focusable; why_new=the fallback had no test; seam=the effect's own expression, run against stand-in elements (no DOM here)
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  const effect = bar.match(/\n\s*(\(\(refocus === 'keep' \? keepButton\.current : triggers\.current\[refocus\]\) \?\? listRef\.current\)\?\.focus\(\);)/);
  assert.ok(effect, 'the refocus effect');
  const refocusTo = new Function('refocus', 'keepButton', 'triggers', 'listRef', effect[1]);
  const el = () => ({ focused: 0, focus() { this.focused++; } });
  const run = (refocus, { trigger, keep }) => {
    const list = el();
    refocusTo(refocus, { current: keep ?? null }, { current: trigger === undefined ? {} : { pam: trigger } }, { current: list });
    return list;
  };
  const button = el();
  assert.equal(run('pam', { trigger: button }).focused, 0);
  assert.equal(button.focused, 1, "back on the row's Close without them");
  assert.equal(run('pam', { trigger: null }).focused, 1, 'the row left (its ref was cleared): the list');
  assert.equal(run('pam', {}).focused, 1, 'no ref for that row at all: the list');
  const keep = el();
  assert.equal(run('keep', { keep }).focused, 0);
  assert.equal(keep.focused, 1, "a refused Close without them: back on the confirm's Keep waiting");
  assert.equal(run('keep', { keep: null }).focused, 1, 'the confirm is gone by the time the refusal lands: the list');
  // The list can take focus from code, and a row's ref is cleared when it leaves.
  assert.match(bar, /<div ref=\{listRef\} className="cth-closing-list" tabIndex=\{-1\}/);
  assert.match(bar, /buttonRef=\{\(el\) => \{ triggers\.current\[id\] = el; \}\}/);
});


test('the still working count reads as a button that opens the list', () => {
  // Value: protects=the owner sees that the count opens who is still working, with Remind; fails_when=the pill or chevron is dropped back to plain text; why_new=owner, 2026-10-11: plain indigo text did not look clickable; seam=source pin
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /background: 'var\(--cth-indigo-soft\)', padding: '0 8px 0 10px', height: 24, borderRadius: 'var\(--cth-r-pill\)'/);
  assert.match(bar, /transform: open \? 'rotate\(180deg\)' : 'none'/, 'the chevron flips when the list is open');
  assert.match(bar, /aria-expanded=\{open\}/);
});

test('the who list has one scrollbar', () => {
  // Value: protects=a long who list scrolls in one place; fails_when=the panel around the list scrolls too and shows a second scrollbar; why_new=owner, 2026-10-11: two nested scrollers showed two scrollbars; seam=source pin
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.equal((bar.match(/overflowY: 'auto'/g) || []).length, 1, 'only the list scrolls');
  assert.match(bar.match(/<div ref=\{listRef\}[^\n]*/)[0], /maxHeight: 300, overflowY: 'auto'/);
});

test('the still working pill sits in a 28 px target, and the row never jumps', () => {
  // Value: protects=DESIGN.md 12's 28 px target and a steady bar height; fails_when=the pill becomes the button again or the row loses its min height; why_new=review 2026-10-12; seam=source pin
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /const hitBtn: CSSProperties = \{\n\s*flexShrink: 0, height: 28,/);
  assert.match(bar, /style=\{hitBtn\}>\n\s*<span style=\{linkBtn\}>/);
  assert.match(bar, /marginTop: 6, minHeight: 28 \}\}/);
});
