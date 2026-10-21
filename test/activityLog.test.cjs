'use strict';

/**
 * ActivityTab polls the hive log (newest 60 entries) and skips the re-render
 * when nothing changed. An earlier bailout compared only the first entry's `ts`,
 * which hid new lines when the two oldest entries shared a timestamp: the window
 * slides, length stays 60, entry 0 drops off and the next one has the same `ts`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { areLogsEqual } = loadTs('src/renderer/src/components/activityLog.ts');

const WINDOW = 60;

test('sliding window with duplicate oldest timestamps is NOT equal (new line stays visible)', () => {
  // Two oldest entries share ts = 1000.
  const prev = [
    { ts: 1000, kind: 'spawn', agentId: 'a' },
    { ts: 1000, kind: 'message', from: 'a', to: 'b', subject: 'hi' }
  ];
  for (let i = 2; i < WINDOW; i++) prev.push({ ts: 1000 + i, kind: 'drain', agentId: 'a', count: i });
  assert.equal(prev.length, WINDOW);

  // Next poll: the oldest drops off, a new entry is appended. Length is the same
  // and next[0].ts === prev[0].ts, so a first-entry check would wrongly say "same".
  const next = [...prev.slice(1), { ts: 2000, kind: 'escalate', subject: 'new line' }];
  assert.equal(next.length, WINDOW);
  assert.equal(next[0].ts, prev[0].ts, 'precondition: first entries share a ts');

  assert.equal(areLogsEqual(prev, next), false);
});

test('identical logs are equal, even as fresh objects', () => {
  const make = () => [
    { ts: 1, kind: 'spawn', name: 'Ada' },
    { ts: 2, kind: 'approval', approve: true }
  ];
  assert.equal(areLogsEqual(make(), make()), true);
  assert.equal(areLogsEqual([], []), true);
});

test('different lengths are not equal', () => {
  assert.equal(areLogsEqual([{ ts: 1 }], [{ ts: 1 }, { ts: 2 }]), false);
});
