/**
 * Per-agent schedules (docs/designs/per-agent-schedules.md): the shared rules in
 * src/shared/missions.ts. The armPlan block is the scheduler's regression
 * contract (eng review D6): it pins what syncMissions did before schedules moved
 * onto each agent, plus the two intended changes (a former "everyone" row runs
 * as Michael's relay, and a paused row never fires).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

process.env.TZ = 'UTC';

const M = loadTs('src/shared/missions.ts');
const { scheduledRunBody, relayRunBody } = loadTs('src/shared/scheduleMessage.ts');

const HOUR = 3_600_000;
const at = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min)).getTime();
const ctx = { standupId: 'ops-standup', standupFiredThisLaunch: true };
const mk = (over = {}) => ({ id: 'm1', label: 'Triage the inbox', intervalMs: HOUR, to: 'pam', body: '', enabled: true, ...over });

/* ─────────────────────────── ownership ─────────────────────────── */

test('ownerOf: Michael owns god and legacy broadcast rows', () => {
  assert.equal(M.ownerOf({ to: 'god' }, 'god'), 'god');
  assert.equal(M.ownerOf({ to: 'broadcast' }, 'g1'), 'g1');
  assert.equal(M.ownerOf({ to: 'pam' }, 'god'), 'pam');
});

test('missionsFor lists only that agent\'s schedules', () => {
  const list = [mk({ id: 'a' }), mk({ id: 'b', to: 'oscar' }), mk({ id: 'c', to: 'god' })];
  assert.deepEqual(M.missionsFor(list, 'pam', 'god').map((m) => m.id), ['a']);
  assert.deepEqual(M.missionsFor(list, 'god', 'god').map((m) => m.id), ['c']);
});

test('canEdit: own schedule only', () => {
  assert.equal(M.canEdit('pam', mk(), 'god'), true);
  assert.equal(M.canEdit('oscar', mk(), 'god'), false);
  assert.equal(M.canEdit('god', mk({ to: 'god' }), 'god'), true);
});

/* ─────────────────────────── migration ─────────────────────────── */

test('migrateMissions: everyone rows become Michael\'s relay, rows get createdBy owner', () => {
  const r = M.migrateMissions([mk({ id: 'a', to: 'broadcast', enabled: false }), mk({ id: 'b' })]);
  assert.equal(r.changed, true);
  assert.deepEqual(r.missions[0], { ...mk({ id: 'a', enabled: false }), to: 'god', relay: true, createdBy: 'owner' });
  assert.equal(r.missions[0].enabled, false, 'a paused everyone row stays paused');
  assert.equal(r.missions[1].createdBy, 'owner');
});

test('migrateMissions is idempotent', () => {
  const once = M.migrateMissions([mk({ to: 'broadcast' }), mk({ id: 'x', createdBy: 'pam' })]).missions;
  const twice = M.migrateMissions(once);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.missions, once);
  assert.equal(once[1].createdBy, 'pam', 'an agent-added row keeps its creator');
});

/* ────────────────── scheduler regression contract (D6) ────────────────── */

test('armPlan: disabled never arms', () => {
  assert.deepEqual(M.armPlan(mk({ enabled: false }), 0, ctx), { type: 'skip' });
});

test('armPlan: no interval and no weekly never arms', () => {
  assert.deepEqual(M.armPlan(mk({ intervalMs: 0 }), 0, ctx), { type: 'skip' });
});

test('armPlan: heartbeat arms its own adaptive timer, even with a weekly value', () => {
  assert.deepEqual(M.armPlan(mk({ kind: 'heartbeat', weekly: { days: [1], minute: 540 } }), 0, ctx), { type: 'heartbeat' });
});

test('armPlan: interval honors lastFiredAt', () => {
  const now = 10 * HOUR;
  assert.deepEqual(M.armPlan(mk({ lastFiredAt: now - 20 * 60_000 }), now, ctx), { type: 'interval', firstDelayMs: 40 * 60_000, everyMs: HOUR });
  assert.equal(M.armPlan(mk({ lastFiredAt: now - 3 * HOUR }), now, ctx).firstDelayMs, 0, 'overdue fires now');
  assert.equal(M.armPlan(mk(), now, ctx).firstDelayMs, 0, 'never fired fires now');
});

test('armPlan: the standup waits a full interval until the office opens', () => {
  const standup = mk({ id: 'ops-standup', to: 'god', lastFiredAt: 0 });
  assert.equal(M.armPlan(standup, 10 * HOUR, { ...ctx, standupFiredThisLaunch: false }).firstDelayMs, HOUR);
  assert.equal(M.armPlan(standup, 10 * HOUR, ctx).firstDelayMs, 0);
});

