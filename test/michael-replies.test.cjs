'use strict';

/**
 * Michael answers the owner where they asked (docs/designs/michael-replies.md):
 * owner questions travel through the hive like Ask me answers, handed to
 * Michael as work orders; his replies show in the dock above the composer.
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
const { HiveManager } = loadTs('src/main/hive.ts');
const R = loadTs('src/shared/ownerRequests.ts');
const A = loadTs('src/shared/askMeRouting.ts');
const { privateOwnerSentDir, privateOwnerStatePath } = loadTs('src/shared/agentPrivatePaths.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

async function office(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-michael-replies-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const emitted = [];
  const hive = new HiveManager(() => home, (channel, payload) => { emitted.push([channel, payload]); return true; });
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.commit = () => {};
  const godDir = path.join(home, 'hive', 'agents', 'god');
  return { hive, home, emitted, godDir };
}

/** Michael answers as he really does: a file in his outbox with no id, routed
 *  by the hive. Returns the id the app gave it, as his sent copy records it. */
let seq = 0;
function michaelSays(hive, godDir, m) {
  const name = `t-${++seq}.json`;
  fs.writeFileSync(path.join(godDir, 'outbox', name), JSON.stringify({ created_at: new Date().toISOString(), ...m }));
  hive.routeOnce();
  return JSON.parse(fs.readFileSync(path.join(godDir, 'outbox', '.sent', name), 'utf8')).id;
}

const msg = (o) => ({ id: o.id, from: o.from ?? 'god', to: o.to ?? 'human', act: o.act ?? 'done', conversation: o.conversation, in_reply_to: o.in_reply_to ?? null, created_at: o.at ?? '2026-10-06T10:00:00.000Z', body: o.body ?? 'x', ...o.extra });

test('a question moves through its states from real events, and only done or refuse closes it', () => {
  // Value: protects=each status the owner reads comes from a real event; fails_when=a holding reply, a question back or notes close the question, or late never shows; why_new=new (6A, 11A, outside voice 1); seam=none
  const q = msg({ id: 'q1', from: 'human', to: 'god', act: 'request', conversation: 'owner:q1', at: '2026-10-06T09:00:00.000Z', body: 'What happened to the weekly summary?' });
  const now = Date.parse('2026-10-06T09:30:00.000Z');
  const state = (f) => ({ requests: { q1: f } });
  const status = (fromMichael, f = { deliveredAt: Date.parse('2026-10-06T09:01:00.000Z') }, at = now) =>
    R.ownerDock([q], fromMichael, state(f), at).items.find((i) => i.kind === 'owner').status;
  assert.equal(status([], {}), 'sent');
  assert.equal(status([]), 'has-it');
  const holding = msg({ id: 'r1', act: 'inform', in_reply_to: 'q1', at: '2026-10-06T09:05:00.000Z', extra: { expect_by: '2026-10-06T09:25:00.000Z', waiting_on: 'Oscar' } });
  assert.equal(status([holding], undefined, Date.parse('2026-10-06T09:20:00.000Z')), 'waiting');
  assert.equal(status([holding]), 'late', 'past the time he gave');
  assert.equal(status([], undefined, Date.parse('2026-10-06T11:02:00.000Z')), 'late', 'two hours with no time given');
  assert.equal(status([holding, msg({ id: 'r2', act: 'query', in_reply_to: 'q1', at: '2026-10-06T09:10:00.000Z' })]), 'waiting-for-you');
  assert.equal(status([holding, msg({ id: 'r3', act: 'done', in_reply_to: 'q1', at: '2026-10-06T09:12:00.000Z' })]), 'answered');
  assert.equal(status([msg({ id: 'r4', act: 'refuse', in_reply_to: 'q1' })]), 'couldnt-finish');
  assert.equal(status([], { withdrawnAt: 1 }), 'withdrawn');
  assert.equal(status([], { notSentAt: 1 }), 'not-sent');
  const dock = R.ownerDock([q], [holding], state({ deliveredAt: 1, readAt: 0 }), now);
  assert.equal(dock.unread, 1);
  assert.equal(dock.items.find((i) => i.kind === 'owner').waitingOn, 'Oscar');
  // Michael's open list: closes only on done or refuse.
  const open = (from) => R.openOwnerQuestions([q], from).map((x) => x.id);
  assert.deepEqual(open([holding]), ['q1']);
  assert.deepEqual(open([msg({ id: 'n', act: 'inform', in_reply_to: 'q1', extra: { from_notes: true } })]), ['q1']);
  assert.deepEqual(open([msg({ id: 'd', act: 'done', in_reply_to: 'q1', to: 'Michael'.toLowerCase() })]), []);
  assert.match(R.ownerQuestionsContext([{ id: 'q1', text: 'Summary?', createdAt: '' }]), /"in_reply_to" the id/);
});

