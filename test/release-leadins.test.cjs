'use strict';
// Release gate for the website's "New in" list (tools/check-release-leadins.cjs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { leadInProblems } = require('../tools/check-release-leadins.cjs');

const wrap = (items) => `# Don't Be Michael v0.2.4\n\n## What's new in 0.2.4\n\n${items}\n\nEvery feature, release by release\n\n## Download\n- **Not a lead in** here`;

test('the 0.2.4 notes as first published fail on the colon and the stopless lead in', () => {
  const problems = leadInProblems(wrap([
    '- **Company foundations:** one document of what each job needs to know.',
    '- **See and open company knowledge.** Settings lists every document.',
    '- **No switches for company knowledge or search by meaning.** Both are always on.',
    '- **Pulse shows only what has something to say,** and in your first two weeks shows what it sees.',
    '- **Windows reads scans and photos** with its own built in text recognition.'
  ].join('\n')));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /Company foundations:/);
  assert.match(problems[1], /Windows reads scans and photos\*\*/);
});

test('owner facing lead ins ending in a stop or comma pass, and plain bullets are ignored', () => {
  assert.deepEqual(leadInProblems(wrap([
    '- **The team learns your business.** Company foundations is one document.',
    '- **Windows reads scans and photos,** like a Mac.',
    '- A plain line with **bold** later in it is not a lead in'
  ].join('\n'))), []);
});

test('a later section never counts, and notes with no list fail', () => {
  assert.deepEqual(leadInProblems(wrap('- **Fine.** x')), [], 'the bold line under Download is outside the list');
  assert.equal(leadInProblems('# Notes\n\n- **Fine.** x').length, 1, 'no What\'s new heading');
  assert.equal(leadInProblems(wrap('- only plain lines')).length, 1, 'no bold lead in at all');
});

test('RELEASE.md passes', () => {
  assert.deepEqual(leadInProblems(fs.readFileSync(path.join(__dirname, '..', 'RELEASE.md'), 'utf8')), []);
});