test('armPlan: weekly waits for the next slot', () => {
  const monday9 = { days: [1], minute: 540 };
  const now = at(2026, 9, 21, 8, 0); // a Monday, 08:00
  assert.deepEqual(M.armPlan(mk({ weekly: monday9 }), now, ctx), { type: 'weekly', weekly: monday9, firstDelayMs: HOUR });
});

test('armPlan: weekly catches up a slot missed within the window, once', () => {
  const monday9 = { days: [1], minute: 540 };
  const now = at(2026, 9, 21, 9, 30);
  assert.equal(M.armPlan(mk({ weekly: monday9 }), now, ctx).firstDelayMs, 0, 'missed 30m ago: fire now');
  const done = M.armPlan(mk({ weekly: monday9, lastFiredAt: at(2026, 9, 21, 9, 0) }), now, ctx);
  assert.ok(done.firstDelayMs > 6 * 24 * HOUR, 'already ran: wait for next week');
});

test('firePayload: standard body, relay body for a former everyone row, none for compaction', () => {
  assert.deepEqual(M.firePayload(mk()), { to: 'pam', subject: 'Triage the inbox', body: scheduledRunBody('Triage the inbox', '') });
  const relay = M.firePayload(mk({ to: 'god', relay: true, body: 'old words' }));
  assert.equal(relay.to, 'god');
  assert.equal(relay.body, relayRunBody('Triage the inbox', 'old words'));
  assert.match(relay.body, /Hand this job to each team member/);
  assert.equal(M.firePayload(mk({ kind: 'compact' })), null);
});

test('nextRunAt matches the armed schedule', () => {
  const now = at(2026, 9, 21, 8, 0);
  assert.equal(M.nextRunAt(mk({ weekly: { days: [1], minute: 540 } }), now), at(2026, 9, 21, 9, 0));
  assert.equal(M.nextRunAt(mk({ lastFiredAt: now }), now), now + HOUR);
  assert.equal(M.nextRunAt(mk(), now), null, 'an interval that never fired cannot say');
  assert.equal(M.nextRunAt(mk({ enabled: false, lastFiredAt: now }), now), null);
});

/* ──────────────────────── one-schedule edits (R2) ──────────────────────── */

test('upsert never drops a schedule it did not name', () => {
  const list = [mk({ id: 'a' }), mk({ id: 'b', to: 'oscar', createdBy: 'oscar' })];
  const next = M.upsertMission(list, mk({ id: 'a', label: 'Renamed' }));
  assert.deepEqual(next.map((m) => m.id), ['a', 'b']);
  assert.equal(next[0].label, 'Renamed');
  assert.equal(next[1].createdBy, 'oscar');
});

test('upsert keeps the newer lastFiredAt and the original creator', () => {
  const list = [mk({ id: 'a', lastFiredAt: 500, createdBy: 'pam' })];
  const next = M.upsertMission(list, mk({ id: 'a', lastFiredAt: 100, createdBy: 'owner' }));
  assert.equal(next[0].lastFiredAt, 500);
  assert.equal(next[0].createdBy, 'pam');
});

test('upsert with weekly undefined switches back to the interval', () => {
  const list = [mk({ id: 'a', weekly: { days: [1], minute: 540 } })];
  const next = M.upsertMission(list, { ...mk({ id: 'a' }), weekly: undefined });
  assert.equal('weekly' in next[0], false);
});

test('upsert adds a new schedule as the owner\'s', () => {
  const next = M.upsertMission([], mk({ id: 'n' }));
  assert.equal(next[0].createdBy, 'owner');
});

test('delete and setEnabled touch one schedule only', () => {
  const list = [mk({ id: 'a' }), mk({ id: 'b' })];
  assert.deepEqual(M.deleteMission(list, 'a').map((m) => m.id), ['b']);
  assert.deepEqual(M.setMissionEnabled(list, 'b', false).map((m) => m.enabled), [true, false]);
  assert.equal(M.setMissionEnabled(list, 'zzz', false), null);
});

test('pauseMissionsOf pauses only that agent\'s enabled schedules', () => {
  const list = [mk({ id: 'a' }), mk({ id: 'b', enabled: false }), mk({ id: 'c', to: 'oscar' })];
  const r = M.pauseMissionsOf(list, 'pam', 'god');
  assert.equal(r.paused, 1);
  assert.deepEqual(r.missions.map((m) => m.enabled), [false, false, true]);
});

