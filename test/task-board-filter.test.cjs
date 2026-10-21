'use strict';

/**
 * Finding a card on the Tasks board (issue 158): a search over the card's own
 * words and one team member. No status filter: each status is a column.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { taskMatches, filterActive } = loadTs('src/renderer/src/components/hiveTasks.ts');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const card = (over = {}) => ({
  id: 't_42', title: 'Send the Northwind quote', description: 'Use the spring price list',
  assignee: 'kelly', status: 'doing', dependsOn: [], priority: 2, createdAt: '2026-10-01T09:00:00Z', ...over
});
const none = { query: '', assignee: '' };

test('an empty filter keeps every card and is not active', () => {
  assert.equal(filterActive(none), false);
  assert.equal(filterActive({ query: '   ', assignee: '' }), false);
  assert.equal(taskMatches(card(), none), true);
  assert.equal(taskMatches(card({ assignee: undefined }), none), true);
});

test('the search matches the title, description, result and id, in any case', () => {
  assert.equal(taskMatches(card(), { query: 'NORTHWIND', assignee: '' }), true);
  assert.equal(taskMatches(card(), { query: 'spring price', assignee: '' }), true);
  assert.equal(taskMatches(card({ result: 'Quote accepted' }), { query: 'accepted', assignee: '' }), true);
  assert.equal(taskMatches(card(), { query: 't_42', assignee: '' }), true);
  assert.equal(taskMatches(card(), { query: 'invoice', assignee: '' }), false);
});

test('every typed word must appear, in any order', () => {
  assert.equal(taskMatches(card(), { query: 'quote northwind', assignee: '' }), true);
  assert.equal(taskMatches(card(), { query: 'quote invoice', assignee: '' }), false);
});

test('a team member keeps only their cards, and combines with the search', () => {
  const f = { query: '', assignee: 'kelly' };
  assert.equal(filterActive(f), true);
  assert.equal(taskMatches(card(), f), true);
  assert.equal(taskMatches(card({ assignee: 'oscar' }), f), false);
  assert.equal(taskMatches(card({ assignee: undefined }), f), false);
  assert.equal(taskMatches(card(), { query: 'northwind', assignee: 'oscar' }), false);
});

test('an unassigned filter keeps only cards with no assignee', () => {
  const f = { query: '', assignee: 'unassigned' };
  assert.equal(filterActive(f), true);
  assert.equal(taskMatches(card({ assignee: undefined }), f), true);
  assert.equal(taskMatches(card({ assignee: 'kelly' }), f), false);
});

test('the search matches who the card is waiting on', () => {
  assert.equal(taskMatches(card({ waitingOn: 'Legal approval' }), { query: 'legal', assignee: '' }), true);
  assert.equal(taskMatches(card({ waitingOn: 'Legal approval' }), { query: 'accounting', assignee: '' }), false);
});

test('the search matches the assignee and the resolved team member name', () => {
  assert.equal(taskMatches(card({ assignee: 'kelly' }), { query: 'kelly', assignee: '' }), true);
  assert.equal(taskMatches(card({ assignee: 'agent_42' }), { query: 'kelly', assignee: '', nameFor: (id) => (id === 'agent_42' ? 'Kelly Kapoor' : undefined) }), true);
  assert.equal(taskMatches(card({ assignee: 'agent_42' }), { query: 'kapoor', assignee: '', nameFor: (id) => (id === 'agent_42' ? 'Kelly Kapoor' : undefined) }), true);
  assert.equal(taskMatches(card({ assignee: 'agent_42' }), { query: 'dwight', assignee: '', nameFor: (id) => (id === 'agent_42' ? 'Kelly Kapoor' : undefined) }), false);
});

test('the board filters every column and unfolds Done while filtering', () => {
  const src = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(src, /const shown = filtering \? tasks\.filter\(\(x\) => taskMatches\(x, filter\)\) : tasks;/);
  assert.match(src, /const all = shown\.filter\(\(x\) => x\.status === col\.key\);/);
  assert.match(src, /showAllDone \|\| filtering \? \[\.\.\.all\]\.reverse\(\)/);
  assert.match(src, /col\.key === 'done' && !filtering && all\.length > DONE_SHOWN/);
  assert.match(src, /\{shown\.filter\(\(x\) => x\.status === col\.key\)\.length\}/, 'header counts are of the matches');
  assert.match(src, /aria-pressed=\{isSelected\}/, 'status count chips have aria-pressed');
  assert.match(src, /placeholder=\{t\('kanban\.search'\)\}/);
  assert.match(src, /<option value="">\{t\('kanban\.everyone'\)\}<\/option>/);
  assert.match(src, /<option value="unassigned">\{t\('kanban\.unassigned'\)\}<\/option>/);
  assert.match(src, /t\('kanban\.showingFiltered'/);
  assert.match(src, /\{isFiltered \? t\('kanban\.noMatchingTasks'\) : t\(EMPTY_KEYS\[col\.key\], \{ godName \}\)\}/, 'a filtered empty column says no match, an unfiltered one its own line');
  const row = src.slice(src.indexOf('Find a card'), src.indexOf('{/* Columns */}'));
  assert.equal(row.match(/<select/g).length, 1, 'one picker, for the member: the columns are the statuses');
});

test('the new words exist in every language, with no dashes', () => {
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const k = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;
    for (const key of ['search', 'everyone', 'member', 'unassigned', 'showingFiltered', 'noMatchingTasks']) {
      assert.equal(typeof k[key], 'string', `${loc} kanban.${key}`);
      assert.doesNotMatch(k[key], /[–—]| - /, `${loc} kanban.${key}`);
    }
  }
});
