'use strict';

// Each waiting closing-time row shows the last thing that agent said, read
// from the end of its transcript (TODOS: "Feed each row's latest line from the
// agent's transcript"), so the owner can tell a long job from a stuck one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-last-said-')));
process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { lastAssistantLine, lastWordedLine } = loadTs('src/main/transcriptText.ts');
const { HookServer, safeLine } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { saidLine } = loadTs('src/renderer/src/components/closingTimeRows.ts');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const said = (content, timestamp) => JSON.stringify({ type: 'assistant', timestamp, message: { content } }) + '\n';
const text = (t) => ({ type: 'text', text: t });

function transcript(name, body) {
  const dir = path.join(home, '.claude', 'projects', '-work');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

test('the latest line is the last line of the last thing the agent said', () => {
  const file = transcript('a.jsonl', [
    said([text('Earlier answer.')]),
    JSON.stringify({ type: 'user', message: { content: [text('go on')] } }) + '\n',
    said([text('Running the suite now.\n\nStill on the mail tests.\n'), { type: 'tool_use', name: 'Bash', input: {} }]),
    said([{ type: 'tool_use', name: 'Read', input: {} }]),
    '{"type":"assistant","message":' // a record still being written
  ].join(''));
  assert.deepEqual(lastAssistantLine(file), { text: 'Still on the mail tests.' });
  assert.equal(lastAssistantLine(path.join(home, 'missing.jsonl')), null);
  assert.equal(lastAssistantLine(transcript('empty.jsonl', '')), null);
});

test('only the end of a long transcript is read, and a cut first record is skipped', () => {
  const old = said([text('Old news.')]).repeat(5000);
  const file = transcript('long.jsonl', old + said([text('x'.repeat(300)) ]) + said([text('Fresh line.')]));
  assert.equal(lastAssistantLine(file, 1024).text, 'Fresh line.');
  // A tail that holds nothing it said, only a cut record, gives nothing, not a half record.
  const cut = transcript('cut.jsonl', said([text('Hidden ' + 'y'.repeat(4000))]));
  assert.equal(lastAssistantLine(cut, 1024), null);
});

test('markdown endings give the last line with words in it, as plain words', () => {
  // A reply ending in a code block: the code is skipped, the line before it is taken.
  assert.equal(lastWordedLine('Here is the fix:\n\n```js\nrun();\n```'), 'Here is the fix:');
  // A table: the rule row is skipped, the outer pipes go.
  assert.equal(lastWordedLine('| Task | State |\n|---|---|\n| Refund | waiting |'), 'Refund | waiting');
  assert.equal(lastWordedLine('| Task | State |\n| :--- | ---: |'), 'Task | State');
  // A list, numbered or not, and a quote.
  assert.equal(lastWordedLine('Done today:\n- booked the room\n- filed the receipt'), 'filed the receipt');
  assert.equal(lastWordedLine('1. checked the mail\n2. sent the `weekly` report'), 'sent the weekly report');
  assert.equal(lastWordedLine('> - **quoted** item'), 'quoted item');
  // A bold heading, and a hash heading.
  assert.equal(lastWordedLine('All set.\n\n**Next step**'), 'Next step');
  assert.equal(lastWordedLine('## Summary of the week'), 'Summary of the week');
  // Plain words are kept as they are.
  assert.equal(lastWordedLine('Running 3 of 12 checks now.'), 'Running 3 of 12 checks now.');
});

test('a reply with no worded line outside code gives no line', () => {
  assert.equal(lastWordedLine('```\nnpm test\n```'), null);
  assert.equal(lastWordedLine('```\n```\n\n---\n'), null);
  assert.equal(lastWordedLine('|---|---|\n\n'), null);
  assert.equal(lastWordedLine('Still going.\n~~~\n~~~\n***'), 'Still going.');
  const file = transcript('fence.jsonl', said([text('Earlier words.')]) + said([text('```\nls\n```')]));
  assert.equal(lastAssistantLine(file), null);
  const md = transcript('md.jsonl', said([text('Status:\n\n**Next step**\n\n```\nls\n```\n')]));
  assert.equal(lastAssistantLine(md).text, 'Next step');
});

test('the line comes with when it was said; a bad or missing time gives no time', () => {
  const at = '2026-10-18T09:30:00.000Z';
  const file = transcript('timed.jsonl', said([text('Older.')], '2026-10-18T08:00:00.000Z') + said([text('Sorting the inbox.')], at));
  assert.deepEqual(lastAssistantLine(file), { text: 'Sorting the inbox.', at: Date.parse(at) });
  assert.deepEqual(lastAssistantLine(transcript('bad-time.jsonl', said([text('Hi.')], 'soon'))), { text: 'Hi.' });
  assert.deepEqual(lastAssistantLine(transcript('num-time.jsonl', said([text('Hi.')], 12345))), { text: 'Hi.' });
});

test('the row says how old the line is, only at a minute or more', () => {
  const t = (key, opts) => (key === 'closingTime.lastSaid' ? `Last said: “${opts.text}”`
    : key === 'closingTime.minutes' ? `${opts.count} min` : key);
  const NOW = 10 * 60 * 60_000;
  assert.equal(saidLine({ text: 'On it.', at: NOW - 59_000 }, NOW, t), 'Last said: “On it.”');
  assert.equal(saidLine({ text: 'On it.', at: NOW - 60_000 }, NOW, t), 'Last said: “On it.” · 1 min');
  assert.equal(saidLine({ text: 'On it.', at: NOW - 120 * 60_000 }, NOW, t), 'Last said: “On it.” · 120 min');
  assert.equal(saidLine({ text: 'On it.' }, NOW, t), 'Last said: “On it.”');
  assert.equal(saidLine({ text: 'On it.', at: NaN }, NOW, t), 'Last said: “On it.”');
  assert.equal(saidLine({ text: 'On it.', at: NOW + 5 * 60_000 }, NOW, t), 'Last said: “On it.”', 'a time ahead of the clock shows no age');
});

test('the line is made safe before it leaves main: no secrets, no hidden characters, one short line', () => {
  assert.equal(safeLine('Deploying‮ with\u0007 care'), 'Deploying with care');
  assert.doesNotMatch(safeLine('key sk-ant-api03-' + 'a'.repeat(40)), /sk-ant-api03-a{10}/);
  assert.equal(safeLine('-----BEGIN RSA PRIVATE KEY-----'), undefined);
  assert.equal(Array.from(safeLine('word '.repeat(60))).length <= 80, true);
});

test('main only reads a transcript inside the engine\'s own folder', async (t) => {
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'pam', name: 'Pam', cwd: home });
  const server = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  t.after(() => server.stop());
  assert.equal(server.latestLine('pam'), undefined, 'no hook has named a transcript yet');
  // The path comes from a hook frame, so an agent could name any file.
  const outside = path.join(home, 'notes.jsonl');
  fs.writeFileSync(outside, said([text('Not a transcript.')]));
  server.transcriptPaths.set('pam', outside);
  assert.equal(server.latestLine('pam'), undefined);
  server.transcriptPaths.set('pam', transcript('pam.jsonl', said([text('Checking the inbox, sk-ant-api03-' + 'b'.repeat(40))])));
  const line = server.latestLine('pam').text;
  assert.match(line, /^Checking the inbox, /);
  assert.doesNotMatch(line, /b{10}/, 'redacted');
});