/* ──────── a slot from before a schedule's times were set never runs ──────── */

// Tuesday 13 October 2026. Each job below is set after its slot has passed.
const weekdaysAt = (h, min = 0) => ({ days: [1, 2, 3, 4, 5], minute: h * 60 + min });
const TUE = (h, min = 0) => at(2026, 10, 13, h, min);

test('a new job waits for its next slot instead of running one that passed before it was added', () => {
  const now = TUE(18, 2);
  const added = M.upsertMission([], mk({ id: 'n', weekly: weekdaysAt(17) }), now)[0];
  assert.equal(added.scheduledSince, now);
  assert.equal(M.armPlan(added, now, ctx).firstDelayMs, at(2026, 10, 14, 17, 0) - now, 'tomorrow 17:00');
});

test('a new job with several "when" lines waits too', () => {
  const now = TUE(18, 2);
  const times = [{ kind: 'at', days: [1, 2, 3, 4, 5], minute: 17 * 60 }, { kind: 'at', days: [0, 6], minute: 14 * 60 }];
  const added = M.upsertMission([], mk({ id: 'n', times }), now)[0];
  assert.equal(M.armPlan(added, now, ctx).firstDelayMs, at(2026, 10, 14, 17, 0) - now);
});

test('moving a job that ran today to a slot that has passed does not run it twice', () => {
  const ran = mk({ id: 'a', weekly: weekdaysAt(9), lastFiredAt: TUE(9), scheduledSince: TUE(8) - 24 * HOUR });
  const now = TUE(10);
  const moved = M.upsertMission([ran], { ...ran, weekly: weekdaysAt(9, 30) }, now)[0];
  assert.equal(moved.scheduledSince, now);
  assert.equal(M.armPlan(moved, now, ctx).firstDelayMs, at(2026, 10, 14, 9, 30) - now);
});

test('turning a job back on does not run the slot that passed while it was off', () => {
  const paused = mk({ id: 'a', enabled: false, weekly: weekdaysAt(9), lastFiredAt: TUE(9) - 24 * HOUR });
  const now = TUE(14, 30);
  const resumed = M.setMissionEnabled([paused], 'a', true, now)[0];
  assert.equal(M.armPlan(resumed, now, ctx).firstDelayMs, at(2026, 10, 14, 9, 0) - now);
  const viaEdit = M.upsertMission([paused], { ...paused, enabled: true }, now)[0];
  assert.equal(M.armPlan(viaEdit, now, ctx).firstDelayMs, at(2026, 10, 14, 9, 0) - now);
});

test('an approved add or resume from an agent waits for the next slot too', () => {
  const now = TUE(18, 2);
  const add = M.buildScheduleRequest('pam', { op: 'add', label: 'Chase invoices', when: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], at: '17:00' }, focus: 'Unpaid ones' }, [], 'god', 0, 'r', 'why').request;
  const added = M.applyScheduleRequest(add, [], 'new1', now).missions[0];
  assert.equal(M.armPlan(added, now, ctx).firstDelayMs, at(2026, 10, 14, 17, 0) - now);
  const paused = [mk({ enabled: false, weekly: weekdaysAt(9) })];
  const resume = M.buildScheduleRequest('pam', { op: 'resume', id: 'm1' }, paused, 'god', 0, 'r', 'why').request;
  const resumed = M.applyScheduleRequest(resume, paused, 'x', TUE(14, 30)).missions[0];
  assert.equal(M.armPlan(resumed, TUE(14, 30), ctx).firstDelayMs, at(2026, 10, 14, 9, 0) - TUE(14, 30));
});

test('a rename or focus edit keeps when the times were set, and a client cannot move it', () => {
  const since = TUE(8) - 24 * HOUR;
  const job = mk({ id: 'a', weekly: weekdaysAt(9), scheduledSince: since });
  const renamed = M.upsertMission([job], { ...job, label: 'Renamed', focus: 'New focus' }, TUE(9, 30))[0];
  assert.equal(renamed.scheduledSince, since);
  const forged = M.upsertMission([job], { ...job, scheduledSince: 0 }, TUE(9, 30))[0];
  assert.equal(forged.scheduledSince, since, 'the stored value wins over what the renderer sends');
  const reordered = M.upsertMission([job], { ...job, weekly: { days: [5, 4, 3, 2, 1], minute: 540 } }, TUE(9, 30))[0];
  assert.equal(reordered.scheduledSince, since, 'the same days in another order are the same times');
});

