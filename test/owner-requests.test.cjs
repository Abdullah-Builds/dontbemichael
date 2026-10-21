'use strict';

/**
 * The owner's Ask me answer is Michael's open work (docs/designs/card-lifecycle.md).
 * 2026-10-02: six answered cards sat in Blocked. The answers reached Michael as
 * an inform, a note he read and set aside, so they left the request loop he
 * runs with the team. Now an answer is a request about its card, open until he
 * replies "done"; open ones stay in his context every turn.
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

const { openOwnerRequests, ownerRequestsContext, answersWithoutRequest, workingMsBetween, michaelCardState, blockedWithNothingAsked, stuckCardsContext } = loadTs('src/shared/ownerRequests.ts');
const { answerMessages, cardConversation } = loadTs('src/shared/askMeRouting.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const req = (id, card, at, extra = {}) => ({ id, from: 'human', act: 'request', conversation: card ? cardConversation(card) : 'conv-x', subject: `OWNER ANSWER on card ${card}`, created_at: at, ...extra });

test('an owner request stays open until Michael replies to it or to a newer one on its card', () => {
  // Value: protects=an answered card stays Michael's open work until he closes it, and a second answer on a card never hides the first; fails_when=a reply is not matched by in_reply_to, only the newest request per card counts, a reply leaves older requests on its card open, or a Talk to Michael message or a teammate's note counts; why_new=pre-landing review 2026-10-05: one card holds several questions; seam=none
  const toMichael = [
    req('a1', 'c1', '2026-10-01T09:00:00Z'),
    req('a2', 'c1', '2026-10-02T09:00:00Z'),
    req('b1', 'c2', '2026-10-01T10:00:00Z'),
    req('x1', null, '2026-10-01T11:00:00Z'),
    { id: 'n1', from: 'oscar', act: 'request', conversation: cardConversation('c3'), created_at: '2026-10-01T12:00:00Z' },
    { id: 'i1', from: 'human', act: 'inform', conversation: cardConversation('c4'), created_at: '2026-10-01T12:00:00Z' }
  ];
  const open = openOwnerRequests(toMichael, [
    { id: 'r1', from: 'god', to: 'human', act: 'done', in_reply_to: 'b1', created_at: '2026-10-01T11:00:00Z' },
    // A hand-off to a teammate in the same thread is routing, not the closure.
    { id: 'r2', from: 'god', to: 'nick', act: 'request', in_reply_to: 'a2', created_at: '2026-10-02T10:00:00Z' }
  ]);
  assert.deepEqual(open.map((r) => [r.id, r.taskId]), [['a1', 'c1'], ['a2', 'c1']], 'both answers on c1 wait on Michael');
  const settled = openOwnerRequests([...toMichael, req('a3', 'c1', '2026-10-03T09:00:00Z')], [
    { id: 'r3', from: 'god', to: 'human', act: 'done', in_reply_to: 'a2', created_at: '2026-10-02T11:00:00Z' }
  ]);
  assert.deepEqual(settled.map((r) => r.id), ['b1', 'a3'], 'a reply settles its card up to it, and a later answer stays open');
  const ctx = ownerRequestsContext(open.slice(1), Date.parse('2026-10-02T12:00:00Z'));
  assert.match(ctx, /^OPEN REQUESTS FROM THE OWNER\./);
  assert.match(ctx, /- card c1: OWNER ANSWER on card c1 \(open 3 h, id a2\)/);
  assert.equal(ownerRequestsContext([], Date.now()), null, 'nothing open adds nothing');
});

test('the answer is a request to Michael tied to its card, and nothing goes to the raiser', () => {
  // Value: protects=the answer re-enters the request loop and Michael, not the worker, restarts the card; fails_when=Michael's message goes back to inform, loses its card conversation, or the owner messages the raiser directly; why_new=owner, 2026-10-04: the owner only talks to Michael; seam=none
  const sent = answerMessages({ raiser: 'oscar', raiserName: 'Oscar', taskId: 't1', title: 'Pay the supplier', q: 'Pay now?', a: 'Yes.' });
  assert.equal(sent.length, 1);
  const [toMichael] = sent;
  assert.deepEqual([toMichael.to, toMichael.act, toMichael.requires_reply, toMichael.conversation], ['god', 'request', true, 'card:t1']);
  assert.match(toMichael.body, /Then close this request with a "done" reply \(in_reply_to this message\)\. It stays open until you do\./);
});

test('cards answered before this change get their request once, at launch', () => {
  // Value: protects=today's stuck cards reach Michael without editing data, and only once; fails_when=a card already requested since its answer is sent again, or an unanswered or unblocked card is sent; why_new=new catch-up; seam=none
  const tasks = [
    { id: 'old', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-09-29T01:00:00Z', raisedBy: 'nick' }] },
    { id: 'sent', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-10-01T09:00:00Z' }] },
    { id: 'open', status: 'blocked', humanQA: [{ q: 'Q?' }] },
    { id: 'moving', status: 'doing', humanQA: [{ q: 'Q?', a: 'A.' }] }
  ];
  const out = answersWithoutRequest(tasks, [req('s1', 'sent', '2026-10-01T09:00:01Z')]);
  assert.deepEqual(out.map((x) => [x.task.id, x.raisedBy]), [['old', 'nick']]);
});

test('Michael closing an owner request is filed, not delivered back to him, and the cache sees it closed', async (t) => {
  // Value: protects=his done reply closes the request instead of looping into his own inbox; fails_when=the router delivers a Michael-to-owner reply back to Michael, or refreshOwnerRequests ignores his sent replies; why_new=new routing rule; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-req-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const sent = hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card t9', body: 'x', conversation: 'card:t9' }, 'human');
  assert.deepEqual(hive.refreshOwnerRequests().map((r) => r.taskId), ['t9']);
  const inbox = path.join(home, 'hive', 'agents', 'god', 'inbox');
  const before = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).length;
  const reply = hive.send({ to: 'human', act: 'done', subject: 'Routed', body: 'Handed to Nick.', in_reply_to: sent.id }, 'god');
  assert.equal(fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).length, before, 'not delivered back to Michael');
  // The router archives his outbox copy in .sent; that copy closes the request.
  const sentDir = path.join(home, 'hive', 'agents', 'god', 'outbox', '.sent');
  fs.mkdirSync(sentDir, { recursive: true });
  fs.writeFileSync(path.join(sentDir, `${reply.id}.json`), JSON.stringify(reply));
  assert.deepEqual(hive.refreshOwnerRequests(), []);
});

test('Michael sees his open owner requests on every turn while any are open, and once when the last closes', async () => {
  // Value: protects=a compaction or a busy stretch cannot lose an owner answer; fails_when=the list is only sent once, sent to a team member, or never says it emptied; why_new=new hook context; seam=none
  let open = [{ id: 'a2', taskId: 'c1', subject: 'OWNER ANSWER on card c1', createdAt: new Date().toISOString() }];
  const hive = {
    recordSession() {},
    registry() { return { godId: 'god', agents: { god: { isGod: true, name: 'Michael' }, pam: { name: 'Pam' } } }; },
    rosterContext() { return null; },
    isGod(id) { return id === 'god'; },
    ownerRequests() { return open; }
  };
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), undefined, undefined);
  const ctx = async (agent = 'god') => (await server.handle({ agent_id: agent, hook_event_name: 'UserPromptSubmit', session_id: 's1' }))?.hookSpecificOutput?.additionalContext ?? '';
  assert.match(await ctx(), /OPEN REQUESTS FROM THE OWNER\./);
  assert.match(await ctx(), /OPEN REQUESTS FROM THE OWNER\./, 'every turn, not only the first');
  assert.doesNotMatch(await ctx('pam'), /OPEN REQUESTS/, 'Michael only');
  open = [];
  assert.match(await ctx(), /OPEN REQUESTS FROM THE OWNER: none open now\./);
  assert.doesNotMatch(await ctx(), /OPEN REQUESTS/, 'said once');
});

test('Michael is told to route the follow-up and close the request, not to unblock the card', () => {
  // Value: protects=his instructions match the request loop; fails_when=the old "unblock the card" wording returns; why_new=instructions changed; seam=none
  const src = fs.readFileSync(path.resolve(__dirname, '../src/main/hive.ts'), 'utf8');
  assert.doesNotMatch(src, /unblock the card/);
  assert.match(src, /comes to you, and only you, as a request about the card, because the owner talks only to you, so tell the team member yourself: route the follow-up/);
});

test('the Tasks view shows a card as with Michael, and as not moved after one working day; closed days do not count', () => {
  // Value: protects=the owner sees which answered cards Michael is sitting on, without a weekend making him look late; fails_when=closed office days count, the threshold is wall clock, or a fresh request reads as stalled; why_new=new Tasks view state (T5); seam=none
  const H = 3_600_000;
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const fri = new Date(2026, 9, 2, 9, 0).getTime(); // Friday 2 Oct 2026, 09:00 local
  const mon = new Date(2026, 9, 5, 9, 0).getTime(); // Monday 09:00 local
  assert.equal(workingMsBetween(fri, mon, weekdays), 24 * H, 'Saturday and Sunday are skipped');
  assert.equal(workingMsBetween(fri, mon, []), 72 * H, 'no office days listed counts every day');
  assert.equal(workingMsBetween(mon, fri, weekdays), 0, 'backwards is zero');
  const at = new Date(fri).toISOString();
  assert.equal(michaelCardState(at, fri + 3 * H, weekdays), 'with');
  assert.equal(michaelCardState(at, mon, weekdays), 'with', 'exactly one working day is not yet late');
  assert.equal(michaelCardState(at, mon + H, weekdays), 'stalled');
  assert.equal(michaelCardState(at, fri + 25 * H, ['fri', 'sat']), 'stalled', 'an office open Saturday counts it');
});

test('with office hours, only the work day counts, and one work day is the limit', () => {
  // Value: protects=a request opened at 09:00 is not called late the next morning; fails_when=nights count against Michael or the limit stays 24 hours; why_new=Codex adversarial review (gpt-5.4), ship 2026-10-03; seam=none
  const H = 3_600_000;
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const work = { start: '09:00', end: '17:00' };
  const mon9 = new Date(2026, 9, 5, 9, 0).getTime();
  const tue10 = new Date(2026, 9, 6, 10, 0).getTime();
  assert.equal(workingMsBetween(mon9, tue10, weekdays, work), 9 * H, 'Monday 8 hours plus Tuesday 1 hour');
  const at = new Date(mon9).toISOString();
  assert.equal(michaelCardState(at, tue10, weekdays, work), 'stalled', 'past one 8 hour work day');
  assert.equal(michaelCardState(at, new Date(2026, 9, 6, 8, 0).getTime(), weekdays, work), 'with', 'the night does not count');
  assert.equal(michaelCardState(at, new Date(2026, 9, 6, 8, 0).getTime(), weekdays, { start: 'x', end: '17:00' }), 'with', 'unusable hours fall back to 24 office hours');
  assert.equal(michaelCardState(at, tue10, weekdays, { start: 'x', end: '17:00' }), 'stalled', '25 office day hours');
});

test('the Tasks view reads open owner requests from the shared feed and badges those cards', () => {
  // Value: protects=the badge comes from the same cached read as everything else and never lands on Ask me; fails_when=the feed stops reading owner requests, counts them as needing the owner, or the card loses its badge; why_new=new UI wiring (T5); seam=source pin, the renderer has no DOM test harness
  const feed = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/useNeedsYou.ts'), 'utf8');
  assert.match(feed, /window\.cth\.hiveOwnerRequests\?\.\(\)/);
  assert.match(feed, /count: merged\.tasks\.reduce\(\(n, t\) => n \+ openQuestions\(t\)\.length, 0\) \+ merged\.requests\.length \+ merged\.offers\.length \+ merged\.proposals\.length \+ merged\.booksApprovals\.length,/, 'they wait on Michael, not the owner');
  assert.match(feed, /count: merged\.tasks\.reduce\(\(n, t\) => n \+ shownQuestions\(t, merged\.foundations\)\.length, 0\) \+ merged\.requests\.length \+ merged\.offers\.length \+ merged\.proposals\.length,/, 'they wait on Michael, not the owner');
  const kanban = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/TasksKanban.tsx'), 'utf8');
  assert.match(kanban, /michaelCardState\(r\.createdAt, now, office\.days, office\.work\)/);
  assert.match(kanban, /pack\?\.officeHours\?\.days/);
  assert.match(kanban, /t\('kanban\.godStalled', \{ godName \}\)/);
});

test('a Blocked card with no open ask and no open owner request is listed as nothing asked', () => {
  // Value: protects=Blocked always means waiting on the owner; 2026-10-03 Michael closed six owner requests and left all six cards Blocked with their next questions unasked; fails_when=a card with an open ask, one still with Michael, or one in another column is listed, or a dismissed or answered ask hides a stuck card; why_new=new invariant (card-lifecycle.md section 7); seam=none
  const tasks = [
    { id: 'asked', status: 'blocked', humanQA: [{ q: 'Q?' }] },
    { id: 'answered', status: 'blocked', title: 'Pipeline', assignee: 'dwight', humanQA: [{ q: 'Q?', a: 'A.' }] },
    { id: 'dismissed', status: 'blocked', humanQA: [{ q: 'Q?', dismissedAt: 'x' }] },
    { id: 'bare', status: 'blocked' },
    { id: 'routing', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.' }] },
    { id: 'moving', status: 'doing', humanQA: [{ q: 'Q?', a: 'A.' }] }
  ];
  const stuck = blockedWithNothingAsked(tasks, [{ taskId: 'routing' }]);
  assert.deepEqual(stuck.map((c) => c.id), ['answered', 'dismissed', 'bare']);
  const ctx = stuckCardsContext(stuck);
  assert.match(ctx, /^BLOCKED CARDS WITH NOTHING ASKED\./);
  assert.match(ctx, /add the question to its humanQA so it shows on Ask me; if it waits on someone outside the office or on a team member, move it to "waiting" and name who in "waitingOn"/);
  assert.match(ctx, /- card answered: Pipeline \(with dwight\)/);
  assert.equal(stuckCardsContext([]), null);
});

test('Michael sees the nothing asked list every turn, the owner sees it on the Tasks view, and the standup works it', async () => {
  // Value: protects=the stuck cards reach Michael without a reminder system and the owner can see them; fails_when=the list is sent once, to a team member, never clears, the badge goes, or an office keeps the old standup focus; why_new=section 7; seam=fake hive for the hook, source pins for the UI and migration
  let stuck = [{ id: 'c1', title: 'Pipeline', assignee: 'dwight' }];
  const hive = {
    recordSession() {},
    registry() { return { godId: 'god', agents: { god: { isGod: true, name: 'Michael' }, pam: { name: 'Pam' } } }; },
    rosterContext() { return null; },
    isGod(id) { return id === 'god'; },
    ownerRequests() { return []; },
    stuckCards() { return stuck; }
  };
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), undefined, undefined);
  const ctx = async (agent = 'god') => (await server.handle({ agent_id: agent, hook_event_name: 'UserPromptSubmit', session_id: 's1' }))?.hookSpecificOutput?.additionalContext ?? '';
  assert.match(await ctx(), /- card c1: Pipeline \(with dwight\)/);
  assert.match(await ctx(), /BLOCKED CARDS WITH NOTHING ASKED\./, 'every turn');
  assert.doesNotMatch(await ctx('pam'), /BLOCKED CARDS/);
  stuck = [];
  assert.match(await ctx(), /^CARDS TO TIDY \(new filings, Blocked with nothing asked, or open questions held the wrong way\): none now\.$/m);
  assert.doesNotMatch(await ctx(), /BLOCKED CARDS|CARDS TO TIDY/);
  const hiveSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/hive.ts'), 'utf8');
  assert.match(hiveSrc, /A card is "blocked" only while its question for the owner is open on Ask me/);
  assert.match(hiveSrc, /this\.stuckCardsCache = \[\.\.\.blockedWithNothingAsked\(/);
  const kanban = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/TasksKanban.tsx'), 'utf8');
  assert.match(kanban, /blockedWithNothingAsked\(tasks, ownerRequests\)/);
  assert.match(kanban, /t\('kanban\.nothingAsked'\)/);
  const cfg = fs.readFileSync(path.resolve(__dirname, '../src/main/config.ts'), 'utf8');
  assert.match(cfg, /'Then fix every blocked card with nothing asked: put its question for the owner on Ask me, '/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8'), /return m\.focus && OPS_STANDUP_BUILT_IN_FOCUSES\.includes\(m\.focus\) \? \{ \.\.\.m, focus: OPS_STANDUP_FOCUS \} : m;/);
});

test('a stuck card is found on the fleet tick from the ledger and the open owner requests', async (t) => {
  // Value: protects=the cache Michael's hook reads is computed from real files; fails_when=refreshOwnerRequests stops reading tasks.json or ignores open requests; why_new=section 7; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-stuck-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([
    { id: 'a', title: 'A', status: 'blocked', dependsOn: [], priority: 3, createdAt: 'x', humanQA: [{ q: 'Q?', a: 'A.' }] },
    { id: 'b', title: 'B', status: 'blocked', dependsOn: [], priority: 3, createdAt: 'x', humanQA: [{ q: 'Q?', a: 'A.' }] }
  ]);
  hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card b', body: 'x', conversation: 'card:b' }, 'human');
  hive.refreshOwnerRequests();
  assert.deepEqual(hive.stuckCards().map((c) => c.id), ['a'], 'b is still with Michael');
});

test('a reply from Michael to the owner still reaches the observers, so closing time sees CLOSING-TIME-COMPLETE', async (t) => {
  // Value: protects=closing time completes when Michael's COMPLETE is a reply to the owner's closing request; fails_when=the owner-request rule files the reply before the routed observer sees it (2026-10-03 closing hang); why_new=regression of the card-lifecycle router rule; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-req-obs-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const seen = [];
  hive.setRoutedObserver((msg, targets) => seen.push([msg.subject, targets]));
  const ask = hive.send({ to: 'god', act: 'request', subject: 'Closing time: close the office now', body: 'x' }, 'human');
  hive.send({ to: 'human', act: 'done', subject: 'CLOSING-TIME-COMPLETE', body: 'All acknowledged.', in_reply_to: ask.id }, 'god');
  assert.deepEqual(seen.find(([s]) => s === 'CLOSING-TIME-COMPLETE'), ['CLOSING-TIME-COMPLETE', []]);
});

test('the launch catch-up resends only an answer newer than the card\'s last owner request', () => {
  // Value: protects=every launch sends a still unrouted answer once and never spams Michael with one he already has; fails_when=a second answer after an older request is skipped, a legacy answer without answeredAt is resent, a teammate's request or a chat message counts as the owner request, or a blank or dismissed answer is sent; why_new=the catch-up test covers one sent and one never sent card only; seam=none
  const tasks = [
    { id: 'again', status: 'blocked', humanQA: [{ q: 'Q1?', a: 'A1.', answeredAt: '2026-10-01T09:00:00Z' }, { q: 'Q2?', a: 'A2.', answeredAt: '2026-10-02T09:00:00Z' }] },
    { id: 'legacy', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.' }] },
    { id: 'peer', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-10-01T09:00:00Z' }] },
    { id: 'blank', status: 'blocked', humanQA: [{ q: 'Q?', a: '   ', answeredAt: '2026-10-01T09:00:00Z' }] },
    { id: 'dropped', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-10-01T09:00:00Z', dismissedAt: '2026-10-01T10:00:00Z' }] },
    null
  ];
  const toMichael = [
    req('r-again', 'again', '2026-10-01T09:00:01Z'),
    req('r-legacy', 'legacy', '2026-09-20T09:00:00Z'),
    { id: 'p1', from: 'oscar', act: 'request', conversation: cardConversation('peer'), created_at: '2026-10-02T00:00:00Z' },
    req('chat', null, '2026-10-02T00:00:00Z')
  ];
  const out = answersWithoutRequest(tasks, toMichael);
  assert.deepEqual(out.map((x) => [x.task.id, x.q, x.a]), [['again', 'Q2?', 'A2.'], ['peer', 'Q?', 'A.']]);
});

test('the launch catch-up sends every answer since the card\'s last owner request, on any card not done', () => {
  // Value: protects=an answer whose request never reached Michael is relayed even on a card that left Blocked or holds several answers; fails_when=only the newest entry counts, only Blocked cards count, a Done card is relayed, or an untimed answer is a candidate; why_new=pre-landing review 2026-10-05; seam=none
  const tasks = [
    { id: 'two', status: 'blocked', humanQA: [{ q: 'Q1?', a: 'A1.', answeredAt: '2026-10-02T09:00:00Z' }, { q: 'Q2?' }, { q: 'Q3?', a: 'A3.', answeredAt: '2026-10-02T10:00:00Z' }] },
    { id: 'moved', status: 'doing', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-10-02T09:00:00Z' }, { q: 'Later?' }] },
    { id: 'old-and-new', status: 'waiting', humanQA: [{ q: 'Old?', a: 'Sent.', answeredAt: '2026-10-01T09:00:00Z' }, { q: 'New?', a: 'Not sent.', answeredAt: '2026-10-02T09:00:00Z' }] },
    { id: 'closed', status: 'done', humanQA: [{ q: 'Q?', a: 'A.', answeredAt: '2026-10-02T09:00:00Z' }] },
    { id: 'untimed', status: 'blocked', humanQA: [{ q: 'Q?', a: 'A.' }] }
  ];
  const out = answersWithoutRequest(tasks, [req('r1', 'old-and-new', '2026-10-01T09:00:01Z')]);
  assert.deepEqual(out.map((x) => [x.task.id, x.q]), [['two', 'Q1?'], ['two', 'Q3?'], ['moved', 'Q?'], ['old-and-new', 'New?']]);
});

test('an owner request on a Done card stays open only when it came after the owner closed the card', async (t) => {
  // Value: protects=an answer given after a card closed still reaches Michael's open requests, and one settled by the close is dropped; fails_when=every request on a Done card is dropped, or one older than the close lingers; why_new=pre-landing review 2026-10-05; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-req-done-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const before = hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card early', body: 'x', conversation: 'card:early' }, 'human');
  const after = hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card late', body: 'x', conversation: 'card:late' }, 'human');
  hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card plain', body: 'x', conversation: 'card:plain' }, 'human');
  const shift = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
  hive.writeTasks([
    { id: 'early', title: 'Early', status: 'done', dependsOn: [], priority: 3, createdAt: 'x', closedBy: 'owner', closedAt: shift(before.created_at, 60_000) },
    { id: 'late', title: 'Late', status: 'done', dependsOn: [], priority: 3, createdAt: 'x', closedBy: 'owner', closedAt: shift(after.created_at, -60_000) },
    { id: 'plain', title: 'Plain', status: 'done', dependsOn: [], priority: 3, createdAt: 'x', result: 'finished' }
  ]);
  assert.deepEqual(hive.refreshOwnerRequests().map((r) => r.taskId), ['late']);
});

test('an owner answer on a card Michael marked Done stays his open request', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-req-michael-done-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', cwd: home, isGod: true });
  const tick = () => new Promise((r) => setTimeout(r, 5));
  hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card a', body: 'x', conversation: 'card:a' }, 'human');
  await tick();
  // Michael marks both cards Done in the file, with a question still open on b.
  fs.writeFileSync(path.join(hive.root(), 'tasks.json'), JSON.stringify({ tasks: [
    { id: 'a', title: 'A', status: 'done', dependsOn: [], priority: 3, createdAt: 'x', result: 'done' },
    { id: 'b', title: 'B', status: 'done', dependsOn: [], priority: 3, createdAt: 'x', result: 'done', humanQA: [{ q: 'Which supplier?' }] }
  ] }));
  assert.deepEqual(hive.refreshOwnerRequests(), [], 'the request from before the card was Done is settled');
  await tick();
  // The owner answers the open question afterwards.
  hive.send({ to: 'god', act: 'request', subject: 'OWNER ANSWER on card b', body: 'x', conversation: 'card:b' }, 'human');
  assert.deepEqual(hive.refreshOwnerRequests().map((r) => r.taskId), ['b']);
});

test('Michael withdraws a question on a card the owner moved, and never moves that card back', () => {
  // Value: protects=Michael's tidy note never tells him to undo an owner's move; fails_when=the off Blocked note says only to move the card back to Blocked; why_new=pre-landing review 2026-10-05; seam=none
  const { asksToTidy } = loadTs('src/shared/ownerRequests.ts');
  const ctx = stuckCardsContext(asksToTidy([{ id: 'c', title: 'Card', status: 'doing', humanQA: [{ q: 'Q?' }] }]));
  assert.match(ctx, /if you moved the card out of Blocked and the work still needs the answer, move it back to "blocked"/);
  assert.match(ctx, /If the owner moved it, the card is done, or the question no longer matters, withdraw the question/);
  assert.match(ctx, /Never move a card the owner moved\./);
  assert.doesNotMatch(ctx, /[\u2013\u2014]/);
});

test('an open owner request never ages out, and Michael closing it under his own name counts', async (t) => {
  // Value: protects=an owner answer stays Michael's open work however long it waits, and a reply addressed "Michael" or "michael" still closes it (TODOS.md, michael-replies.md); fails_when=refreshOwnerRequests goes back to a rolling 30 day window, or only "human" closes a request; why_new=the fixed floor and the aliases had no test; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-owner-floor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  const sentDir = path.join(home, 'hive', 'agents', 'god', 'outbox', '.sent');
  fs.mkdirSync(sentDir, { recursive: true });
  const ask = (card) => hive.send({ to: 'god', act: 'request', subject: `OWNER ANSWER on card ${card}`, body: 'x', conversation: `card:${card}`, created_at: '2026-09-10T09:00:00.000Z' }, 'human');
  const a = ask('t1');
  const b = ask('t2');
  const c = ask('t3');
  const months = Date.parse('2027-03-01T00:00:00.000Z');
  assert.deepEqual(hive.refreshOwnerRequests(months).map((r) => r.taskId).sort(), ['t1', 't2', 't3'], 'still open months later');
  for (const [to, q] of [['Michael', a], ['michael', b]]) {
    const reply = hive.send({ to, act: 'done', subject: 'Routed', body: 'Handed on.', in_reply_to: q.id }, 'god');
    fs.writeFileSync(path.join(sentDir, `${reply.id}.json`), JSON.stringify(reply));
  }
  assert.deepEqual(hive.refreshOwnerRequests(months).map((r) => r.taskId), ['t3']);
  assert.ok(c.id);
});

test('the catch-up matches each request to its own answer, so a failed send is not hidden by a later answer', () => {
  const card = { id: 'two', status: 'blocked', humanQA: [
    { q: 'Q1?', a: 'A1.', answeredAt: '2026-10-02T09:00:00.000Z' },
    { q: 'Q2?', a: 'A2.', answeredAt: '2026-10-02T10:00:00.000Z' }
  ] };
  // Q1's request never went out; Q2's did, after it.
  const toMichael = [req('r2', 'two', '2026-10-02T10:00:01Z', { answeredAt: '2026-10-02T10:00:00.000Z' })];
  assert.deepEqual(answersWithoutRequest([card], toMichael).map((x) => x.q), ['Q1?']);
  // A request from before the answer time line still covers every answer before it.
  assert.deepEqual(answersWithoutRequest([card], [req('old', 'two', '2026-10-02T10:00:01Z')]), []);
});

test('the answer time rides on the last line of the request, and the hive reads it back', async (t) => {
  const { answeredAtOf } = loadTs('src/shared/askMeRouting.ts');
  const [m] = answerMessages({ raiser: 'god', raiserName: 'Michael', taskId: 't1', title: 'Pay', q: 'Pay?\nAnswered at 2026-01-01T00:00:00.000Z.', a: 'Yes.', answeredAt: '2026-10-02T09:00:00.000Z' });
  assert.match(m.body, /\nAnswered at 2026-10-02T09:00:00\.000Z\.$/);
  assert.equal(answeredAtOf(m.body), '2026-10-02T09:00:00.000Z', 'only the last line counts');
  assert.equal(answeredAtOf(answerMessages({ raiser: 'god', raiserName: 'Michael', taskId: 't1', title: 'Pay', q: 'Q?', a: 'Answered at 2026-01-01T00:00:00.000Z.' })[0].body), undefined, 'an answer without a time names none');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-catchup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', cwd: os.tmpdir(), isGod: true });
  hive.writeTasks([{ id: 't1', title: 'Pay', status: 'blocked', dependsOn: [], priority: 3, createdAt: '2026-10-01T00:00:00Z', humanQA: [
    { q: 'Q1?', a: 'A1.', answeredAt: '2026-10-02T09:00:00.000Z' },
    { q: 'Q2?', a: 'A2.', answeredAt: '2026-10-02T10:00:00.000Z' }
  ] }]);
  const [sent] = answerMessages({ raiser: 'god', raiserName: 'Michael', taskId: 't1', title: 'Pay', q: 'Q2?', a: 'A2.', answeredAt: '2026-10-02T10:00:00.000Z' });
  hive.send({ to: sent.to, act: sent.act, subject: sent.subject, body: sent.body, conversation: sent.conversation }, 'human');
  assert.deepEqual(hive.ownerAnswersWithoutRequest().map((x) => x.q), ['Q1?']);
});
