'use strict';

/**
 * Pulse's ways to save (docs/designs/team-performance.md, Recommendations): each
 * rule at and just below its minimum, no data no advice, never a cheaper model for
 * Michael, never across providers, Fable (no tier) gets none, gap days are left
 * out, and a dismissed suggestion returns only at the next evidence band (D13).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const A = loadTs('src/shared/teamAdvice.ts');
const NOW = new Date(2026, 9, 16, 12).getTime();
const H = 3600_000;

const ladder = [
  { provider: 'claude', id: 'claude-opus-5-5', label: 'Opus 5.5', tier: 'top' },
  { provider: 'claude', id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { provider: 'claude', id: 'claude-sonnet-5', label: 'Sonnet 5', tier: 'middle' },
  { provider: 'claude', id: 'claude-haiku-4-5', label: 'Haiku 4.5', tier: 'small' }
];
const prices = { 'claude-opus-5-5': 75, 'claude-sonnet-5': 15 };
const base = { now: NOW, missions: [], members: [], runs: [], ladder, gapDays: [], priceOf: (m) => prices[m] };
const runs = (n, nothing, o = {}) => Array.from({ length: n }, (_, i) => ({
  missionId: 'm1', agentId: 'toby', start: NOW - (i + 1) * 12 * H, outcome: i < nothing ? 'nothing' : 'did-work', workCount: 1, usd: 0.5,
  day: new Date(NOW - (i + 1) * 12 * H).toISOString().slice(0, 10), ...o
}));
const mission = { id: 'm1', to: 'toby', label: 'Benefits inbox check', intervalMs: 2 * H, timed: false };
const member = (o) => ({ agentId: 'pam', provider: 'claude', model: 'claude-opus-5-5', isGod: false, pieces: 40, mailDecisions: 12, keptShare: 0.96, keptDecisions: 25, reopens: 0, usdPerWeek: 59, ...o });

test('run less often: 10 runs and 70% found nothing; an interval doubles, a timed schedule opens the editor', () => {
  // Value: protects=the run-less rule and its change; fails_when=it fires under 10 runs or 70%, or halves a timed schedule blindly; why_new=new; seam=none; no_claim=none beyond protects
  const a = A.adviceFor({ ...base, missions: [mission], runs: runs(14, 12) });
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'run-less');
  assert.deepEqual(a[0].change, { kind: 'interval', fromMs: 2 * H, toMs: 4 * H });
  assert.deepEqual(a[0].evidence, { runs: 14, nothing: 12 });
  assert.ok(a[0].savesPerWeek > 0);
  assert.deepEqual(A.adviceFor({ ...base, missions: [{ ...mission, timed: true }], runs: runs(14, 12) })[0].change, { kind: 'editor', direction: 'less' });
  assert.equal(A.adviceFor({ ...base, missions: [mission], runs: runs(9, 9) }).length, 0, 'under 10 runs');
  assert.equal(A.adviceFor({ ...base, missions: [mission], runs: runs(10, 6) }).length, 0, '60% is under 70%');
});

test('runs on a day whose records could not be saved are left out (D15)', () => {
  // Value: protects=no advice from missing data; fails_when=gap days still count; why_new=D15; seam=none; no_claim=none beyond protects
  const rs = runs(14, 12);
  const gapDays = [...new Set(rs.slice(0, 6).map((r) => r.day))];
  assert.equal(A.adviceFor({ ...base, missions: [mission], runs: rs, gapDays }).length, 0);
});

test('run more often: 90% did work and work per run up 30%, never below 15 minutes', () => {
  // Value: protects=the run-more rule; fails_when=it fires without growth or halves past 15 minutes; why_new=new; seam=none; no_claim=none beyond protects
  // A run a day for two weeks, so each week has seven.
  const rs = runs(14, 0).map((r, i) => {
    const start = NOW - (i + 0.5) * 86_400_000;
    return { ...r, start, day: new Date(start).toISOString().slice(0, 10), workCount: start >= NOW - 7 * 86_400_000 ? 4 : 2 };
  });
  const a = A.adviceFor({ ...base, missions: [mission], runs: rs });
  assert.equal(a[0].kind, 'run-more');
  assert.deepEqual(a[0].change, { kind: 'interval', fromMs: 2 * H, toMs: H });
  assert.equal(A.adviceFor({ ...base, missions: [{ ...mission, intervalMs: 20 * 60_000 }], runs: rs }).length, 0, '10 minutes would be too often');
  assert.equal(A.adviceFor({ ...base, missions: [mission], runs: rs.map((r) => ({ ...r, workCount: 2 })) }).length, 0, 'no growth, no advice');
});

test('a cheaper model needs 10 mail decisions, 90% kept and no reopens; never for Michael, never off the ladder', () => {
  // Value: protects=cheaper-model rule and owner rules; fails_when=Michael gets it, a card only member gets it, or Fable is moved; why_new=CEO D14 rules; seam=none; no_claim=prices beyond the table
  const a = A.adviceFor({ ...base, members: [member({})] });
  assert.equal(a[0].kind, 'cheaper-model');
  assert.deepEqual(a[0].change, { kind: 'model', from: 'claude-opus-5-5', to: 'claude-sonnet-5', toLabel: 'Sonnet 5' });
  assert.ok(Math.abs(a[0].savesPerWeek - 59 * 0.8) < 1e-9);
  assert.equal(A.adviceFor({ ...base, members: [member({ isGod: true })] }).length, 0, 'never a cheaper Michael');
  assert.equal(A.adviceFor({ ...base, members: [member({ mailDecisions: 9 })] }).length, 0, 'not enough quality evidence');
  assert.equal(A.adviceFor({ ...base, members: [member({ reopens: 1 })] }).length, 0);
  assert.equal(A.adviceFor({ ...base, members: [member({ model: 'claude-fable-5-1' })] }).length, 0, 'no tier, no advice');
  assert.equal(A.adviceFor({ ...base, members: [member({ provider: 'codex', model: 'gpt-5' })] }).length, 0, 'Claude only');
  assert.equal(A.adviceFor({ ...base, members: [member({ model: 'claude-haiku-4-5' })] }).length, 0, 'nothing below small');
});

test('a stronger model when work keeps coming back, Michael included', () => {
  // Value: protects=stronger-model rule; fails_when=it ignores reopens or skips Michael; why_new=new; seam=none; no_claim=none beyond protects
  const a = A.adviceFor({ ...base, members: [member({ model: 'claude-sonnet-5', keptShare: 0.5, keptDecisions: 12 })] });
  assert.equal(a[0].kind, 'stronger-model');
  assert.equal(a[0].change.to, 'claude-opus-5-5');
  assert.equal(A.adviceFor({ ...base, members: [member({ isGod: true, model: 'claude-sonnet-5', keptShare: null, keptDecisions: 2, reopens: 3 })] })[0].kind, 'stronger-model');
  assert.equal(A.adviceFor({ ...base, members: [member({ model: 'claude-opus-5-5', keptShare: 0.5, keptDecisions: 12 })] }).length, 0, 'nothing above top');
});

test('a dismissed suggestion returns only at the next evidence band or after 14 days (D13)', () => {
  // Value: protects=D13; fails_when=a no comes back the next day or never; why_new=design D13; seam=none; no_claim=none beyond protects
  const [s] = A.adviceFor({ ...base, missions: [mission], runs: runs(14, 12) });
  const dismissed = [{ id: s.id, band: s.band, at: NOW - 86_400_000 }];
  assert.equal(A.visibleAdvice([s], dismissed, NOW).length, 0);
  assert.equal(A.visibleAdvice([{ ...s, band: s.band + 1 }], dismissed, NOW).length, 1, 'evidence grew');
  assert.equal(A.visibleAdvice([s], dismissed, NOW + 14 * 86_400_000).length, 1, '14 days later');
});

test('the early mode runs every rule on the live days so far at half its evidence, and nothing else changes (owner, 2026-10-19)', () => {
  // Value: protects=eng D1 and D2: half minimums per rule, the live window, Michael and gap days left out; fails_when=a minimum is not halved, days before the live start count, Michael gets a model fact, or a gap day counts; why_new=new early mode; seam=none; no_claim=wording (pulse-view pins)
  const early = { from: NOW - 6 * 24 * H, scale: 0.5 };
  // Schedules: 5 runs (half of 10), 4 found nothing.
  const five = runs(5, 4);
  assert.deepEqual(A.adviceFor({ ...base, missions: [mission], runs: five }), [], 'the 14 day rule needs 10 runs');
  const [less] = A.adviceFor({ ...base, missions: [mission], runs: five }, early);
  assert.equal(less.kind, 'run-less');
  assert.deepEqual(less.evidence, { runs: 5, nothing: 4 });
  assert.deepEqual(A.adviceFor({ ...base, missions: [mission], runs: runs(4, 4) }, early), [], '4 runs: under half');
  const old = runs(5, 5, { start: NOW - 9 * 24 * H, day: new Date(NOW - 9 * 24 * H).toISOString().slice(0, 10) });
  assert.deepEqual(A.adviceFor({ ...base, missions: [mission], runs: old }, early), [], 'runs before the live start do not count');
  assert.deepEqual(A.adviceFor({ ...base, missions: [mission], runs: five, gapDays: five.map((r) => r.day) }, early), [], 'gap days are left out');
  // Model rules: 10 pieces and 5 decisions (half of 20 and 10); 2 reopens (half of 3).
  const kept = member({ pieces: 10, mailDecisions: 5, keptDecisions: 5, keptShare: 1 });
  assert.deepEqual(A.adviceFor({ ...base, members: [kept] }), [], 'the 14 day rule needs 20 pieces and 10 decisions');
  assert.equal(A.adviceFor({ ...base, members: [kept] }, early)[0].kind, 'cheaper-model');
  assert.deepEqual(A.adviceFor({ ...base, members: [{ ...kept, isGod: true }] }, early), [], 'never Michael');
  const back = member({ model: 'claude-sonnet-5', pieces: 3, mailDecisions: 1, keptDecisions: 3, keptShare: null, reopens: 2 });
  assert.deepEqual(A.adviceFor({ ...base, members: [back] }), [], 'the 14 day rule needs 3 reopens');
  assert.equal(A.adviceFor({ ...base, members: [back] }, early)[0].kind, 'stronger-model');
});