test('an approved change of times from an agent counts as new times', () => {
  const since = TUE(8) - 24 * HOUR;
  const list = [mk({ weekly: weekdaysAt(9), scheduledSince: since })];
  const req = (p) => M.buildScheduleRequest('pam', p, list, 'god', 0, 'r', 'why').request;
  const now = TUE(10);
  const retimed = M.applyScheduleRequest(req({ op: 'update', id: 'm1', when: { days: ['tue'], at: '09:30' } }), list, 'x', now).missions[0];
  assert.equal(retimed.scheduledSince, now);
  assert.equal(M.armPlan(retimed, now, ctx).firstDelayMs, at(2026, 10, 20, 9, 30) - now, 'next Tuesday 09:30');
  const refocused = M.applyScheduleRequest(req({ op: 'update', id: 'm1', focus: 'Only the big ones' }), list, 'x', now).missions[0];
  assert.equal(refocused.scheduledSince, since, 'a focus change keeps its times');
});

test('a slot missed while the app was closed still runs once', () => {
  // Set yesterday, app closed through today's 09:00, opened at 09:30.
  const job = mk({ id: 'a', weekly: weekdaysAt(9), scheduledSince: TUE(8) - 24 * HOUR, lastFiredAt: TUE(9) - 24 * HOUR });
  assert.equal(M.armPlan(job, TUE(9, 30), ctx).firstDelayMs, 0);
  assert.equal(M.catchUpFloor(job), TUE(9) - 24 * HOUR, 'the later of the last run and when the times were set');
  assert.equal(M.catchUpFloor(mk()), 0, 'a row from before this existed keeps the old rule');
});

/* ─────────────────── agent schedule requests (R3, R6) ─────────────────── */

test('parseWhen reads intervals and day lists', () => {
  assert.deepEqual(M.parseWhen({ every: '2h' }), { intervalMs: 2 * HOUR });
  assert.deepEqual(M.parseWhen({ every: '30 min' }), { intervalMs: 30 * 60_000 });
  assert.deepEqual(M.parseWhen({ days: ['weekdays'], at: '09:00' }).weekly, { days: [1, 2, 3, 4, 5], minute: 540 });
  assert.deepEqual(M.parseWhen({ days: ['Friday', 'mon'], at: '7:30' }).weekly, { days: [1, 5], minute: 450 });
  assert.equal(M.parseWhen({ every: '0m' }), null);
  assert.equal(M.parseWhen({ every: 'soon' }), null);
  assert.equal(M.parseWhen({ days: ['someday'], at: '09:00' }), null);
  assert.deepEqual(M.parseWhen({ days: ['tues', 'THURS'], at: '09:00' }).weekly, { days: [2, 4], minute: 540 });
  assert.equal(M.parseWhen({ days: ['monthly'], at: '09:00' }), null);
  assert.equal(M.parseWhen({ days: ['month-end'], at: '09:00' }), null);
  assert.equal(M.parseWhen({ days: ['sunset'], at: '09:00' }), null);
  assert.equal(M.parseWhen({ days: ['mo'], at: '09:00' }), null);
  assert.deepEqual(M.parseWhen({ days: ['Mondays', 'weds', 'fri.'], at: '09:00' }).weekly, { days: [1, 3, 5], minute: 540 });
  assert.deepEqual(M.parseWhen({ days: ['mon.', 'Sundays'], at: '09:00' }).weekly, { days: [0, 1], minute: 540 });
  assert.equal(M.parseWhen({ days: ['mon'], at: '25:00' }), null);
  assert.equal(M.parseWhen(null), null);
});

test('an add request proposes, and writes nothing', () => {
  const list = [mk()];
  const r = M.buildScheduleRequest('pam', { op: 'add', label: 'Check invoices', when: { days: ['fri'], at: '09:00' }, focus: '  Unpaid  past 30 days. ' }, list, 'god', 5, 'r1', 'why');
  assert.equal(r.ok, true);
  assert.deepEqual(r.request, { id: 'r1', agentId: 'pam', op: 'add', draft: { label: 'Check invoices', intervalMs: 86_400_000, weekly: { days: [5], minute: 540 }, focus: 'Unpaid past 30 days.' }, createdAt: 5, reason: 'why' });
  assert.equal(list.length, 1, 'building a request never touches the list');
});

