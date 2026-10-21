'use strict';

/**
 * Pulse shows only tiles with something to say (owner, 2026-10-19;
 * docs/designs/pulse-smart-view.md): a tile with nothing in the period, or in
 * the span before while Compare is on, folds into a quiet chip; Spent always
 * shows; a chip the owner opened shows until the period changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { pulseTiles, tileActivity, PULSE_TILES } = loadTs('src/shared/pulseTiles.ts');
const { keptSafe } = loadTs('src/shared/pulseSafety.ts');

const outcomes = (o = {}) => ['email', 'sent', 'task', 'check'].map((kind) => ({ kind, total: o[kind] ?? 0, by: [] }));
const span = ({ out = {}, safe = {}, asks = 0, away = null, learned = 0, questions = 0, learning = true } = {}) => ({
  snapshot: { outcomes: outcomes(out), yourTime: { asks, medianWaitMs: null }, awayShare: away },
  keptSafe: { ...keptSafe([]), ...safe },
  learning: learning ? { added: { you: learned, job: 0, michael: 0 }, asks: questions, turns: 0, per100: null } : null
});
const none = new Set();

test('a quiet span shows only Spent; every other tile is a chip, in grid order', () => {
  // Value: protects=design 1A, 1B and 1E; fails_when=a zero tile renders, Spent folds, or the chip order drifts from the grid; why_new=new rule; seam=none; no_claim=pixel layout (live check)
  assert.deepEqual([...PULSE_TILES], ['email', 'sent', 'task', 'check', 'toInternet', 'webAnswers', 'held', 'rules', 'learned', 'questions', 'spent', 'yourTime'], "today's order (1E)");
  const r = pulseTiles(span(), null, none);
  assert.deepEqual(r.shown, ['spent']);
  assert.deepEqual(r.quiet, PULSE_TILES.filter((t) => t !== 'spent'));
});

test('each tile shows once something happened in it, and only then', () => {
  // Value: protects=design 1A per tile; fails_when=a tile reads the wrong field; why_new=new rule; seam=none; no_claim=none beyond protects
  const rows = [
    ['email', { out: { email: 5 } }],
    ['sent', { out: { sent: 1 } }],
    ['task', { out: { task: 2 } }],
    ['check', { out: { check: 3 } }],
    ['toInternet', { safe: { toInternet: { pass: 0, clean: 0, stop: 1 } } }],
    ['webAnswers', { safe: { webAnswers: { pass: 0, clean: 2, flagged: 0 } } }],
    ['held', { safe: { held: 1 } }],
    ['rules', { safe: { rules: { connector: 2 } } }],
    ['learned', { learned: 4 }],
    ['questions', { questions: 1 }],
    ['yourTime', { asks: 2 }]
  ];
  for (const [id, data] of rows) {
    assert.deepEqual(pulseTiles(span(data), null, none).shown, PULSE_TILES.filter((t) => t === id || t === 'spent'), id);
  }
});

test('tiles with two numbers count what happened, not only the big number (eng D2)', () => {
  // Value: protects=eng review D2; fails_when=web answers read cleaned only, or Your time ignores the away share; why_new=D2 is new; seam=none; no_claim=none beyond protects
  assert.ok(pulseTiles(span({ safe: { webAnswers: { pass: 3, clean: 0, flagged: 0 } } }), null, none).shown.includes('webAnswers'), '0 of 3 cleaned stays a tile');
  assert.ok(pulseTiles(span({ away: 0.4 }), null, none).shown.includes('yourTime'), 'work while away keeps Your time');
  assert.ok(!pulseTiles(span({ away: 0 }), null, none).shown.includes('yourTime'), 'a zero away share is nothing');
  assert.equal(tileActivity('questions', span({ questions: 0 })), 0, 'no questions: the rate tile is quiet');
  assert.equal(tileActivity('rules', span({ safe: { rules: { 'from-a-later-build': 3 } } })), 0, 'a gate this build cannot name is not counted, as the tile shows it');
});

test('with Compare on, a tile with something in the span before stays a tile', () => {
  // Value: protects=design 1A (a drop to zero keeps its two bars); fails_when=the span before is ignored; why_new=new rule; seam=none; no_claim=none beyond protects
  const r = pulseTiles(span(), span({ out: { sent: 4 } }), none);
  assert.ok(r.shown.includes('sent'));
  assert.ok(!r.quiet.includes('sent'));
});

test('an opened chip shows its tile; an older snapshot with no learning is quiet, not a crash', () => {
  // Value: protects=design 2A and restart compatibility (PulseView keeps fallbacks for older snapshots); fails_when=opened ids are ignored or a missing learning throws; why_new=new rule; seam=none; no_claim=focus and announcement (live check)
  const r = pulseTiles(span({ learning: false }), null, new Set(['held']));
  assert.ok(r.shown.includes('held'));
  assert.ok(r.quiet.includes('learned') && r.quiet.includes('questions'));
});
