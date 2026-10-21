'use strict';

/**
 * Starter job suggestions in an empty schedule tab (per-agent-schedules.md 5A).
 * The business's pack chooses the job; the owner's click saves it paused.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { starterSuggestionsFor, pausedStarterMission, remainingStarterMissions } = loadTs('src/shared/starterJobs.ts');

const hours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], work: { start: '09:00', end: '17:00' } };
const job = (agentId, title, schedule = 'mon 09:00') => ({ agentId, title, schedule, focus: `Check ${title.toLowerCase()}` });
const pack = (businessType, agents, starterMissions = []) => ({
  businessType, agents: agents.map((id) => ({ id })), officeHours: hours, starterMissions
});

test('suggest at most three valid and distinct jobs from the original agent’s office pack', () => {
  const core = pack('core', ['pam'], [job('pam', 'Core inbox')]);
  const own = pack('retail-shop', ['pam', 'kelly'], [
    job('kelly', 'Support inbox'),
    job('pam', 'Inbox zero'),
    job('pam', 'Daily follow ups'),
    job('pam', 'Weekly review'),
    job('pam', 'Fourth job'),
    job('pam', 'Inbox zero'),
    job('pam', 'Bad schedule', 'whenever needed')
  ]);
  const suggestions = starterSuggestionsFor([own, core], 'retail-shop', 'pam');
  assert.deepEqual(suggestions.map((s) => s.job.title), ['Inbox zero', 'Daily follow ups', 'Weekly review']);
  assert.ok(suggestions.every((s) => s.hours === hours), 'each job uses its own pack hours');
});

test('use a hired agent’s source card even when the office has a different business pack', () => {
  const own = pack('saas-consulting', ['pam'], [job('pam', 'SaaS inbox')]);
  const retail = pack('retail-shop', ['pam'], [job('pam', 'Store inbox')]);
  assert.deepEqual(
    starterSuggestionsFor([own, retail], 'saas-consulting', 'hire_42', 'retail-shop/pam').map((s) => s.job.title),
    ['Store inbox']
  );
  assert.deepEqual(starterSuggestionsFor([own, retail], 'saas-consulting', 'hire_42', 'retail-shop/other'), []);
  assert.deepEqual(starterSuggestionsFor([own, retail], 'saas-consulting', 'custom_agent'), []);
});

test('fall back to core only for an original agent absent from its business pack', () => {
  const own = pack('pro-services', ['pam', 'kelly'], [job('kelly', 'Support review')]);
  const core = pack('core', ['pam'], [job('pam', 'Core inbox')]);
  assert.deepEqual(starterSuggestionsFor([own, core], 'pro-services', 'pam').map((s) => s.job.title), ['Core inbox']);
  assert.deepEqual(starterSuggestionsFor([own, core], 'pro-services', 'god'), []);
});

test('adding one suggestion uses the existing schedule parser and saves it paused', () => {
  const suggestion = starterSuggestionsFor([pack('retail-shop', ['pam'], [job('pam', 'Inbox zero')])], 'retail-shop', 'pam')[0];
  const created = pausedStarterMission(suggestion, 'pam', [], 'god', () => 'm_suggested');
  assert.ok(created);
  assert.equal(created.id, 'm_suggested');
  assert.equal(created.label, 'Inbox zero');
  assert.equal(created.focus, 'Check inbox zero');
  assert.equal(created.to, 'pam');
  assert.equal(created.enabled, false, 'the first run must wait for the owner to enable it');
  assert.ok(created.weekly || created.times, 'keep the schedule read from the pack');
  assert.equal(pausedStarterMission(suggestion, 'pam', [created], 'god', () => 'm_duplicate'), null, 'never add the same job twice');
});

test('the empty state offers suggestions with a paused Add action in every supported locale', () => {
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  const list = read('src/renderer/src/components/triggers/ScheduleList.tsx');
  const capabilities = read('src/renderer/src/components/CapabilitiesTab.tsx');
  assert.match(list, /suggestions\.length > 0/, 'remaining starters stay visible in starter-only tabs');
  assert.doesNotMatch(list, /mine\.length === 0 && suggestions/);
  assert.match(list, /schedule: whenText\(suggestion, t\)/, 'schedule wording uses the parsed mission and current language');
  assert.match(list, /filter\(\(p\): p is OfficePack => !!p\)/, 'missing pack files are excluded');
  assert.match(list, /remainingStarterMissions\(/, 'the suggested save must be a parsed paused mission');
  assert.match(list, /upsertMission\(mission\)/, 'the click saves the mission in main');
  assert.match(capabilities, /businessType=\{config\.businessType\} sourceCard=\{agent\.sourceCard\}/, 'agent provenance is passed through');
  for (const locale of ['en', 'ar', 'zh-CN']) {
    const o = JSON.parse(read(`src/renderer/src/i18n/locales/${locale}.json`));
    assert.match(o.schedulesSection.suggestedJob, /\{\{title\}\}/);
    assert.match(o.schedulesSection.suggestedJob, /\{\{schedule\}\}/);
    assert.match(o.schedulesSection.addSuggestedJob, /\{\{title\}\}/);
  }
});


test('after adding one of two starters, the other remains offered and is also saved paused', () => {
  const starters = starterSuggestionsFor([pack('home-services', ['pam'], [
    job('pam', 'Inbox zero', 'every 2h during office hours'),
    job('pam', "Tomorrow's jobs", '18:00 on office days')
  ])], 'home-services', 'pam');
  const offer = (existing) => remainingStarterMissions(starters, 'pam', existing, 'god', (i) => `m_${i}`);
  const first = offer([])[0];
  assert.equal(first.enabled, false);
  const remaining = offer([first]);
  assert.deepEqual(remaining.map((m) => m.label), ["Tomorrow's jobs"]);
  assert.equal(remaining[0].enabled, false);
  assert.deepEqual(offer([first, remaining[0]]), [], 'both added, no duplicates');
  assert.deepEqual(offer([{ ...first, enabled: true, lastFiredAt: 123 }]), remaining, 'runtime changes do not hide the other starter');
  const custom = { ...first, id: 'custom', label: 'My own job' };
  assert.deepEqual(offer([first, custom]), [], 'a custom job hides remaining starters');
  assert.deepEqual(offer([{ ...first, focus: 'My own focus' }]), [], 'a custom job with a starter name is not a starter');
  assert.deepEqual(offer([{ ...custom, to: 'kelly' }]).map((m) => m.label), ['Inbox zero', "Tomorrow's jobs"], 'other members do not affect this tab');
});

test('invalid schedules and empty focus never produce suggestion rows', () => {
  const starters = starterSuggestionsFor([pack('retail-shop', ['pam'], [
    job('pam', 'Bad schedule', 'whenever needed'),
    { ...job('pam', 'Empty focus'), focus: '   ' },
    job('pam', 'Good schedule')
  ])], 'retail-shop', 'pam');
  assert.deepEqual(starters.map((s) => s.job.title), ['Good schedule']);
  const invalid = { job: job('pam', 'Invalid', 'whenever needed'), hours };
  assert.deepEqual(remainingStarterMissions([invalid], 'pam', [], 'god', () => 'unused'), []);
});

test('cap the remaining list after recognizing every starter, including jobs beyond the first three', () => {
  const starters = starterSuggestionsFor([pack('retail-shop', ['pam'], [
    job('pam', 'First'), job('pam', 'Second'), job('pam', 'Third'), job('pam', 'Fourth')
  ])], 'retail-shop', 'pam', undefined, Infinity);
  const fourth = pausedStarterMission(starters[3], 'pam', [], 'god', () => 'fourth');
  const remaining = remainingStarterMissions(starters, 'pam', [fourth], 'god', (i) => `m_${i}`);
  assert.deepEqual(remaining.map((m) => m.label), ['First', 'Second', 'Third']);
});