test('requests about another agent\'s schedule are refused', () => {
  const r = M.buildScheduleRequest('oscar', { op: 'pause', id: 'm1' }, [mk()], 'god', 0, 'r', 'why');
  assert.equal(r.ok, false);
  assert.match(r.reason, /another team member/);
});

test('malformed and unknown requests are refused with a reason', () => {
  const bad = (p) => M.buildScheduleRequest('pam', p, [mk()], 'god', 0, 'r', 'why');
  assert.equal(bad(null).ok, false);
  assert.equal(bad({ op: 'explode' }).ok, false);
  assert.equal(bad({ op: 'add', when: { every: '1h' } }).ok, false, 'no label');
  assert.equal(bad({ op: 'add', label: 'x', when: { every: 'never' } }).ok, false, 'bad when');
  assert.equal(bad({ op: 'delete', id: 'nope' }).ok, false, 'unknown id');
  assert.equal(bad({ op: 'update', id: 'm1' }).ok, false, 'update with nothing new');
  assert.equal(bad({ op: 'add', label: 'x'.repeat(81), when: { every: '1h' }, focus: 'f' }).ok, false, 'label too long');
  assert.match(bad({ op: 'add', label: 'x', when: { every: '1h' } }).reason, /An add needs a "focus"/, 'a new job needs its focus area (FA1)');
  assert.match(bad({ op: 'add', label: 'x', when: { every: '1h' }, focus: 'f'.repeat(601) }).reason, /under 600/);
});

test('approve applies an add exactly once, as the agent\'s', () => {
  const req = M.buildScheduleRequest('pam', { op: 'add', label: 'Check invoices', when: { every: '1d' }, focus: 'Unpaid ones' }, [], 'god', 0, 'r', 'why').request;
  const r = M.applyScheduleRequest(req, [], 'new1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.missions, [{ id: 'new1', label: 'Check invoices', intervalMs: 86_400_000, focus: 'Unpaid ones', to: 'pam', body: '', enabled: true, createdBy: 'pam' }]);
});

test('approve applies update, pause, resume and delete', () => {
  const list = [mk()];
  const req = (p) => M.buildScheduleRequest('pam', p, list, 'god', 0, 'r', 'why').request;
  assert.equal(M.applyScheduleRequest(req({ op: 'pause', id: 'm1' }), list, 'x').missions[0].enabled, false);
  assert.deepEqual(M.applyScheduleRequest(req({ op: 'delete', id: 'm1' }), list, 'x').missions, []);
  const up = M.applyScheduleRequest(req({ op: 'update', id: 'm1', when: { days: ['mon'], at: '08:00' } }), list, 'x').missions[0];
  assert.deepEqual(up.weekly, { days: [1], minute: 480 });
  assert.equal(up.label, 'Triage the inbox', 'a when-only update keeps the label');
  const paused = [mk({ enabled: false })];
  const resume = M.buildScheduleRequest('pam', { op: 'resume', id: 'm1' }, paused, 'god', 0, 'r', 'why').request;
  assert.equal(M.applyScheduleRequest(resume, paused, 'x').missions[0].enabled, true);
});

test('a request whose schedule changed since is stale and never applies', () => {
  const list = [mk()];
  const req = M.buildScheduleRequest('pam', { op: 'pause', id: 'm1' }, list, 'god', 0, 'r', 'why').request;
  const edited = [mk({ label: 'Owner renamed it' })];
  assert.equal(M.requestIsStale(req, edited), true);
  assert.deepEqual(M.applyScheduleRequest(req, edited, 'x'), { ok: false, error: 'stale' });
  assert.equal(M.requestIsStale(req, []), true, 'deleted since');
  assert.equal(M.requestIsStale(req, list), false);
});

test('armPlan: an hourly job closed overnight fires once on opening, never once per missed hour (owner, 2026-09-26)', () => {
  const H = 3_600_000;
  const closedAt = Date.UTC(2026, 8, 27, 2, 0);            // 9:00 pm Central
  const openedAt = closedAt + 10 * H + 15 * 60_000;        // 7:15 am next day
  const plan = M.armPlan(mk({ id: 'check-mail', intervalMs: H, lastFiredAt: closedAt }), openedAt, { standupId: 'ops-standup', standupFiredThisLaunch: false });
  assert.equal(plan.type, 'interval');
  assert.equal(plan.firstDelayMs, 0, 'one catch-up run at 7:15');
  assert.equal(plan.everyMs, H, 'then every hour from 7:15, with no backlog of the ten missed runs');
});
