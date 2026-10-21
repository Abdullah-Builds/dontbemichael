'use strict';

/**
 * Empty Tasks columns. Every column used to say the same "Nothing here", so an
 * empty Blocked (good news) read the same as an empty To do (time to give the
 * team work), and a search with no match read as an empty office. Each column
 * now has its own line, and a filter with no match says so.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const kanban = read('src/renderer/src/components/TasksKanban.tsx');
const locale = (loc) => JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).kanban;

const columns = [...kanban.matchAll(/\{ key: '([a-z]+)',\s+labelKey: 'kanban\.col/g)].map((m) => m[1]);
const emptyBlock = kanban.match(/const EMPTY_KEYS: Record<Status, string> = \{([\s\S]*?)\};/);
const emptyKeys = emptyBlock ? Object.fromEntries([...emptyBlock[1].matchAll(/(\w+): 'kanban\.(\w+)'/g)].map((m) => [m[1], m[2]])) : {};

test('every column has its own empty line, in every locale', () => {
  assert.ok(emptyBlock, 'EMPTY_KEYS is defined in TasksKanban.tsx');
  assert.ok(columns.length >= 5, `sanity: found ${columns.length} columns`);
  assert.deepEqual(Object.keys(emptyKeys).sort(), [...columns].sort(), 'one empty line per column, no more, no less');
  const en = locale('en');
  const lines = new Set(columns.map((c) => en[emptyKeys[c]]));
  assert.equal(lines.size, columns.length, 'each column says something different');
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const k = locale(loc);
    for (const col of columns) {
      const s = k[emptyKeys[col]];
      assert.ok(typeof s === 'string' && s.trim(), `${loc} kanban.${emptyKeys[col]}`);
      assert.doesNotMatch(s, /Michael/, `${loc} kanban.${emptyKeys[col]} names the manager through {{godName}}`);
    }
    assert.ok(typeof k.noMatchingTasks === 'string' && k.noMatchingTasks.trim(), `${loc} kanban.noMatchingTasks`);
    assert.equal(k.empty, undefined, `${loc} still carries the old generic kanban.empty`);
  }
});

test('a filter with no match says no match, not an empty board', () => {
  assert.match(kanban, /isFiltered \? t\('kanban\.noMatchingTasks'\) : t\(EMPTY_KEYS\[col\.key\], \{ godName \}\)/);
  assert.doesNotMatch(kanban, /t\('kanban\.empty'\)/);
});
