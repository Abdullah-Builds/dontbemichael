'use strict';

/**
 * The wide 1:1 (DESIGN.md 7.19, design and eng reviews 2026-10-17): Open wide
 * moves the conversation with Michael and its message box to the center, in
 * the wide panel's frame, drawn outside the office that goes out of reach.
 * The rules run here as a table; the layout is pinned in source, since the
 * renderer has no DOM harness (the look, focus and inert are live checks, D15).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rule = loadTs('src/renderer/src/shell/wideCenter.ts');
const base = { dockOpen: true, dockWide: true, dockSideForNow: false, panelWideOpen: false, claim: 'dock' };

test('who holds the center: the 1:1 when chosen wide and opened last, else a wide panel; Needs you never moves it', () => {
  // Value: protects=8A last opened wins, 7A Esc is for now, and the owner's rule that Needs you sits beside the wide 1:1 (2026-10-17); fails_when=both go wide at once, the board or a panel at the side pushes the 1:1 away, or Esc's side sticks after close; why_new=new rule; seam=pure dockCentered()/panelCentered()
  const rows = [
    [{}, true, 'chosen wide and open'],
    [{ dockOpen: false }, false, 'closed'],
    [{ dockWide: false }, false, 'the owner chose narrow'],
    [{ dockSideForNow: true }, false, 'Esc sent it to the side for now'],
    [{ claim: 'column', panelWideOpen: true }, false, 'a wide panel was opened last'],
    [{ claim: 'column', panelWideOpen: false }, true, 'the board or a panel at the side opened last: it sits beside the 1:1'],
    [{ claim: 'dock', panelWideOpen: true }, true, 'opened after the wide panel'],
    [{ claim: null, panelWideOpen: true }, true, 'nothing claimed yet']
  ];
  for (const [patch, want, why] of rows) assert.equal(rule.dockCentered({ ...base, ...patch }), want, why);
  assert.equal(rule.panelCentered({ panelWide: true, panelOpen: true, dockCentered: false }), true);
  assert.equal(rule.panelCentered({ panelWide: true, panelOpen: true, dockCentered: true }), false, 'one center: the panel goes to the side');
  assert.equal(rule.panelCentered({ panelWide: false, panelOpen: true, dockCentered: false }), false);
  assert.equal(rule.panelCentered({ panelWide: true, panelOpen: false, dockCentered: false }), false, 'the board never goes wide');
});

test('Esc: wide goes to the side for now, from the box too; at the side it closes from the conversation only', () => {
  // Value: protects=6B and the D15 regression contract (narrow, one Esc closes; Esc in the box still does nothing); fails_when=a stray Esc closes a wide read, the box's Esc is ignored while wide, or the narrow dock changes; why_new=Esc had one regex pin; seam=pure dockEscAction()
  const esc = (e) => rule.dockEscAction({ composing: false, ...e });
  assert.equal(esc({ wide: true, inDock: true }), 'side');
  assert.equal(esc({ wide: true, inDock: false }), 'side', 'from the message box too');
  assert.equal(esc({ wide: false, inDock: true }), 'close', 'narrow: one Esc closes, as before');
  assert.equal(esc({ wide: false, inDock: false }), 'none', 'narrow: Esc in the box does nothing, as before');
  assert.equal(esc({ wide: true, inDock: true, composing: true }), 'none', 'an IME keeps its Esc');
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /if \(action === 'side'\) useStore\.getState\(\)\.setDockSideForNow\(true\);\n\s*else close\(\);/);
  const bar = read('src/renderer/src/shell/BottomBar.tsx');
  assert.match(bar, /if \(dockEscAction\(\{ wide: true, inDock: false, composing: isComposingKey\(e\) \}\) !== 'side'\) return;/);
  assert.match(bar, /onKeyDown=\{onSheetKey\}/, 'the sheet, which holds the box, takes the box\'s Esc');
});

test('the 1:1 remembers wide on its own, only its button changes it, and nothing else is remembered', () => {
  // Value: protects=1A and 7A; fails_when=the 1:1 shares the panels' key, Esc or close rewrite the choice, the claim or side is saved, or an ask arriving steals the center; why_new=new state; seam=source pins (the store needs a window)
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /const LS_DOCK_WIDE = 'cth\.dockWide';/);
  assert.match(store, /try \{ return window\.localStorage\.getItem\(LS_DOCK_WIDE\) === '1'; \} catch \{ return false; \}/);
  assert.match(store, /try \{ window\.localStorage\.setItem\(LS_DOCK_WIDE, on \? '1' : '0'\); \} catch \{ \/\* noop \*\/ \}/);
  assert.equal(store.match(/localStorage\.setItem\(LS_DOCK_WIDE/g).length, 1, 'only setDockWide writes it');
  assert.doesNotMatch(store, /localStorage[^\n]*(centerClaim|SideForNow)/, 'the claim and Esc\'s side are never saved');
  assert.match(store, /\{ dockOpen: false, dockFocus: undefined, dockSideForNow: false, dockNavigation: s\.dockNavigation \+ 1 \}/, 'closing ends Esc\'s for now');
  assert.match(store, /\? \{ dockOpen: true, dockFocus: focus, centerClaim: 'dock', dockNavigation: s\.dockNavigation \+ 1 \}/, 'opening the 1:1 claims the center');
  // Only the header button calls setDockWide.
  const callers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && /setDockWide\(/.test(read(rel))) callers.push(rel);
    }
  };
  walk('src/renderer/src');
  assert.deepEqual(callers, ['src/renderer/src/shell/MichaelDock.tsx']);
  assert.match(read('src/renderer/src/shell/MichaelDock.tsx'), /<WideButton on=\{wide\} onToggle=\{\(\) => setDockWide\(!wide\)\} \/>/);
  // The app opening Needs you by itself never takes the center (8A counts the owner's actions).
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /setRightColumn\('board', \{ claim: false \}\)/);
  assert.match(app, /st\.setRightColumn\(next, \{ claim: false \}\)/);
});

test('wide, the conversation and box are drawn outside the office, beside the right column and never over it', () => {
  // Value: protects=eng R1 (D14) and the owner's rule (2026-10-17): a box you can type in while the office is inert, with Needs you live beside it; fails_when=the host moves inside the stage, covers or dims the column, the column goes inert, or the bar loses the box's slot; why_new=new layout; seam=source pins; no_claim=focus and inert in the real page (live check)
  const app = read('src/renderer/src/App.tsx');
  const host = app.indexOf('<div id={DOCK_CENTER_ID}');
  assert.ok(host > app.indexOf('<BottomBar />') && host > app.indexOf('className="cth-wide-scrim"'), 'after the stage closes, beside the column');
  assert.match(app, /\.\.\.\(columnShown \? \{ insetInlineStart: 24, insetInlineEnd: sidebarWidth \+ 28 \} : \{ insetInlineStart: '10%', insetInlineEnd: '10%' \}\),\n\s*display: dockWide \? 'flex' : 'none'/, 'left of the column when it shows, else the wide panel frame');
  assert.match(app, /\.\.\.\(dockWide && columnShown \? \{ insetInlineEnd: sidebarWidth \+ 16 \} : \{\}\)/, 'the dimming stops at the column');
  assert.doesNotMatch(app, /columnRef\.current\?\.toggleAttribute\('inert'/, 'the column stays live');
  const bar = read('src/renderer/src/shell/BottomBar.tsx');
  assert.match(bar, /\{createPortal\(\n\s*<div ref=\{composerRef\}/);
  assert.match(bar, /<div aria-hidden="true" style=\{\{ \.\.\.slot, minHeight: 50 \}\} \/>/, 'the bar keeps the slot');
  assert.match(bar, /box\.setSelectionRange\(box\.value\.length, box\.value\.length\);/, 'the box has focus at the end of its text');
  assert.match(bar, /const view: DockView = \{ expanded, setExpanded, showEarlier, setShowEarlier, anchor \};/, 'what was open survives the remount');
  // The narrow dock is unchanged (D15): it stays in the bar, closes on a floor click only with an empty box.
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /if \(draft\.trim\(\)\) return;\n\s*if \(!target\.closest\('\.cth-studio'\)/);
  assert.match(dock, /style=\{wide \? dockWideStyle : dockStyle\}/);
  assert.match(dock, /position: 'absolute', insetInlineStart: 0, bottom: 'calc\(100% \+ 8px\)', width: 400,/);
});

test('wide reads at 14 / 22 in a 720 px column, with no fold and tables at their own width', () => {
  // Value: protects=2A, 4A, 5A; fails_when=wide keeps the narrow size or fold, tables stretch across the bubble, or the box in the sheet shows the floating shadow; why_new=new styles; seam=source pins; no_claim=the look (checked in the running app)
  const dock = read('src/renderer/src/shell/MichaelDock.tsx');
  assert.match(dock, /padding: wide \? '18px max\(16px, calc\(\(100% - 720px\) \/ 2\)\)' : '12px 13px'/);
  assert.match(dock, /fontSize: wide \? 14 : 12\.5, lineHeight: wide \? '22px' : '18px'/);
  assert.match(dock, /maxWidth: wide \? 'min\(84%, 560px\)' : '84%'/);
  assert.match(dock, /if \(!el \|\| open\) return;/, 'no fold measuring while wide');
  const css = read('src/renderer/src/design/global.css');
  assert.match(css, /\.cth-dock-wide \.cth-dock-reply \{ font-size: 14px; line-height: 22px; \}/);
  assert.match(css, /\.cth-dock-wide \.cth-dock-reply \.cth-md-card table \{ width: auto; \}/);
  assert.match(css, /padding-block: 6px; padding-inline: 24px 0;/);
  assert.match(css, /\.cth-dock-wide \.cth-dock-reply \.cth-md-card td\.cth-md-num \{ font-size: 13px; \}/);
  assert.match(css, /\.cth-dock-sheet \.cth-composer:focus-within \{ box-shadow: inset 0 0 0 2px var\(--cth-indigo\); \}/);
  assert.match(read('src/renderer/src/shell/BottomBar.tsx'), /margin: '10px max\(16px, calc\(\(100% - 720px\) \/ 2\)\) 16px'/);
});
