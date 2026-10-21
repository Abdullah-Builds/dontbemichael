'use strict';

// SettingsModal: the starting tab must come from VISIBLE_SECTIONS.
//
// A link that names a tab Settings doesn't show (a hidden Voice tab, a stale
// name) opens on General instead of an empty panel. The check lives in the
// modal, against the tabs it shows, so a new or hidden tab can never drift
// from a second list. App.tsx passes the section through as it came.
//
// SettingsModal is a 2000+ line TSX with a wide import graph, so we read the
// source rather than mounting it, the same house pattern as settings-one-save
// and settings-fold-hidden.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MODAL = read('src/renderer/src/components/SettingsModal.tsx');
const APP   = read('src/renderer/src/App.tsx');

// -- 1. VISIBLE_SECTIONS is defined in SettingsModal --------------------------
test('VISIBLE_SECTIONS is defined in SettingsModal', () => {
  assert.match(MODAL, /const VISIBLE_SECTIONS/, 'VISIBLE_SECTIONS constant is missing from SettingsModal');
});

// -- 2. activeSection initialiser checks VISIBLE_SECTIONS, not a bare ?? ------
test('activeSection useState uses VISIBLE_SECTIONS.includes, not a bare ?? fallback', () => {
  assert.match(
    MODAL,
    /useState<Section>\(initialSection && VISIBLE_SECTIONS\.includes\(initialSection\) \? initialSection : 'General'\)/,
    "activeSection useState must be: initialSection && VISIBLE_SECTIONS.includes(initialSection) ? initialSection : 'General'"
  );
});

// -- 3. App keeps no list of its own; the modal decides -----------------------
test('App.tsx passes the section through untouched, with no tab list of its own', () => {
  assert.match(APP, /setSettingsSection\(section\);/, 'App.tsx passes the section on as it came');
  assert.doesNotMatch(APP, /section === 'Company profile'/, 'no second list of tab names in App.tsx');
});