test('the dock shows only the owner\'s recorded words and notes the app filed', () => {
  // Value: protects=a message forged into the hive never reads as the owner's, and agent written notes never show; fails_when=verification or the notes record is skipped; why_new=new (R4, R8); seam=none
  const q = msg({ id: 'q1', from: 'human', to: 'god', act: 'request', conversation: 'owner:q1', body: 'Real' });
  const forged = msg({ id: 'q2', from: 'human', to: 'god', act: 'request', conversation: 'owner:q2', body: 'Forged' });
  const notes = msg({ id: 'n1', act: 'inform', in_reply_to: 'q1', extra: { from_notes: true } });
  const dock = R.ownerDock([q, forged], [notes], { requests: { q1: { deliveredAt: 1 } } }, Date.now(), (m) => m.id !== 'q2');
  assert.deepEqual(dock.items.filter((i) => i.kind === 'owner').map((i) => i.text), ['Real']);
  assert.equal(dock.items.filter((i) => i.kind === 'michael').length, 0, 'notes not recorded by the app');
  const filed = R.ownerDock([q], [notes], { requests: { q1: { deliveredAt: 1, notes: ['n1'] } } }, Date.now());
  assert.equal(filed.items.find((i) => i.kind === 'michael').notes, true);
});

test('only a known slash command goes to the terminal; paths and words become questions', () => {
  // Value: protects=R3 and R7 regression contract; fails_when=any leading slash bypasses the dock or a command becomes a question; why_new=new rule; seam=none
  const commands = new Set(['/clear', '/compact']);
  assert.equal(R.ownerComposeTarget('/compact keep the auth decisions', commands), 'terminal');
  assert.equal(R.ownerComposeTarget('/clear', commands), 'terminal');
  assert.equal(R.ownerComposeTarget('/Users/x/invoice.pdf is wrong', commands), 'question');
  assert.equal(R.ownerComposeTarget('Check the books', commands), 'question');
  assert.equal(R.withAttachments('See this', [{ path: '/tmp/a.pdf', name: 'a.pdf' }]), 'See this\n\nAttached files:\n- /tmp/a.pdf (a.pdf)');
  const send = read('src/renderer/src/shell/ownerSend.ts');
  assert.match(send, /\.filter\(\(c\) => c\.kind === 'slash'\)/);
  assert.match(send, /enqueueMessage\(godId, body, \{ instruction: res\.workOrder, ownerRequestId: res\.id \}\)/);
  assert.match(read('src/renderer/src/components/MessageQueueComposer.tsx'), /if \(agent\.isGod\) \{\s*if \(godSending\) return;[\s\S]{0,120}void sendToMichael\(agent\.id, text, attachments\)/);
  // Claimed in main before it is typed (Codex P1), never after.
  assert.match(read('src/renderer/src/hooks/useHive.ts'), /if \(next\.ownerRequestId\) \{\n        const claim = await window\.cth\.ownerDelivered\(next\.ownerRequestId\)/);
  // Claimed before typing, a question that can't be typed stays Michael's through his every-turn list.
  assert.doesNotMatch(read('src/renderer/src/hooks/useHive.ts'), /ownerNotSent\(next\.ownerRequestId\)/);
});

test('ask, hand over, reply: the hive files each side and the router keeps replies honest', async (t) => {
  // Value: protects=the owner question reaches Michael's open list only when typed, replies land in the dock, unmatched replies bounce once, closing time is untouched; fails_when=filing, closure or the R2 note regress; why_new=new hive paths; seam=none
  const { hive, home, godDir, emitted } = await office(t);
  const q = hive.ownerAsk({ text: 'What happened to the weekly financial summary?' });
  assert.equal(q.from, 'human');
  assert.equal(q.conversation, `owner:${q.id}`);
  assert.ok(fs.existsSync(path.join(privateOwnerSentDir(home), `${q.id}.json`)), 'the owner\'s sent mail under private/owner (#63)');
  assert.equal(hive.ownerQuestions().length, 0, 'not in his list before it is typed');
  assert.equal(hive.ownerWithdraw(q.id), true);
  const q2 = hive.ownerAsk({ text: 'Chase the Northwind invoice' });
  assert.equal(hive.ownerDelivered(q2.id), true);
  assert.ok(fs.existsSync(path.join(godDir, 'inbox', '.done', `${q2.id}.json`)));
  assert.equal(hive.ownerWithdraw(q2.id), false, 'cancel is refused once he has it');
  assert.deepEqual(hive.ownerQuestions().map((x) => x.id), [q2.id]);
  assert.ok(emitted.some(([c, p]) => c === 'hive:message' && p.id === q2.id), 'the floor sees the owner talk to Michael');

  // A reply with no question named: one system note, nothing shown.
  michaelSays(hive, godDir, { to: 'human', act: 'done', subject: 'Done', body: 'Chased.' });
  const inboxFiles = () => fs.readdirSync(path.join(godDir, 'inbox')).filter((f) => f.endsWith('.json'));
  const notes = inboxFiles().map((f) => JSON.parse(fs.readFileSync(path.join(godDir, 'inbox', f), 'utf8')));
  assert.ok(notes.some((m) => m.from === 'system' && /names no question/.test(m.body) && m.body.includes(q2.id)));
  // Closing time is untouched.
  const before = inboxFiles().length;
  michaelSays(hive, godDir, { to: 'human', act: 'done', subject: 'CLOSING-TIME-COMPLETE', body: '' });
  assert.equal(inboxFiles().length, before);

  // A holding reply keeps it open; done closes it and shows in the dock.
  const replies = [];
  hive.onOwnerReply((m) => replies.push(m.act));
  michaelSays(hive, godDir, { to: 'human', act: 'inform', in_reply_to: q2.id, subject: 'On it', body: 'Kelly is on it.', expect_by: '2099-01-01T00:00:00.000Z', waiting_on: 'Kelly' });
  hive.refreshOwnerRequests();
  assert.deepEqual(hive.ownerQuestions().map((x) => x.id), [q2.id]);
  michaelSays(hive, godDir, { to: 'human', act: 'done', in_reply_to: q2.id, subject: 'Chased', body: 'Northwind will pay Friday.' });
  hive.refreshOwnerRequests();
  assert.deepEqual(hive.ownerQuestions(), []);
  assert.deepEqual(replies, ['inform', 'done']);
  const view = hive.ownerConversationView();
  const item = view.items.find((i) => i.kind === 'owner' && i.id === q2.id);
  assert.equal(item.status, 'answered');
  assert.ok(view.items.some((i) => i.kind === 'michael' && i.text === 'Northwind will pay Friday.'));
  assert.equal(view.items.find((i) => i.id === q.id).status, 'withdrawn');
  assert.equal(hive.ownerNotify(q2.id, 'x'), true);
  assert.equal(hive.ownerNotify(q2.id, 'x'), false, 'never twice');
});

test('notes are filed once, and a turn that sent anything files none', async (t) => {
  // Value: protects=R8 trigger and the once rule; fails_when=notes repeat or fire after a delegation; why_new=new (R8); seam=none
  const { hive, godDir } = await office(t);
  const q = hive.ownerAsk({ text: 'Did the Hartley order ship?' });
  hive.ownerDelivered(q.id);
  const at = Date.now() - 1000;
  assert.equal(hive.godSentSince('god', at), false);
  assert.equal(hive.fileOwnerNotes(q.id, 'Checked the sheet, asking Ryan.'), true);
  assert.equal(hive.fileOwnerNotes(q.id, 'Again'), false);
  assert.equal(hive.godSentSince('god', at), false, 'filed notes are not a send');
  fs.writeFileSync(path.join(godDir, 'outbox', 'x.json'), JSON.stringify({ to: 'ryan', act: 'request', subject: 's', body: 'b' }));
  assert.equal(hive.godSentSince('god', at), true, 'a delegation counts');
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /if \(!latest \|\| this\.hive\.godSentSince\(agentId, latest\.at\)\) return;/);
});

test('a bad state file never repeats a notification', async (t) => {
  // Value: protects=R5 fallback; fails_when=an unreadable state.json marks replies unnotified or unread; why_new=new store; seam=none
  const { hive, home, godDir } = await office(t);
  const q = hive.ownerAsk({ text: 'Q' });
  hive.ownerDelivered(q.id);
  const r = { id: michaelSays(hive, godDir, { to: 'human', act: 'done', in_reply_to: q.id, subject: 'A', body: 'A.' }) };
  const statePath = privateOwnerStatePath(home);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{ not json');
  assert.equal(hive.ownerNotify(q.id, r.id), false);
  assert.equal(hive.ownerConversationView().unread, 0);
});

test('message fields survive normalize, and reports are not questions', async (t) => {
  // Value: protects=expect_by, waiting_on and from_notes reach the reader; reports never turn the pill coral; fails_when=normalize drops them or reports count as asks; why_new=new fields and kind; seam=none
  const { hive } = await office(t);
  const m = hive.send({ to: 'ryan', act: 'inform', subject: 's', body: 'b', expect_by: 'not a date', waiting_on: '  Oscar  ' }, 'god');
  assert.equal(m.expect_by, undefined);
  assert.equal(m.waiting_on, 'Oscar');
  const qa = [{ q: 'Report', kind: 'report' }, { q: 'Question?' }];
  assert.deepEqual(A.openAskIndexes(qa), [1]);
  assert.deepEqual(A.openReportIndexes(qa), [0]);
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /reports: merged\.tasks\.reduce\(\(n, t\) => n \+ openReportIndexes\(t\.humanQA\)\.length, 0\)/);
  assert.match(read('src/renderer/src/components/AskMeTab.tsx'), /window\.cth\.ackReport\(t\.id, row\.index\)/);
});

test('Michael is told how to answer in the conversation and where reports go', () => {
  // Value: protects=T7 instructions that ship with delivery; fails_when=the prompt still limits "human" to closing time or loses the report rule; why_new=prompt change; seam=none
  const hive = read('src/main/hive.ts');
  assert.match(hive, /or "human" for the owner: answers in their conversation, and closing time\), "act" \(request, inform, query, done or refuse;/);
  assert.match(hive, /The owner reads your answer only in that conversation, never in your terminal, so always answer with a message "to": "human" and "in_reply_to" the question\\'s id\./);
  assert.match(hive, /withdraw that ask \("dismissedAt" and "dismissedReason": "Answered in your conversation with the owner"\), never write an answer into it/);
  assert.match(hive, /put it on Ask me as a report: a card with "status": "done"/);
  assert.match(read('src/shared/michaelWorkStyle.ts'), /You answer every question the owner asks you in their conversation, in that conversation/);
  // Value (extension): protects=the reply readability rules ship in the prompts (owner D5, D6, D8, D11, 2026-10-17); fails_when=a rule is dropped or reworded away; why_new=new prompt text; seam=none; no_claim=that agents follow it (no eval, TODOS.md)
  assert.match(hive, /When an answer runs longer than a couple of sentences, keep the answer itself in the first sentence, then lay out the rest in the shape that reads best in a narrow panel: a short list with one item or figure per line, a small table of 2 or 3 columns when you compare several things on the same points/);
  assert.match(hive, /Copy each figure a team member gave you exactly, with its currency; never recompute, convert or round one unless the owner asks/);
  assert.match(hive, /Rewrite a report from the team into this shape\./);
  assert.match(hive, /put longer detail in a file rather than the answer; never paste a report\./);
  assert.match(hive, /When your report carries figures, several items or a comparison, end it with that part laid out: each figure on its own line as Label: amount, with the currency and the period it covers, copied exactly from your source/);
  assert.match(read('src/shared/ownerRequests.ts'), /Lay out a longer answer as your rules say: the answer first, then a list or small table where it helps\./);
  for (const rule of [/When an answer runs longer[^']*/, /When your report carries figures[^`]*/]) {
    assert.doesNotMatch(hive.match(rule)[0], /[–—]| - /, 'no dashes in what agents are told to write');
  }
});

test('the dock and its count follow the design', () => {
  // Value: protects=decisions 2A, 12A, 16A, 20A, 21A in the UI; fails_when=the count goes coral for answers, the dock opens by itself, or notifications lose their click; why_new=new UI; seam=source pins
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /role="region"/);
  assert.match(dock, /aria-live="polite"/);
  assert.match(dock, /const action = dockEscAction\(\{ wide, inDock: true, composing: isComposingKey\(e\) \}\);/, 'Esc follows the wide 1:1 rule (wide-dock.test.cjs)');
  assert.match(dock, /if \(draft\.trim\(\)\) return;/, 'a floor click never closes it over a draft');
  const bar = read('src/renderer/src/shell/BottomBar.tsx');
  assert.match(bar, /background: waiting \? 'var\(--cth-coral-strong\)' : 'var\(--cth-indigo\)'/);
  assert.doesNotMatch(bar, /shell\.queued/, 'the queue chip is gone (2A)');
  assert.match(bar, /\{dock\.items\.length > 0 && \(\n\s*<button onClick=\{\(\) => \(dockOpen \? setDock\(false\) : openAt\(\)\)\} aria-expanded=\{dockOpen\}/,
    'with every reply read (after a restart, say) the conversation still opens from its own button');
  // Value (extension): protects=the conversation button reads as open and close, not a new chat; fails_when=it goes back to a chat bubble or stops flipping with the dock; why_new=owner report 2026-10-17; seam=source pin (no layout harness)
  assert.match(bar, /<path d=\{dockOpen \? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'\} \/>/);
  // Value (extension): protects=the message box keeps its width when the conversation button joins its row; fails_when=the button squeezes the placeholder onto two lines; why_new=review D10; seam=source pin (no layout harness)
  assert.match(bar, /const slot = \{ flex: `0 1 \$\{dock\.items\.length > 0 \? 464 : 420\}px`, minWidth: dock\.items\.length > 0 \? 344 : 300 \};/);
  assert.match(bar, /\.\.\.slot, minHeight: 50, display: 'flex'/, 'the narrow box keeps its width');
  const main = read('src/main/index.ts');
  assert.match(main, /n\.on\('click', \(\) => \{/);
  assert.match(main, /if \(inFront \|\| !hive\.ownerNotify\(msg\.in_reply_to, msg\.id\)\) return;/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const l = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`));
    for (const k of ['label', 'open', 'empty', 'example1', 'example2', 'nudge', 'askAgain', 'notes', 'countNew', 'countWaiting']) assert.ok(l.dock[k], `${loc} dock.${k}`);
    for (const k of ['sent', 'finishing', 'has-it', 'waitingOn', 'late', 'waiting-for-you', 'answered', 'couldnt-finish', 'withdrawn', 'not-sent']) assert.ok(l.dock.status[k], `${loc} dock.status.${k}`);
    assert.ok(l.askMe.report && l.askMe.gotIt && l.shell.reports, loc);
  }
});

test('Not sent, Try again, Nudge, the late reminder and read: each changes only what it should', async (t) => {
  // Value: protects=the owner's controls on a question (7A, 6A, 2A); fails_when=Nudge reminds Michael more than hourly, the late sweep repeats, a withdrawn or undelivered question is reminded, Try again sticks at Not sent, or reading leaves replies unread; why_new=ownerRemind, ownerRetry and ownerRead had no test; seam=none
  const { hive, godDir } = await office(t);
  const inboxSubjects = () => fs.readdirSync(path.join(godDir, 'inbox')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(godDir, 'inbox', f), 'utf8'))).filter((m) => m.from === 'system').map((m) => m.subject);
  const status = (id) => hive.ownerConversationView().items.find((i) => i.kind === 'owner' && i.id === id).status;

  const q = hive.ownerAsk({ text: 'Did the Hartley order ship?' });
  assert.equal(hive.ownerRemind(q.id, 'nudge'), false, 'not before he has it');
  hive.ownerNotSent(q.id);
  assert.equal(status(q.id), 'not-sent');
  assert.equal(hive.ownerRetry(q.id), true);
  assert.equal(hive.ownerRetry(q.id), false, 'once');
  assert.equal(status(q.id), 'sent');
  hive.ownerDelivered(q.id);
  hive.ownerNotSent(q.id);
  assert.equal(status(q.id), 'has-it', 'a late Not sent never undoes delivery');

  const now = Date.now();
  assert.equal(hive.ownerRemind(q.id, 'nudge', now), true);
  assert.equal(hive.ownerRemind(q.id, 'nudge', now + 59 * 60_000), false, 'at most once an hour');
  assert.equal(hive.ownerRemind(q.id, 'nudge', now + 61 * 60_000), true);
  assert.equal(hive.ownerRemind(q.id, 'late', now), true);
  assert.equal(hive.ownerRemind(q.id, 'late', now + 10 * 3_600_000), false, 'the late reminder goes once');
  assert.deepEqual(inboxSubjects().sort(), ['An owner question is later than you said', 'The owner nudged you about a question', 'The owner nudged you about a question'].sort());

  const w = hive.ownerAsk({ text: 'Never mind this one' });
  hive.ownerWithdraw(w.id);
  assert.equal(hive.ownerRemind(w.id, 'nudge', now), false, 'a withdrawn question is never reminded');

  // A closed question is no longer remindable: it left his open list.
  michaelSays(hive, godDir, { to: 'human', act: 'done', in_reply_to: q.id, subject: 'Shipped', body: 'It shipped Tuesday.', created_at: new Date(now + 1000).toISOString() });
  hive.refreshOwnerRequests();
  assert.equal(hive.ownerRemind(q.id, 'nudge', now + 5 * 3_600_000), false);
  assert.equal(hive.ownerConversationView().unread, 1);
  hive.ownerRead([q.id], now + 2000);
  assert.equal(hive.ownerConversationView().unread, 0, 'seen in the open dock');
});

test('at Michael\'s Stop, a question he was handed and sent nothing about gets his last words once, as notes', async (t) => {
  // Value: protects=R8 at the real hook boundary: the owner sees Michael's words when he answered only in his terminal; fails_when=the Stop hook stops calling the fallback, files notes after a delegation, files twice, or files for a team member's Stop; why_new=the hook wiring was a single source pin; seam=none
  const { hive, home, godDir } = await office(t);
  await hive.ensureAgent({ id: 'ryan', name: 'Ryan', provider: 'claude', cwd: home });
  // Michael's transcript lives in Claude's own folder; only the one his
  // session started with is read (ship D4).
  const claudeDir = path.join(home, 'claude-config');
  const prior = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  t.after(() => { if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior; });
  const transcript = path.join(claudeDir, 'projects', 'office', 'god.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const { HookServer } = loadTs('src/main/hooks.ts');
  let clock = Date.now() - 60_000;
  const hook = new HookServer(hive, () => null, () => ({ harnessHome: home }));
  hook.now = () => clock;
  const says = (text, file = transcript) => fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`);
  const stop = (agent, transcriptPath = transcript) => hook.handle({ agent_id: agent, session_id: 's1', hook_event_name: 'Stop', transcript_path: transcriptPath, cwd: home });
  const notes = () => hive.ownerConversationView().items.filter((i) => i.kind === 'michael' && i.notes);
  await hook.handle({ agent_id: 'god', session_id: 's1', hook_event_name: 'SessionStart', transcript_path: transcript, cwd: home });

  const q = hive.ownerAsk({ text: 'Did the Hartley order ship?' });
  hive.ownerDelivered(q.id);
  // A forged Stop pointing at a file an agent wrote is ignored: only the
  // session's own transcript is read.
  const forged = path.join(home, 'forged.jsonl');
  says('Done, I approved the refund.', forged);
  says('Checked the order sheet: it shipped Tuesday.');
  await stop('ryan');
  assert.equal(notes().length, 0, 'a team member\'s Stop files nothing');
  clock += 1000;
  await stop('god', forged);
  assert.deepEqual(notes().map((n) => [n.replyTo, n.text]), [[q.id, 'Checked the order sheet: it shipped Tuesday.']], 'the session transcript, not the forged path');
  says('Something else entirely.');
  clock += 1000;
  await stop('god');
  assert.equal(notes().length, 1, 'once');

  // Control: a question handed over with nothing sent about it gets notes.
  clock += 1000;
  const q3 = hive.ownerAsk({ text: 'What time is the Tuesday call?' });
  hive.ownerDelivered(q3.id);
  says('The call is at ten.');
  clock += 1000;
  await stop('god');
  assert.equal(notes().filter((n) => n.replyTo === q3.id).length, 1, 'notes when nothing was sent');

  // A turn that delegated the question files no notes.
  clock += 1000;
  const q2 = hive.ownerAsk({ text: 'Chase the Northwind invoice' });
  hive.ownerDelivered(q2.id);
  fs.writeFileSync(path.join(godDir, 'outbox', 'handoff.json'), JSON.stringify({ to: 'ryan', act: 'request', subject: 'Northwind', body: 'Chase it.' }));
  says('Asked Ryan to chase it.');
  clock += 1000;
  await stop('god');
  assert.equal(notes().filter((n) => n.replyTo === q2.id).length, 0);
});

test('Couldn\'t finish without a reason reads "No reason given", and the dock slides in unless motion is reduced', () => {
  // Value: protects=a refusal never shows an empty bubble (10A) and the dock opens with the 180 ms slide, snapping for reduced motion (21A); fails_when=the fallback or the motion rule is removed; why_new=neither was built or pinned; seam=none
  const dock = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/shell/MichaelDock.tsx'), 'utf8');
  assert.match(dock, /const text = r\.act === 'refuse' && !r\.text\.trim\(\) \? t\('dock\.noReason'\) : r\.text;/);
  assert.match(dock, /<FileText source=\{boldFirst\(text\)\} who=\{\{ raisedBy: 'god' \}\} \/>/, 'files named in it are chips (open-file-tab.md)');
  assert.match(dock, /className=\{wide \? 'cth-dock-wide' : 'cth-dock'\}/, 'the slide is the narrow dock\'s; wide moves with the sheet');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/design/global.css'), 'utf8');
  assert.match(css, /\.cth-dock \{ animation: cth-dock-in 180ms ease-out; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.cth-dock \{ animation: none; \}\n\}/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', `src/renderer/src/i18n/locales/${loc}.json`), 'utf8')).dock;
    assert.equal(typeof d.noReason, 'string', loc);
    assert.doesNotMatch(d.noReason, /[–—]| - /, `${loc} noReason has no dash`);
  }
});

test('More opens only the reply it sits under, even when replies share an id', () => {
  // Value: protects=More opens one reply and the list stays where the owner clicked; fails_when=replies keyed by message id (an agent may reuse one) so one More opens every reply with that id and the view jumps to older ones; why_new=owner report 2026-10-17, seen in the dev app; seam=pure key helper plus source pins (no layout harness)
  const { dockKeys } = loadTs('src/renderer/src/shell/dockKeys.ts');
  const keys = dockKeys([
    { kind: 'owner', id: 'q1' }, { kind: 'michael', id: 'r' }, { kind: 'owner', id: 'q2' },
    { kind: 'michael', id: 'r' }, { kind: 'michael', id: 'r' }, { kind: 'owner', id: 'r' }
  ]);
  assert.deepEqual(keys, ['owner:q1', 'michael:r', 'owner:q2', 'michael:r#1', 'michael:r#2', 'owner:r']);
  assert.equal(new Set(keys).size, keys.length, 'every item has its own key');
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /const keys = dockKeys\(dock\.items\);/, 'keyed over the whole conversation, not only what shows');
  assert.match(dock, /<ReplyBubble key=\{key\}[^\n]*\n\s*expanded=\{!!expanded\[key\]\} onMore=\{\(\) => \{ scroll\.pauseForExpansion\(\); setExpanded\(\(e\) => \(\{ \.\.\.e, \[key\]: true \}\)\); \}\}/);
  assert.match(dock, /const rowOf = \(it: DockItem\) => \(\{ key: keyOf\.get\(it\)/, 'the scroll hook tracks rows by the same keys');
  assert.doesNotMatch(dock, /expanded\[it\.id\]|key=\{it\.id\}/, 'never keyed by the raw message id');
  // More keeps the spot clicked in view: it stops following the latest, and
  // the list then holds the passage being read (useDockScroll.ts).
  const hook = read('src/renderer/src/shell/useDockScroll.ts');
  assert.match(hook, /pauseForExpansion: \(\) => \{\n\s*following\.current = false;/);
  // scrollIntoView scrolls clipped ancestors too and hid the wide sheet's header.
  assert.doesNotMatch(dock, /scrollIntoView/);
  assert.doesNotMatch(hook, /scrollIntoView/);
});

test('the app makes every message id, and the sent copy records it', async (t) => {
  // Value: protects=each reply in the conversation has its own id that the owner can answer, and no message overwrites another; fails_when=agents write no id (as told) so every reply reads "", the owner's answer to a question back never counts, or a reused id loses mail; why_new=owner report 2026-10-17 (one More opened every reply); seam=none
  const { hive, home, godDir } = await office(t);
  await hive.ensureAgent({ id: 'kelly', name: 'Kelly', provider: 'claude', cwd: home });
  const q = hive.ownerAsk({ text: 'How much did we make this year?' });
  hive.ownerDelivered(q.id);
  // Written as the protocol says: no id, sender or time.
  const write = (name, m) => { fs.writeFileSync(path.join(godDir, 'outbox', name), JSON.stringify(m)); hive.routeOnce(); };
  write('a.json', { to: 'human', act: 'inform', in_reply_to: q.id, subject: 'On it', body: 'Asking Oscar.' });
  write('b.json', { to: 'human', act: 'query', in_reply_to: q.id, subject: 'Which year?', body: 'This year or last?' });
  // A reply still in his outbox is not shown: its id is not final until routed (D14).
  fs.writeFileSync(path.join(godDir, 'outbox', 'late.json'), JSON.stringify({ to: 'human', act: 'inform', in_reply_to: q.id, subject: 'Late', body: 'Not routed yet.' }));
  assert.ok(!hive.ownerConversationView().items.some((i) => i.kind === 'michael' && i.text === 'Not routed yet.'), 'unrouted reply hidden');
  fs.rmSync(path.join(godDir, 'outbox', 'late.json'));
  const replies = hive.ownerConversationView().items.filter((i) => i.kind === 'michael');
  assert.equal(replies.length, 2);
  assert.ok(replies.every((r) => r.id), 'no reply reads as ""');
  assert.notEqual(replies[0].id, replies[1].id);
  const sent = JSON.parse(fs.readFileSync(path.join(godDir, 'outbox', '.sent', 'b.json'), 'utf8'));
  assert.equal(sent.id, replies[1].id, 'his sent copy carries the id the app gave it');
  assert.equal(sent.from, 'god');
  assert.equal(sent.body, 'This year or last?', 'his words are kept');
  const status = () => hive.ownerConversationView().items.find((i) => i.kind === 'owner' && i.id === q.id).status;
  assert.equal(status(), 'waiting-for-you');
  hive.ownerAsk({ text: 'This year.', inReplyTo: replies[1].id, conversation: q.conversation });
  assert.notEqual(status(), 'waiting-for-you', 'the owner\'s answer to his question back counts');

  // A sent copy archived before the app stamped ids still gets one of its own.
  const q2 = hive.ownerAsk({ text: 'Did Kelly chase Northwind?' });
  hive.ownerDelivered(q2.id);
  for (const n of ['old-1', 'old-2']) {
    fs.writeFileSync(path.join(godDir, 'outbox', '.sent', `${n}.json`), JSON.stringify({ to: 'human', act: 'inform', in_reply_to: q2.id, subject: n, body: n }));
  }
  const old = hive.ownerConversationView().items.filter((i) => i.kind === 'michael' && i.replyTo === q2.id).map((i) => i.id);
  assert.deepEqual(old.sort(), ['sent-old-1', 'sent-old-2']);

  // An id an agent writes is not kept: two messages with one id both arrive.
  write('c.json', { id: 'same-1', to: 'kelly', act: 'inform', subject: 'First', body: 'one' });
  write('d.json', { id: 'same-1', to: 'kelly', act: 'inform', subject: 'Second', body: 'two' });
  const kelly = path.join(home, 'hive', 'agents', 'kelly', 'inbox');
  const got = fs.readdirSync(kelly).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(kelly, f), 'utf8')));
  assert.deepEqual(got.map((m) => m.subject).sort(), ['First', 'Second']);
  assert.ok(got.every((m) => m.id !== 'same-1'));
});

test('Reply shows under a waiting question back and under the latest answer, and sends in its thread', () => {
  // Value: protects=design 3.1A (Reply on answered questions) and 16A (question back); fails_when=Reply shows on older replies, notes or couldn't finish, or the composer drops in_reply_to or the conversation; why_new=new rule (D4, 2026-10-17); seam=pure helper plus source pins
  const { replyTargets } = loadTs('src/renderer/src/shell/replyTargets.ts');
  const q = (id, status) => ({ kind: 'owner', id, status, conversation: `owner:${id}`, text: id, at: '2026-10-17T10:00:00.000Z' });
  const r = (id, replyTo, act, notes = false) => ({ kind: 'michael', id, replyTo, act, notes, text: id, at: '2026-10-17T10:01:00.000Z' });
  const items = [
    q('a', 'answered'), r('a1', 'a', 'inform'), r('a2', 'a', 'done'), r('a3', 'a', 'inform', true),
    q('b', 'waiting-for-you'), r('b1', 'b', 'query'),
    q('c', 'couldnt-finish'), r('c1', 'c', 'refuse'),
    q('d', 'has-it'), r('d1', 'd', 'inform')
  ];
  const got = [...replyTargets(items)].map((x) => x.id).sort();
  assert.deepEqual(got, ['a2', 'b1'], 'latest answer of an answered question, and the waiting question back');
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /const canReply = useMemo\(\(\) => replyTargets\(dock\.items\), \[dock\.items\]\);/);
  assert.match(dock, /canReply=\{canReply\.has\(it\)\}/);
  assert.match(dock, /onReply=\{\(\) => question && onReply\(\{ inReplyTo: it\.id, conversation: question\.conversation, text: firstSentence\(it\.text\) \}\)\}/);
  const bar = read('src/renderer/src/shell/BottomBar.tsx');
  assert.match(bar, /sendToMichael\(godId, text, attachments, replyTo \? \{ inReplyTo: replyTo\.inReplyTo, conversation: replyTo\.conversation \} : undefined\)/);
  assert.match(read('src/renderer/src/shell/ownerSend.ts'), /window\.cth\.ownerAsk\(\{ text: body, \.\.\.\(reply \?\? \{\}\) \}\)/);
});

test('a long reply folds by height, and tables sit in a labelled box that scrolls and takes Tab', () => {
  // Value: protects=design 2.1A (fold by height, tables fold too), 5.1A (mono amount columns), 5.2A and 6.1A (table box, keyboard); fails_when=the fold goes back to a line clamp, the box loses its tab stop or label, or amount cells lose their class; why_new=new behavior (2026-10-17); seam=source pins (no layout harness); no_claim=the look (checked in the running app)
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /const FOLD_PX = 144;\nconst FOLD_NOTES_PX = 108;/);
  assert.match(dock, /style=\{open \? undefined : \{ maxHeight: fold, overflow: 'hidden', position: 'relative' \}\}/);
  assert.match(dock, /const open = expanded \|\| wide;/, 'wide, nothing folds (wide 1:1, 2A)');
  assert.match(dock, /const measure = \(\) => setClipped\(el\.scrollHeight > el\.clientHeight \+ 1\);/);
  assert.match(dock, /\{folded && <div aria-hidden="true" className="cth-dock-fade" \/>\}/);
  assert.doesNotMatch(dock, /WebkitLineClamp/, 'a line clamp never folds a table');
  const md = read('src/renderer/src/markdown/MarkdownPreview.tsx');
  assert.match(md, /<div className="cth-md-table" tabIndex=\{0\} role="region" aria-label=\{t\('markdown\.table'\)\}>/);
  assert.match(md, /return style\?\.textAlign === 'right' \? 'cth-md-num' : undefined;/);
  const css = read('src/renderer/src/design/global.css');
  assert.match(css, /\.cth-md-preview \.cth-md-table \{ margin: 0\.8em 0; overflow-x: auto;/);
  assert.match(css, /\.cth-md-preview \.cth-md-table:focus-visible \{ outline: 2px solid var\(--cth-indigo\)/);
  assert.match(css, /\.cth-dock-reply \.cth-md-card td\.cth-md-num \{\n  font-family: var\(--cth-font-mono\); font-size: 12px; font-variant-numeric: tabular-nums;/);
  assert.doesNotMatch(css, /\.cth-md-preview table \{[^}]*overflow-x/, 'the box scrolls, not the table');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const label = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).markdown.table;
    assert.equal(typeof label, 'string', loc);
    assert.doesNotMatch(label, /[–—]| - /, `${loc} markdown.table has no dash`);
  }
});