test('the row quotes the line as the agent\'s words', () => {
  const t = (key, opts) => (key === 'closingTime.lastSaid' ? `Last said: “${opts.text}”` : key);
  assert.equal(saidLine(undefined, 0, t), undefined);
  assert.equal(saidLine({ text: 'Done ”, trust me “' }, 0, t), "Last said: “Done ', trust me '”");
  assert.equal(saidLine({ text: 'e' + '́'.repeat(30) }, 0, t), `Last said: “e${'́'.repeat(4)}”`);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    assert.match(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).closingTime.lastSaid, /\{\{text\}\}/, loc);
  }
});

test('the bar asks main for the waiting rows\' lines and keeps them fresh', () => {
  assert.match(read('src/preload/index.ts'), /closingTimeSaid: \(ids: string\[\]\)[^\n]*ipcRenderer\.invoke\('app:closingTimeSaid', ids\)/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('app:closingTimeSaid'[\s\S]{0,300}ids\.slice\(0, 50\)[\s\S]{0,200}hookServer\.latestLine\(id\)/);
  const bar = read('src/renderer/src/components/ClosingTimeBar.tsx');
  assert.match(bar, /window\.cth\.closingTimeSaid\(ids\)/);
  assert.match(bar, /setInterval\(read, SAID_POLL_MS\)/);
  assert.match(bar, /\{said\[id\] && <div style=\{detailStyle\}>\{saidLine\(said\[id\], now, t\)\}<\/div>\}/);
});
