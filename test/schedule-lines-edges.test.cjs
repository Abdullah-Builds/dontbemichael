'use strict';

/**
 * Edges of several "when" lines per job (src/shared/scheduleTimes.ts) and of
 * joining an agent's schedule requests into one card (src/shared/missions.ts
 * fileScheduleRequest, whenWords, requestSummary). The happy paths live in
 * schedule-times.test.cjs; this file walks the refusals and fallbacks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const T = loadTs('src/shared/scheduleTimes.ts');
const M = loadTs('src/shared/missions.ts');

const H = 3_600_000;
const DAY = 86_400_000;
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime(); // Sep 2026: 26 Sat, 27 Sun, 28 Mon

// ─── normalizeLine / normalizeTimes refusals ─────────────────────────────────

test('a line that is not an object, or of no known kind, is refused', () => {
  for (const bad of [null, undefined, 5, 'every 2h', { kind: 'sometimes', everyMs: H }]) assert.equal(T.normalizeLine(bad), null, String(bad));
});

test('an every line needs whole minutes between 1 minute and 1 day', () => {
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: 30_000 }), null, 'under a minute');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: 90_500 }), null, 'not whole minutes');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: DAY + 60_000 }), null, 'over a day');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: Number.NaN }), null);
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: '2h' }), null);
  assert.deepEqual(T.normalizeLine({ kind: 'every', everyMs: DAY }), { kind: 'every', everyMs: DAY });
  assert.deepEqual(T.normalizeLine({ kind: 'every', everyMs: 60_000 }), { kind: 'every', everyMs: 60_000 });
});

test('an every line window needs both ends, in range; its days are cleaned', () => {
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, from: 480 }), null, 'from without to');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, to: 1080 }), null, 'to without from');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, from: 480, to: 1440 }), null, 'past midnight');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, from: 8.5, to: 1080 }), null);
  assert.deepEqual(T.normalizeLine({ kind: 'every', everyMs: H, from: 600, to: 600 }), { kind: 'every', everyMs: H, from: 600, to: 600 }, 'a one slot window');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, days: [] }), null, 'no days');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, days: [7, -1, 'mon'] }), null, 'only junk days');
  assert.equal(T.normalizeLine({ kind: 'every', everyMs: H, days: 'weekdays' }), null);
  assert.deepEqual(T.normalizeLine({ kind: 'every', everyMs: H, days: [5, 1, 5, 9] }), { kind: 'every', everyMs: H, days: [1, 5] }, 'sorted, deduped, junk dropped');
});

test('a set of lines is refused when empty, not a list, or longer than MAX_LINES', () => {
  assert.equal(T.normalizeTimes(undefined), null);
  assert.equal(T.normalizeTimes({ kind: 'at', days: [1], minute: 60 }), null);
  const at9 = (m) => ({ kind: 'at', days: [1], minute: m });
  assert.equal(T.normalizeTimes(Array.from({ length: T.MAX_LINES }, (_, i) => at9(i))).length, T.MAX_LINES);
  assert.equal(T.normalizeTimes(Array.from({ length: T.MAX_LINES + 1 }, (_, i) => at9(i))), null);
});

test('two every lines on the same day clash; lineDays for an at line without days is empty', () => {
  assert.deepEqual(T.clashingDays([{ kind: 'every', everyMs: H, days: [1] }, { kind: 'every', everyMs: 2 * H, days: [1, 2] }]), [1]);
  assert.deepEqual(T.clashingDays([{ kind: 'every', everyMs: H }, { kind: 'at', days: [3], minute: 60 }]), [3], 'a plain every line holds all 7 days');
  assert.deepEqual(T.lineDays({ kind: 'at' }), []);
  assert.deepEqual(T.lineDays({ kind: 'every' }), [0, 1, 2, 3, 4, 5, 6]);
});

test('a long every line that gains a second line or a window is shortened to a day, so it can still be saved', () => {
  // "Add time" on a plain "every 3d" moves it to weekdays and adds a weekend line.
  const added = [{ kind: 'every', everyMs: 3 * DAY, days: [1, 2, 3, 4, 5] }, { kind: 'at', days: [0, 6], minute: 840 }];
  assert.equal(T.normalizeTimes(added), null, 'three days is too long once it shares the schedule');
  const capped = T.capEveryLines(added);
  assert.deepEqual(capped, [{ kind: 'every', everyMs: DAY, days: [1, 2, 3, 4, 5] }, added[1]]);
  assert.ok(T.normalizeTimes(capped), 'the shortened schedule saves');
  assert.ok(T.normalizeTimes(T.capEveryLines([{ kind: 'every', everyMs: 3 * DAY, from: 480, to: 1080 }])), 'a window too');
  // A line already a day or shorter, and an at line, are left as they are.
  const fine = [{ kind: 'every', everyMs: 2 * H, days: [1] }, { kind: 'at', days: [0], minute: 60 }];
  assert.deepEqual(T.capEveryLines(fine), fine);
  // The editor applies it on every change that leaves the plain shape.
  const ui = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/triggers/WhenLines.tsx'), 'utf8');
  assert.match(ui, /const kept = isPlainEvery\(next\) \? next : capEveryLines\(next\);[\s\S]*?emit\(kept\)/);
});

test('when the cap shortens a line, the owner is told under that line, and only then', () => {
  // Value: protects=a job never runs three times as often without the owner seeing why; fails_when=the cap is silent, or the note shows when nothing changed; why_new=owner review on #329; seam=pure helper plus source pin
  const added = [{ kind: 'every', everyMs: 3 * DAY, days: [1, 2, 3, 4, 5] }, { kind: 'at', days: [0, 6], minute: 840 }];
  assert.equal(T.cappedLine(added, T.capEveryLines(added)), 0, 'the line that changed');
  const fine = [{ kind: 'every', everyMs: 2 * H, days: [1] }, { kind: 'at', days: [0], minute: 60 }];
  assert.equal(T.cappedLine(fine, T.capEveryLines(fine)), -1, 'nothing changed, no note');
  const ui = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/components/triggers/WhenLines.tsx'), 'utf8');
  assert.match(ui, /setCappedAt\(cappedLine\(next, kept\)\)/, 'set on each change, so the next edit clears it');
  assert.match(ui, /cappedAt === i && <Hint>\{t\('triggersUi\.everyCapped'\)\}<\/Hint>/);
  for (const l of ['en', 'ar', 'zh-CN']) {
    const text = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', `src/renderer/src/i18n/locales/${l}.json`), 'utf8')).triggersUi.everyCapped;
    assert.ok(text, l);
    assert.doesNotMatch(text, /[\u2010-\u2015]| - /, `${l}: no dashes`);
  }
});

// ─── simpleTimes ─────────────────────────────────────────────────────────────

test('simpleTimes stores only what the old fields can say', () => {
  assert.deepEqual(T.simpleTimes([{ kind: 'every', everyMs: 2 * H }]), { intervalMs: 2 * H });
  assert.deepEqual(T.simpleTimes([{ kind: 'at', days: [5], minute: 540 }]), { weekly: { days: [5], minute: 540 } });
  assert.equal(T.simpleTimes([{ kind: 'every', everyMs: H, days: [1] }]), null, 'days need times');
  assert.equal(T.simpleTimes([{ kind: 'every', everyMs: H, from: 480, to: 1080 }]), null, 'a window needs times');
  assert.equal(T.simpleTimes([{ kind: 'at', days: [1], minute: 1 }, { kind: 'at', days: [2], minute: 1 }]), null);
});

// ─── slots ───────────────────────────────────────────────────────────────────

test('an every line whose step does not divide the window stops inside it', () => {
  const lines = [{ kind: 'every', everyMs: 3 * H, from: 8 * 60, to: 18 * 60 }];
  assert.equal(T.nextTimesFireMs(lines, at(28, 16)), at(28, 17));
  assert.equal(T.nextTimesFireMs(lines, at(28, 17)), at(29, 8), 'no 20:00 slot');
  assert.equal(T.previousTimesFireMs(lines, at(29, 7)), at(28, 17));
});

test('an at line once a week looks back and ahead across days', () => {
  const fri = [{ kind: 'at', days: [5], minute: 9 * 60 }];
  assert.equal(T.nextTimesFireMs(fri, at(26, 10)), new Date(2026, 9, 2, 9).getTime(), 'Sat to next Fri');
  assert.equal(T.previousTimesFireMs(fri, at(28, 10)), at(25, 9), 'Mon back to Fri');
  assert.equal(T.nextTimesFireMs(fri, at(25, 9)), new Date(2026, 9, 2, 9).getTime(), 'strictly after the slot itself');
  assert.equal(T.previousTimesFireMs(fri, at(25, 9)), at(25, 9), 'at the slot counts as previous');
});

test('a slot missed longer ago than the catch up window is not run late', () => {
  const fri = [{ kind: 'at', days: [5], minute: 9 * 60 }];
  // Opened Monday: Friday's slot never ran but is days old, so wait for next Friday.
  assert.equal(T.timesDelayMs(fri, at(28, 10), 0), new Date(2026, 9, 2, 9).getTime() - at(28, 10));
  // Missed by a minute and never run: now.
  assert.equal(T.timesDelayMs(fri, at(25, 9, 1), 0), 0);
  // Missed by a minute but already run at the slot: next week.
  assert.equal(T.timesDelayMs(fri, at(25, 9, 1), at(25, 9)), new Date(2026, 9, 2, 9).getTime() - at(25, 9, 1));
});

test('several lines on the same minute make one slot', () => {
  const lines = [{ kind: 'at', days: [1], minute: 600 }, { kind: 'every', everyMs: 2 * H, days: [2], from: 600, to: 600 }];
  assert.equal(T.nextTimesFireMs(lines, at(28, 9)), at(28, 10));
  assert.equal(T.nextTimesFireMs(lines, at(28, 10)), at(29, 10));
});

// ─── words ───────────────────────────────────────────────────────────────────

test('intervals and lines read as words', () => {
  assert.equal(T.formatEvery(DAY), '1d');
  assert.equal(T.formatEvery(3 * H), '3h');
  assert.equal(T.formatEvery(90 * 60_000), '90m');
  assert.equal(T.formatLine({ kind: 'every', everyMs: H }), 'every 1h');
  assert.equal(T.formatLine({ kind: 'at', days: [0, 1, 2, 3, 4, 5, 6], minute: 0 }), 'every day at 00:00');
  assert.equal(T.formatTimes([
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 840 },
    { kind: 'every', everyMs: 30 * 60_000, days: [0, 6] },
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 480 },
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 720 },
    { kind: 'at', days: [1, 2, 3, 4, 5], minute: 480 }
  ]), 'weekdays at 08:00, 12:00 and 14:00, every 30m weekends', 'grouped in order of first appearance, sorted and deduped');
  const words = T.formatTimes([{ kind: 'every', everyMs: 2 * H, days: [1, 2, 3, 4, 5], from: 480, to: 1080 }, { kind: 'at', days: [0, 6], minute: 840 }]);
  assert.doesNotMatch(words, /[–—]| - /, 'no dashes in words the owner reads');
});

test('whenWords reads times, then weekly, then the interval', () => {
  assert.equal(M.whenWords({ intervalMs: 2 * H }), 'every 2h');
  assert.equal(M.whenWords({ intervalMs: DAY, weekly: { days: [1, 2, 3, 4, 5], minute: 480 } }), 'weekdays at 08:00');
  assert.equal(M.whenWords({ intervalMs: DAY, weekly: { days: [5], minute: 540 }, times: [{ kind: 'at', days: [0, 6], minute: 840 }] }), 'weekends at 14:00');
  assert.equal(M.whenWords({ intervalMs: 3 * H, times: [{ kind: 'bogus' }] }), 'every 3h', 'bad times fall back');
});

// ─── parseWhen refusals ──────────────────────────────────────────────────────

test('parseWhen refuses what it cannot run on a clock', () => {
  assert.equal(M.parseWhen({ every: '0m' }), null);
  assert.equal(M.parseWhen({ every: '25d' }), null, 'longer than 24 days');
  assert.deepEqual(M.parseWhen({ every: '24d' }), { intervalMs: 24 * DAY });
  assert.equal(M.parseWhen({ every: '2d', days: ['mon'] }), null, 'a limited every is at most a day');
  assert.equal(M.parseWhen({ every: '2h', between: ['08:00'] }), null);
  assert.equal(M.parseWhen({ every: '2h', between: '08:00-18:00' }), null);
  assert.equal(M.parseWhen({ every: '2h', between: ['8am', '18:00'] }), null);
  assert.equal(M.parseWhen({ every: '2h', days: ['someday'] }), null);
  assert.equal(M.parseWhen({ every: '2h', days: [] }), null);
  assert.equal(M.parseWhen({ days: ['mon', 3], at: '09:00' }), null);
  assert.equal(M.parseWhen({ days: ['mon'], at: '09:75' }), null);
  assert.equal(M.parseWhen({ days: ['mon'], at: '24:00' }), null);
  assert.equal(M.parseWhen([]), null);
  assert.equal(M.parseWhen(null), null);
  assert.equal(M.parseWhen([{ days: ['mon'], at: '09:00' }, null]), null);
});

test('parseWhen keeps several lines as times, with the first every as the interval', () => {
  const r = M.parseWhen([{ days: ['sat'], at: '10:00' }, { every: '90m', days: ['weekdays'] }]);
  assert.equal(r.intervalMs, 90 * 60_000);
  assert.equal(r.times.length, 2);
  const onlyAt = M.parseWhen([{ days: ['mon'], at: '09:00' }, { days: ['tue'], at: '10:00' }]);
  assert.equal(onlyAt.intervalMs, DAY, 'no every line: a day');
  assert.deepEqual(M.parseWhen({ days: ['Daily'], at: '07:30' }), { intervalMs: DAY, weekly: { days: [0, 1, 2, 3, 4, 5, 6], minute: 450 } });
});

// ─── fileScheduleRequest ─────────────────────────────────────────────────────

const job = { id: 'm1', label: 'Check Emails', intervalMs: 2 * H, to: 'nick', body: '', enabled: true, createdBy: 'owner' };
// Every add carries its focus area (schedule-focus-areas.md, FA1).
const req = (agent, payload, n, why = 'why') => {
  const b = M.buildScheduleRequest(agent, payload.op === 'add' && !payload.focus ? { ...payload, focus: 'the job' } : payload, [job], 'god', n, `r${n}`, why);
  assert.equal(b.ok, true, JSON.stringify(b));
  return b.request;
};

test('two requests whose times clash: the newer replaces the older, both reasons kept', () => {
  const a = req('nick', { op: 'update', id: 'm1', when: { every: '2h', days: ['weekdays', 'sat'] } }, 1, 'Busy weekdays.');
  const b = req('nick', { op: 'add', label: 'check emails', when: { days: ['weekends'], at: '14:00' } }, 2, 'Weekend check.');
  const filed = M.fileScheduleRequest([a], b, [job]);
  assert.equal(filed.length, 1);
  assert.equal(filed[0].id, 'r2');
  assert.equal(filed[0].op, 'add', 'the latest intent, as asked');
  assert.equal(filed[0].reason, 'Busy weekdays. Weekend check.');
});

test('the same reason twice is written once; two identical plain intervals stay plain', () => {
  const a = req('nick', { op: 'update', id: 'm1', when: { every: '1h' } }, 1, 'Same.');
  const b = req('nick', { op: 'update', id: 'm1', when: { every: '1h' } }, 2, 'Same.');
  const [merged] = M.fileScheduleRequest([a], b, [job]);
  assert.equal(merged.reason, 'Same.');
  assert.equal(merged.draft.intervalMs, H);
  assert.equal(merged.draft.times, undefined);
  assert.equal(merged.draft.weekly, undefined);
  assert.equal(merged.id, 'r2');
  assert.equal(merged.createdAt, 2);
  assert.equal(merged.missionId, 'm1', 'still names the schedule it changes');
});

test('two adds at the same weekly time merge back into a weekly draft', () => {
  const a = req('nick', { op: 'add', label: 'Backup', when: { days: ['fri'], at: '09:00' } }, 1);
  const b = req('nick', { op: 'add', label: 'Backup', when: { days: ['fri'], at: '09:00' } }, 2);
  const [merged] = M.fileScheduleRequest([a], b, [job]);
  assert.deepEqual(merged.draft, { label: 'Backup', intervalMs: DAY, weekly: { days: [5], minute: 540 }, focus: 'the job' }, 'the focus rides along');
});

test('an interval longer than a day cannot join another line, so the newer replaces it', () => {
  const a = req('nick', { op: 'add', label: 'Archive', when: { every: '3d' } }, 1);
  const b = req('nick', { op: 'add', label: 'Archive', when: { days: ['mon'], at: '09:00' } }, 2);
  const filed = M.fileScheduleRequest([a], b, [job]);
  assert.equal(filed.length, 1);
  assert.deepEqual(filed[0].draft.weekly, { days: [1], minute: 540 });
  assert.equal(filed[0].draft.times, undefined);
});

test('different jobs, or the same job from another agent, stay separate cards', () => {
  const a = req('nick', { op: 'add', label: 'Backup', when: { every: '1h' } }, 1);
  const b = req('nick', { op: 'add', label: 'Invoices', when: { every: '1h' } }, 2);
  assert.equal(M.fileScheduleRequest([a], b, [job]).length, 2);
  const c = req('pam', { op: 'add', label: 'Backup', when: { every: '1h' } }, 3);
  assert.equal(M.fileScheduleRequest([a], c, [job]).length, 2);
  // Folding keeps each job's place and joins in order; two round the clock
  // intervals can't share a day, so the later one (any case of the label) wins.
  const folded = M.foldScheduleRequests([a, b, req('nick', { op: 'add', label: 'backup', when: { every: '2h' } }, 4)], [job]);
  assert.equal(folded.length, 2);
  assert.equal(folded[0].id, 'r4');
  assert.equal(folded[0].draft.intervalMs, 2 * H);
  assert.equal(folded[1].draft.label, 'Invoices');
  assert.equal(M.foldScheduleRequests([], [job]).length, 0);
});

// ─── requestSummary ──────────────────────────────────────────────────────────

test('requestSummary says what a request would do, for every op', () => {
  const add = req('nick', { op: 'add', label: 'Backup', when: { every: '4h' } }, 1);
  assert.equal(M.requestSummary(add, [job]), 'add "Backup", every 4h, focus: "the job"');
  const rename = req('nick', { op: 'update', id: 'm1', label: 'Inbox sweep' }, 2);
  assert.equal(M.requestSummary(rename, [job]), 'change "Check Emails" from every 2h to every 2h and rename it "Inbox sweep"');
  const pause = req('nick', { op: 'pause', id: 'm1' }, 3);
  assert.equal(M.requestSummary(pause, [job]), 'pause "Check Emails"');
  // The schedule was deleted since: the summary still reads.
  assert.equal(M.requestSummary(pause, []), 'pause "a schedule"');
  const upd = req('nick', { op: 'update', id: 'm1', when: { every: '1h' } }, 4);
  assert.equal(M.requestSummary(upd, []), 'change "Check Emails" from its current times to every 1h');
});
