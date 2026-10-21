'use strict';

/**
 * Pulse proposal 3 (owner, 2026-10-15; mockup pulse-v3.html): Kept safe,
 * Learning and Team at work, and the backfill's readers. Pure parts only;
 * the store, processor and an end to end backfill are in pulse-telemetry.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { trustKeys, keptSafe } = loadTs('src/shared/pulseSafety.ts');
const { learning, MIN_TURNS_FOR_RATE } = loadTs('src/shared/teamLearning.ts');
const { teamAtWork } = loadTs('src/shared/teamPerformance.ts');
const { readTranscript, gateOfTool, logPoints, ledgerDays } = loadTs('src/main/pulseBackfill.ts');
const { readTeamMemory } = loadTs('src/main/teamMemory.ts');

test('a trust layer deny is a stop only when the check judged it; a check that could not run is held', () => {
  // Value: protects=Kept safe's honesty (held is not protection); fails_when=no-answer, unreadable or too long counts as stopped, or a flag is lost; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'model' }), ['in-stop']);
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'pattern' }), ['in-stop']);
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'recheck' }), ['in-stop']);
  for (const by of ['no-answer', 'unreadable', 'length']) assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by }), ['in-held'], by);
  assert.deepEqual(trustKeys({ way: 'out', decision: 'deny', by: 'no-answer' }), ['out-held']);
  assert.deepEqual(trustKeys({ way: 'out', decision: 'pass', flagged: true }), ['out-pass', 'out-flagged']);
  assert.deepEqual(trustKeys({ way: 'sideways', decision: 'pass' }), []);
  assert.equal(keptSafe([]).any, false);
  // From v 2 (2026-10-16) a hold is counted from the hive's trust-held line,
  // which the held list shares, so a v 2 line never counts it twice.
  for (const by of ['no-answer', 'unreadable', 'length']) assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by, v: 2 }), [], by);
  assert.deepEqual(trustKeys({ way: 'out', decision: 'deny', by: 'no-answer', v: 2 }), []);
  assert.deepEqual(trustKeys({ way: 'in', decision: 'deny', by: 'model', v: 2 }), ['in-stop'], 'a stop still counts');
});

test('the held list reads its rows, drops lines that are not rows, and tidies like Michael\'s note', () => {
  // Value: protects=the held list never breaks on a bad line, and its holds match the count's rule; fails_when=a torn line throws, a stop is called a hold, or quotes survive; why_new=held list (owner, 2026-10-16); seam=none; no_claim=none beyond protects
  const H = loadTs('src/shared/heldRecord.ts');
  const R = loadTs('src/shared/research.ts');
  assert.equal(H.parseHeld('{"at":1'), null);
  assert.equal(H.parseHeld(JSON.stringify({ at: 1, way: 'up', from: 'x', why: 'no-answer' })), null);
  assert.deepEqual(H.parseHeld(JSON.stringify({ at: 1, way: 'in', from: 'human', to: 'research', toName: 'Pete', subject: 's', opening: 'o', why: 'failed', told: 'michael' })),
    { at: 1, way: 'in', from: 'human', fromName: null, to: 'research', toName: 'Pete', subject: 's', opening: 'o', why: 'failed', told: 'michael' });
  assert.equal(H.tidy('Say \u201chi\u201d\nnow', 80), 'Say hi now');
  const why = (v) => H.heldWhy(v, R.REFUSAL_CHECK_FAILED, R.REFUSAL_TOO_LONG);
  assert.deepEqual(['length', 'no-answer', 'unreadable', 'settings'].map((by) => why({ reason: 'x', by })), ['too-long', 'no-answer', 'unreadable', 'settings']);
  assert.deepEqual(['model', 'pattern', 'recheck'].map((by) => why({ reason: 'x', by })), [null, null, null]);
  assert.deepEqual([why({ reason: R.REFUSAL_CHECK_FAILED }), why({ reason: R.REFUSAL_TOO_LONG }), why({ reason: R.REFUSAL_OFF })], ['failed', 'too-long', null]);
  // The owner's two questions (2026-10-16): which notes, and what caused it.
  const index = '# Memory, Research (research)\n\n<!-- memory index v1 -->\nThe app keeps this file. Add notes to memory/inbox.md; they are sorted in here in the background.';
  assert.equal(H.notesPreview(index), '', 'the empty index page is no notes');
  assert.equal(H.notesPreview(`${index}\n\ninbox.md\n- King Arthur recipe pages load fully\n- IRS rates table on irs.gov`), 'King Arthur recipe pages load fully \u00b7 IRS rates table on irs.gov');
  assert.equal(H.notesPreview('- a\n'.repeat(400)).length, 300);
  const cause = (why, error) => H.heldCause({ why, error });
  assert.deepEqual([cause('no-answer', 'hidden session never took the prompt (signed out, or a screen is waiting)'), cause('no-answer', 'no answer within 60 seconds'), cause('no-answer', 'hidden session timed out'), cause('no-answer'), cause('unreadable'), cause('too-long'), cause('settings'), cause('no-layer'), cause('failed')],
    ['starting', 'slow', 'slow', 'checkDown', 'unreadable', 'tooLong', 'settings', 'off', 'checkDown']);
});

test('Learning: the period\'s notes by source, its questions per 100 requests once it has enough, the span before, and what the team holds in all', () => {
  // Value: protects=the Learning row for every period (owner, 2026-10-15 and 2026-10-16); fails_when=a note or ask lands in the wrong span, a span drops its first or last day, a thin span shows a rate, or the in all totals follow the period; why_new=Learning moved from weeks to ranges (76cfcf01 regression class); seam=none; no_claim=what a note says
  const { periodRange, previousRange } = loadTs('src/shared/teamPerformance.ts');
  const now = new Date(2026, 9, 15, 12).getTime(); // a Thursday
  const notes = [
    { agentId: 'pam', source: 'owner', date: '2026-09-10' },   // outside every span: only in all
    { agentId: 'pam', source: 'owner', date: '2026-10-06' },   // last week, Tuesday
    { agentId: 'pam', source: 'task', date: '2026-10-12' },    // this week's first day
    { agentId: 'god', source: 'michael', date: '2026-10-14' },
    { agentId: 'god', source: 'tool', date: '2026-10-15' }     // today
  ];
  const asks = [{ raisedBy: 'pam', askedAt: new Date(2026, 9, 13, 9).getTime() }, { raisedBy: 'god', askedAt: new Date(2026, 9, 15, 23, 59).getTime() }];
  const turns = [{ day: '2026-10-13', turns: 30 }, { day: '2026-10-15', turns: 10 }, { day: '2026-10-06', turns: MIN_TURNS_FOR_RATE - 1 }];
  const week = learning({ notes, procedures: { pam: 2 }, asks, turns, range: periodRange('this-week', now), previous: previousRange('this-week', now) });
  assert.deepEqual(week.period.added, { you: 0, job: 2, michael: 1 });
  assert.equal(week.period.per100, 5, '2 questions in 40 requests');
  assert.deepEqual(week.previous.added, { you: 1, job: 0, michael: 0 });
  assert.equal(week.previous.per100, null, 'too few requests');
  const today = learning({ notes, procedures: { pam: 2 }, asks, turns, range: periodRange('today', now) });
  assert.deepEqual([today.period.added.job, today.period.asks, today.period.turns, today.previous], [1, 1, 10, null], 'the last minute of the day counts');
  const month = learning({ notes, procedures: { pam: 2 }, asks, turns, range: periodRange('this-month', now) });
  assert.equal(month.period.added.you + month.period.added.job + month.period.added.michael, 4);
  assert.deepEqual([week.notes, week.procedures, week.knows.pam, week.knows.god], [5, 2, 5, 2], 'in all, whatever the period');
});

test('Learning counts a note when it is added, not when it is edited, and lists the same notes', () => {
  // Value: protects=the number and its list (owner, 2026-10-18: "4 new today" were 3 new and an edit); fails_when=an edit or repeat counts, a day before the add records loses its notes, the first record's day counts twice, a deleted note keeps text, a reused id shows the wrong line, or count and list disagree; why_new=count moved to add records; seam=none; no_claim=the store (pulse-telemetry)
  const { periodRange } = loadTs('src/shared/teamPerformance.ts');
  const { learnedNotes, countFromDay } = loadTs('src/shared/teamLearning.ts');
  const now = new Date(2026, 9, 18, 18).getTime(); // Sunday
  const at = (d, h) => new Date(2026, 9, d, h).getTime();
  const countFrom = countFromDay(at(14, 9));
  assert.equal(countFrom, '2026-10-15', 'the first record\'s day still counts by date');
  const notes = [
    { agentId: 'pam', id: 'm40', source: 'owner', date: '2026-10-13', text: 'Before the records: counted by date' },
    { agentId: 'pam', id: 'm41', source: 'task', date: '2026-10-14', text: 'The first record\'s day: by date' },
    { agentId: 'creed', id: 'm27', source: 'task', date: '2026-10-18', text: 'An old note edited today' },
    { agentId: 'pam', id: 'm42', source: 'task', date: '2026-10-18', text: 'Cold pitches go to Newsletters' },
    { agentId: 'sadiq', id: 'm23', source: 'michael', date: '2026-10-18', text: 'Only the owner deletes cloud projects' },
    { agentId: 'creed', id: 'm30', source: 'task', date: '2026-10-17', text: 'A later note that took a freed id' }
  ];
  const added = [
    { agentId: 'pam', id: 'm42', source: 'task', at: at(18, 10) },
    { agentId: 'sadiq', id: 'm23', source: 'michael', at: at(18, 11) },
    { agentId: 'creed', id: 'm29', source: 'task', at: at(18, 12) },        // deleted since
    { agentId: 'creed', id: 'm30', source: 'task', at: at(16, 9) },         // its id was freed...
    { agentId: 'creed', id: 'm30', source: 'task', at: at(17, 9) },         // ...and given to this one
    { agentId: 'creed', id: 'm27', source: 'task', at: at(10, 9) }          // added long ago; today only edited
  ];
  const today = learning({ notes, added, countFrom, procedures: {}, asks: [], turns: [], range: periodRange('today', now) });
  assert.deepEqual(today.period.added, { you: 0, job: 2, michael: 1 }, 'the edit is not new; the deleted note was');
  const list = learnedNotes({ notes, added, countFrom }, periodRange('today', now));
  assert.deepEqual(list.map((n) => [n.agentId, n.from, n.text]), [
    ['creed', 'job', null],
    ['pam', 'job', 'Cold pitches go to Newsletters'],
    ['sadiq', 'michael', 'Only the owner deletes cloud projects']
  ], 'grouped as the legend, newest first, a deleted note without its line');
  const week = learnedNotes({ notes, added, countFrom }, periodRange('this-week', now));
  assert.deepEqual(week.filter((n) => n.id === 'm30').map((n) => [n.day, n.text]), [['2026-10-17', 'A later note that took a freed id'], ['2026-10-16', null]], 'a reused id: the latest add owns the line');
  const month = learning({ notes, added, countFrom, procedures: {}, asks: [], turns: [], range: periodRange('this-month', now) });
  const monthList = learnedNotes({ notes, added, countFrom }, periodRange('this-month', now));
  assert.equal(month.period.added.you + month.period.added.job + month.period.added.michael, monthList.length, 'count and list are one rule');
  assert.ok(monthList.some((n) => n.id === 'm40' && n.at === null) && monthList.some((n) => n.id === 'm41'), 'days up to the first record count by date');
  assert.ok(!monthList.some((n) => n.id === 'm27' && n.day === '2026-10-18'), 'no add record today, so the edit is not listed');
  const none = learning({ notes, procedures: {}, asks: [], turns: [], range: periodRange('today', now) });
  assert.deepEqual(none.period.added, { you: 0, job: 2, michael: 1 }, 'with no records yet, the count is by date as before, the edit included');
});

test('Team at work: busiest, several times the average, quiet, and costly for its work only against enough peers', () => {
  // Value: protects=the callouts and headline; fails_when=a quiet member is called busy, a member with little time is judged on cost, or costly is called with too few to compare; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  const h = 3_600_000;
  const w = teamAtWork([
    { agentId: 'god', busyMs: 3.8 * h, usd: 36 },
    { agentId: 'pam', busyMs: 3.6 * h, usd: 43 },
    { agentId: 'dwight', busyMs: 2.1 * h, usd: 40 },
    { agentId: 'kelly', busyMs: 0.7 * h, usd: 25 },
    { agentId: 'creed', busyMs: 0.32 * h, usd: 31 },
    { agentId: 'sadiq', busyMs: 0.05 * h, usd: 8 }
  ]);
  assert.equal(w.chips.god.kind, 'busiest');
  assert.equal(w.chips.pam.kind, 'times');
  assert.equal(w.chips.creed.kind, 'costly');
  assert.equal(w.chips.sadiq.kind, 'quiet', 'under ten minutes: not judged on cost');
  assert.deepEqual(w.topTwo.ids, ['god', 'pam']);
  assert.equal(w.costliest.agentId, 'creed');
  assert.deepEqual(teamAtWork([{ agentId: 'a', busyMs: 0, usd: 3 }]).chips, {});
  // Value: protects=eng review D1 (2026-10-19): the headline names only members who worked a little; fails_when=a member with no time is called mostly quiet again; why_new=no 0 ms row before; seam=none; no_claim=none beyond protects
  const idle = teamAtWork([{ agentId: 'a', busyMs: 2 * h, usd: 1 }, { agentId: 'b', busyMs: 2 * h, usd: 1 }, { agentId: 'c', busyMs: 0.1 * h, usd: 0 }, { agentId: 'd', busyMs: 0, usd: 0 }]);
  assert.deepEqual(idle.quiet, ['c'], 'the slow member is named, the idle one is not');
  assert.equal(idle.chips.d, undefined);
  const two = teamAtWork([{ agentId: 'a', busyMs: h, usd: 100 }, { agentId: 'b', busyMs: h, usd: 1 }]);
  assert.equal(two.costliest, null, 'too few to compare');
});

test('a transcript gives working time per request and the steps a setting refused, once each', () => {
  // Value: protects=the backfill's hours and rules; fails_when=a tool result starts a request, a request runs past an hour, a refusal counts twice, or AskUserQuestion counts; why_new=owner proposal 3 backfill; seam=none; no_claim=every Claude Code line shape
  const iso = (ms) => new Date(ms).toISOString();
  const t0 = Date.UTC(2026, 9, 12, 15);
  const lines = [
    { type: 'user', timestamp: iso(t0), message: { content: 'hello' } },
    { type: 'assistant', timestamp: iso(t0 + 60_000), message: { content: [] } },
    { type: 'user', timestamp: iso(t0 + 70_000), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'PreToolUse:WebFetch hook error: Only Research uses the internet.' }] } },
    { type: 'user', timestamp: iso(t0 + 70_000), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'PreToolUse:WebFetch hook error: Only Research uses the internet.' }] } },
    { type: 'user', timestamp: iso(t0 + 80_000), message: { content: [{ type: 'tool_result', tool_use_id: 'y', content: 'PreToolUse:AskUserQuestion hook error: ask Michael' }] } },
    { type: 'assistant', timestamp: iso(t0 + 120_000), message: { content: [] } },
    { type: 'user', timestamp: iso(t0 + 200_000), message: { content: [{ type: 'text', text: 'next' }] } },
    { type: 'assistant', timestamp: iso(t0 + 200_000 + 3 * 3_600_000), message: { content: [] } },
    'not json'
  ].map((l) => (typeof l === 'string' ? l : JSON.stringify(l)));
  const r = readTranscript(lines, t0 - 1, t0 + 10 * 3_600_000);
  assert.deepEqual(r.turns, [{ ts: t0, ms: 120_000 }, { ts: t0 + 200_000, ms: 3_600_000 }]);
  assert.deepEqual(r.refused, [{ ts: t0 + 70_000, gate: 'internet' }]);
  assert.equal(gateOfTool('mcp__md-mail__send', ''), 'mail');
  assert.equal(gateOfTool('mcp__claude_ai_Gmail__search', ''), 'connector');
  assert.equal(gateOfTool('Edit', 'The harness folder is plumbing only'), 'office-files');
  assert.equal(gateOfTool('Read', 'That folder is private'), 'folder');
});

test('office log points carry the past mark, and only a member\'s message is work', () => {
  // Value: protects=backfill isolation and attribution; fails_when=a backfilled point lacks bf, a message from the scheduler counts as a member's work, or an entry outside the window is read; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const pts = logPoints([
    { ts: 10, kind: 'mail-organize', agentId: 'pam', ids: [1, 2] },
    { ts: 10, kind: 'message', from: 'scheduler', to: 'pam' },
    { ts: 10, kind: 'message', from: 'god', act: 'request' },
    { ts: 99, kind: 'mail-sent', agentId: 'dwight' }
  ], 0, 50, new Set(['pam', 'god']));
  assert.deepEqual(pts.map((p) => [p.kind, p.agentId, p.value ?? null, p.attrs.bf]), [['email', 'pam', 2, 1], ['message', 'god', null, 1]]);
});

test('the cost ledger folds with the restart rule and counts only growth inside the window', () => {
  // Value: protects=backfilled value; fails_when=a restart drop loses the new spend, growth before the window counts, or a later line counts; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const day = new Date(2026, 9, 12, 12).getTime();
  const m = ledgerDays([
    { agent_id: 'pam', session_id: 's', ts: day - 30 * 86_400_000, usd: 5 },
    { agent_id: 'pam', session_id: 's', ts: day, usd: 7 },
    { agent_id: 'pam', session_id: 's', ts: day + 1, usd: 1 },
    { agent_id: 'pam', session_id: 's', ts: day + 2 * 86_400_000, usd: 50 }
  ], day - 86_400_000, day + 86_400_000);
  assert.deepEqual([...m], [['pam\t2026-10-12', 3]]);
});

test('team memory reads each note\'s id, date, source and line, for the members asked about', (t) => {
  // Value: protects=Learning's inputs and the list's text (owner, 2026-10-18); fails_when=a removed member's memory counts, a procedure is missed, a free form line counts as a note, or a note loses the id its add record names; why_new=owner proposal 3, list of new notes; seam=temp hive; no_claim=none beyond protects
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-mem-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'agents', 'pam');
  fs.mkdirSync(path.join(dir, 'memory', 'procedures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory.md'), '# Memory\n<!-- memory index v1 -->\n- [m1] fact | Invoices go to the shared box | owner | 2026-10-01\n- just a line\n- [m2] procedure | Check: steps in x.md | task | 2026-10-02\n');
  fs.writeFileSync(path.join(dir, 'memory', 'procedures', 'check.md'), 'steps');
  fs.mkdirSync(path.join(root, 'agents', 'gone'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', 'gone', 'memory.md'), '- [m1] fact | x | owner | 2026-10-01\n');
  const m = readTeamMemory(root, ['pam', 'nobody']);
  assert.deepEqual(m.notes, [
    { agentId: 'pam', source: 'owner', date: '2026-10-01', id: 'm1', text: 'Invoices go to the shared box' },
    { agentId: 'pam', source: 'task', date: '2026-10-02', id: 'm2', text: 'Check: steps in x.md' }
  ]);
  assert.deepEqual(m.procedures, { pam: 1 });
});

// ─── the plan's real cost, split by share of the work (owner, 2026-10-15) ──

const { planFromAccount, planPrice, planCostFor, scaleSnapshot, DAYS_PER_MONTH } = loadTs('src/shared/claudePlan.ts');
const { readClaudePlan, forgetClaudePlan } = loadTs('src/main/claudeAccount.ts');

test('the plan comes from Claude Code\'s account record, and the owner\'s price wins over the list price', () => {
  // Value: protects=a realistic cost on a plan; fails_when=Max 20x reads as 5x, a team plan gets a made up price, or the owner's price is ignored; why_new=owner 2026-10-15; seam=none; no_claim=current list prices (the owner's figure covers drift)
  assert.equal(planFromAccount({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }), 'max-20x');
  assert.equal(planFromAccount({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' }), 'max-5x');
  assert.equal(planFromAccount({ organizationType: 'claude_pro' }), 'pro');
  assert.equal(planFromAccount({ organizationType: 'claude_team' }), 'team');
  assert.equal(planFromAccount({}), null);
  assert.deepEqual(planPrice('max-20x', undefined), { plan: 'max-20x', label: 'Claude Max 20x', monthly: 200, source: 'detected' });
  assert.deepEqual(planPrice('max-20x', 180), { plan: 'max-20x', label: 'Claude Max 20x', monthly: 180, source: 'owner' });
  assert.equal(planPrice('team', undefined), null, 'a seat priced plan needs the owner\'s figure');
  assert.equal(planPrice('team', 150).monthly, 150);
  assert.equal(planPrice(null, 0), null);
});

test('the period\'s plan cost counts only the days that have passed, and the split keeps each member\'s share', () => {
  // Value: protects=the numbers on a plan; fails_when=a whole week is charged on Monday, a member's share changes, or per piece costs stay at pay per use prices; why_new=owner 2026-10-15; seam=none; no_claim=none beyond protects
  const from = new Date(2026, 9, 12).getTime();
  const to = from + 7 * 86_400_000 - 1;
  assert.ok(Math.abs(planCostFor(200, from, to, from + 3.5 * 86_400_000) - (200 * 3.5) / DAYS_PER_MONTH) < 1e-9);
  assert.ok(Math.abs(planCostFor(200, from, to, to + 86_400_000 * 9) - (200 * 7) / DAYS_PER_MONTH) < 1e-6, 'a past week counts whole');
  const snap = { totalUsd: 100, members: [
    { agentId: 'a', usd: 75, share: 0.75, perPiece: { email: 2 }, costForWork: { kind: 'email', perPiece: 2, usual: 1, verdict: 'pricier', position: 0.9 } },
    { agentId: 'b', usd: 25, share: 0.25, perPiece: {}, costForWork: { kind: null, perPiece: null, usual: null, verdict: 'too-few', position: 0.5 } }
  ] };
  const s = scaleSnapshot(snap, 0.2);
  assert.deepEqual([s.totalUsd, s.members[0].usd, s.members[1].usd, s.members[0].share], [20, 15, 5, 0.75]);
  assert.deepEqual([s.members[0].perPiece.email, s.members[0].costForWork.perPiece, s.members[0].costForWork.usual, s.members[1].costForWork.perPiece], [0.4, 0.4, 0.2, null]);
});

test('the plan is read from plan fields only, and a missing or broken record is no plan', (t) => {
  // Value: protects=detection without touching secrets; fails_when=a token field is read, or a broken file throws; why_new=owner 2026-10-15; seam=temp file; no_claim=Claude Code's future record shape
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-plan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ oauthAccount: { organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x', emailAddress: 'owner@example.com' } }));
  forgetClaudePlan();
  assert.equal(readClaudePlan(1, file), 'max-20x');
  fs.writeFileSync(file, '{ not json');
  forgetClaudePlan();
  assert.equal(readClaudePlan(2, file), null);
  forgetClaudePlan();
  assert.equal(readClaudePlan(3, path.join(dir, 'missing.json')), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/claudeAccount.ts'), 'utf8');
  assert.doesNotMatch(src, /accessToken|refreshToken|credentials/, 'never near a secret');
});

test('Pulse shows the plan\'s cost with the pay per use figure behind the (i), and Settings takes an override', () => {
  // Value: protects=the owner's ask; fails_when=the money line shows pay per use dollars on a known plan, the (i) loses the pay per use figure, or the Settings price is not saved; why_new=owner 2026-10-15; seam=source pins; no_claim=pixel layout
  const view = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/pulse/PulseView.tsx'), 'utf8');
  assert.match(view, /<InfoTip text=\{view\.plan \? t\('pulse\.plan\.tip', \{ monthly: dollars\(view\.plan\.monthly\), payPerUse: money\(view\.plan\.payPerUse\) \}\)/);
  assert.match(view, /t\('pulse\.plan\.ofPlan', \{ plan: view\.plan\.label \?\? t\('pulse\.plan\.yourPlan'\), monthly: dollars\(view\.plan\.monthly\) \}\)/);
  assert.equal((view.match(/<WhoBar /g) || []).length, 2, 'the money card is one total; who spent what is Team at work (owner, 2026-10-15)');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src/main/pulse.ts'), 'utf8');
  assert.match(svc, /const price = billing === 'account' \? this\.planPrice\(\) : null;/, 'an API key shows what was spent');
  assert.match(svc, /scaleSnapshot\(raw, periodCost \/ raw\.totalUsd\)/);
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  assert.match(settings, /\.\.\.planPricePatch\(\),/);
  assert.match(settings, /\{cfgX\.claudeAuth !== 'apiKey' && \(/);
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/i18n/locales/en.json'), 'utf8'));
  assert.match(en.pulse.plan.tip, /\{\{payPerUse\}\} at pay per use prices/);
});

// ─── coverage audit, 2026-10-16: the backfill's rejected frames and floor controls ──

test('the backfill counts only a frame naming the wrong member as an impostor, and keeps reopened cards and trust decisions', () => {
  // Value: protects=Kept safe's sender count from the past, and reopen evidence; fails_when=a no secret or old secret frame logged before 2026-10-15 counts as an impostor, a wrong sender frame is dropped, or a reopen or trust decision is lost; why_new=logPoints' rejected frame rule had no test; seam=none; no_claim=none beyond protects
  const pts = logPoints([
    { ts: 10, kind: 'hook-frame-rejected', reason: 'wrong-sender', agentId: 'god' },
    { ts: 10, kind: 'hook-frame-rejected', reason: 'no-secret', agentId: 'god' },
    { ts: 10, kind: 'hook-frame-rejected', reason: 'old-secret', agentId: 'pam' },
    { ts: 10, kind: 'card-reopen', agentId: 'pam', id: 'c1' },
    { ts: 10, kind: 'trust-layer', way: 'in', decision: 'deny', by: 'model' }
  ], 0, 50, new Set(['pam', 'god']));
  assert.deepEqual(pts.map((p) => [p.kind, p.agentId, p.attrs.gate ?? p.attrs.id ?? p.attrs.decision ?? null, p.attrs.bf]), [
    ['refused', 'god', 'impostor', 1], ['card-reopen', 'pam', 'c1', 1], ['trust', null, 'deny', 1]
  ]);
  assert.deepEqual(trustKeys(pts[2].attrs), ['in-stop'], 'a past decision folds like a live one');
});

test('the backfill keeps a trust line\'s version and reads the hive\'s checked and held lines, so a past message counts once', () => {
  // Value: protects=Kept safe for days before live recording counts each message once (eng D5); fails_when=logPoints drops v (a v 3 line counts again beside its trust-checked line), skips trust-checked or trust-held, or keeps a line with no known way; why_new=checked-list.test.cjs pins the case label only; seam=none; no_claim=the processor fold (pulse-telemetry.test.cjs)
  const { checkedKeys } = loadTs('src/shared/pulseSafety.ts');
  const pts = logPoints([
    { ts: 10, kind: 'trust-layer', way: 'in', decision: 'clean', v: 3 },
    { ts: 10, kind: 'trust-checked', way: 'in', decision: 'clean', flagged: false },
    { ts: 10, kind: 'trust-checked', way: 'out', decision: 'pass', flagged: true },
    { ts: 10, kind: 'trust-held', way: 'out' },
    { ts: 10, kind: 'trust-checked', way: 'up', decision: 'pass' },
    { ts: 10, kind: 'trust-held' }
  ], 0, 50, new Set(['pam']));
  assert.deepEqual(pts.map((p) => [p.kind, p.attrs.way, p.attrs.bf]), [['trust', 'in', 1], ['trust-checked', 'in', 1], ['trust-checked', 'out', 1], ['trust-held', 'out', 1]]);
  assert.equal(pts[0].attrs.v, 3);
  assert.deepEqual(trustKeys(pts[0].attrs), [], 'the v 3 trust line adds nothing');
  assert.deepEqual(checkedKeys(pts[1].attrs), ['in-clean'], 'the hive\'s line counts it, once');
  assert.deepEqual(checkedKeys(pts[2].attrs), ['out-pass', 'out-flagged']);
  assert.ok(!('v' in logPoints([{ ts: 10, kind: 'trust-layer', way: 'in', decision: 'pass' }], 0, 50, new Set())[0].attrs), 'an older line stays unversioned and still counts');
});

test('a step stopped from the floor counts as paused in the backfill, as hooks.ts counts it live', () => {
  // Value: protects=Your rules held reads the same for the weeks before Pulse as after; fails_when=a refusal from the floor's pause or tool gate is filed under the tool's own rule (sandbox, folder, connector) instead of paused, where hooks.ts files every control refusal live; why_new=gateOfTool matched only the pause wording; seam=none (ControlRegistry's own reasons); no_claim=reasons a future control adds
  const { ControlRegistry } = loadTs('src/main/control.ts');
  const c = new ControlRegistry();
  c.pause('dwight', true);
  c.gateTool('pam', 'Bash', true);
  const paused = c.toolDecision('dwight', 'Write');
  const gated = c.toolDecision('pam', 'Bash');
  assert.equal(paused.deny && gated.deny, true);
  assert.equal(gateOfTool('Write', paused.reason), 'paused');
  assert.equal(gateOfTool('Bash', gated.reason), 'paused', 'a gated tool is a floor control, not the sandbox rule');
});
