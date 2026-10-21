'use strict';

/**
 * The side panel's splitter: dragged with the mouse or moved with the arrow
 * keys, it widens toward the office floor and stays between its limits. In
 * Arabic the window is laid out right to left, the panel is on the left, and
 * both directions flip.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { splitterMax, dragWidth, keyWidth, KEY_STEP } = loadTs('src/renderer/src/components/sidebarWidth.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const lim = { min: 320, max: 1200, viewportWidth: 1400 };

test('the arrow keys change the width by one step, and other keys do nothing', () => {
  // Value: protects=the splitter works from the keyboard; fails_when=an arrow is ignored or the step is lost; why_new=PR #299; seam=none
  assert.equal(keyWidth('ArrowLeft', 500, lim, false), 500 + KEY_STEP);
  assert.equal(keyWidth('ArrowRight', 500, lim, false), 500 - KEY_STEP);
  assert.equal(keyWidth('Enter', 500, lim, false), undefined);
});

test('the width stays between its limits', () => {
  // Value: protects=the panel never swallows the floor or vanishes; fails_when=a key or drag passes min or the viewport cap; why_new=PR #299; seam=none
  assert.equal(splitterMax(lim), 1040, 'viewport leaves 360 px of floor');
  assert.equal(keyWidth('ArrowRight', 330, lim, false), 320);
  assert.equal(keyWidth('ArrowLeft', 1030, lim, false), 1040);
  assert.equal(dragWidth(500, 100, -900, lim, false), 1040);
  assert.equal(dragWidth(500, 100, 900, lim, false), 320);
});

test('in Arabic the panel is on the left, so both directions flip', () => {
  // Value: protects=Arabic resizes the way the hand moves; fails_when=left still widens a panel that sits on the left; why_new=owner review on #299; seam=none
  assert.equal(keyWidth('ArrowRight', 500, lim, true), 500 + KEY_STEP);
  assert.equal(keyWidth('ArrowLeft', 500, lim, true), 500 - KEY_STEP);
  // Dragging right by 50 px widens it in Arabic, narrows it otherwise.
  assert.equal(dragWidth(500, 100, 150, lim, true), 550);
  assert.equal(dragWidth(500, 100, 150, lim, false), 450);
});

test('the splitter uses these rules, flips with useRtl, and its hint is short in every language', () => {
  // Value: protects=the component and the tested rules stay one; fails_when=the drag or keys keep their own copy, or the hint grows back; why_new=owner review on #299; seam=source pins
  const src = read('src/renderer/src/components/SidebarSplitter.tsx');
  assert.match(src, /const rtl = useRtl\(\);/);
  assert.match(src, /dragWidth\(startRef\.current\.width, startRef\.current\.clientX, e\.clientX, limits, rtl\)/);
  assert.match(src, /keyWidth\(e\.key, width, limits, rtl\)/);
  const hints = { en: 'Drag to resize. Double click to reset.' };
  for (const l of ['en', 'ar', 'zh-CN']) {
    const s = JSON.parse(read(`src/renderer/src/i18n/locales/${l}.json`)).sidebar;
    assert.ok(s.resizeTitle && s.resizeLabel, l);
    if (hints[l]) assert.equal(s.resizeTitle, hints[l]);
    assert.doesNotMatch(s.resizeTitle, /arrow|السهم|方向键/i, `${l}: the hint stays short`);
  }
});
