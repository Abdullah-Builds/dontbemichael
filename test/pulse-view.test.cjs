'use strict';

/**
 * The Pulse view keeps the approved design (docs/designs/team-performance.md,
 * design review D5 to D16; mockup pulse-final.html): a Pulse tab between Tasks
 * and Who talks to whom, ways to save first in amber soft cards with Apply, Not
 * now and Undo, line icons, a cost for the work bar, Michael's own tile, the
 * office row last, a layout by stage width, words for every picture, and never
 * coral.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const view = read('src/renderer/src/components/pulse/PulseView.tsx');
const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));

test('Pulse is a fixed view tab between Tasks and Who talks to whom, and takes the whole window', () => {
  // Value: protects=D5 location and name, the owner's 2026-10-15 ask (no Needs you column or bottom bar on Pulse); fails_when=the tab moves, is renamed, or the column or bottom bar shows on Pulse; why_new=design D5; seam=none; no_claim=pixel layout (visual QA after build)
  const top = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(top, /tab\('tasks', t\('floorView\.tasks'\)\)\}\s*\{tab\('pulse', t\('floorView\.pulse'\)\)\}\s*\{tab\('graph'/);
  assert.equal(en.floorView.pulse, 'Pulse');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /const columnView = floorView === 'office' \|\| floorView === 'file';\s*const columnShown = columnOpen && columnView;/);
  assert.match(app, /display: closingOpen \|\| barHidden \? 'none' : 'contents'/, 'the bottom bar hides on Pulse but stays mounted');
  assert.match(app, /paddingBottom: barHidden \? 0 : 96/);
  assert.match(read('src/renderer/src/store/store.ts'), /if \(view === 'office' \|\| view === 'file'\) return \{\};/);
});

test('sections run recommendations, what got done (one grid, then the quiet chips), then team at work', () => {
  // Value: protects=D2 and D3 order (owner, 2026-10-15) as the smart view set it on 2026-10-19 (pulse-smart-view.md 1E: Kept safe and the row of four join the What got done grid, eng R3), the saved card only once something was applied, and the start date with its reason behind the (i); fails_when=a section moves, the grid stops reading pulseTiles, a table returns, the saved card shows with nothing in it, or the start date loses its reason; why_new=owner asks 2026-10-15 and 2026-10-19; seam=none; no_claim=pixel layout (live check)
  assert.equal(en.pulse.recommendations, 'Recommendations');
  assert.match(view, /const savedShown = view\.saved\.state !== 'none';/);
  assert.match(view, /\{savedShown && <div/);
  assert.match(en.pulse.adviceStarts, /\{\{day\}\}[\s\S]*two full weeks[\s\S]*\{\{since\}\}/);
  assert.doesNotMatch(en.pulse.adviceStarts, /record/i, 'business words, not records (owner, 2026-10-15)');
  assert.match(view, /tip=\{noAdvice && view\.adviceFrom \? t\('pulse\.adviceStarts', \{ day: fmtDay\(view\.adviceFrom\), since: /, 'the why sits behind the header (i) (1D)');
  assert.match(view, /view\.adviceFrom \? t\('pulse\.adviceFrom', \{ day: fmtDay\(view\.adviceFrom\) \}\) : t\('pulse\.nothingToChange'\)/, 'one short line before advice (1D)');
  assert.equal(en.pulse.adviceFrom, 'Advice from {{day}}');
  const order = ["t('pulse.recommendations')", "t('pulse.whatGotDone')", 'tilesNow.shown.map', "t('pulse.quiet.row')", "t('pulse.work.title')"].map((k) => view.indexOf(k, view.indexOf('body = (')));
  assert.ok(order.every((i) => i > 0), 'every section is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(view, /const tilesNow = pulseTiles\(\{ snapshot: s, keptSafe: safe, learning: cur \}, pv && pk \? \{ snapshot: pv, keptSafe: pk, learning: pl \} : null, opened\);/);
  assert.doesNotMatch(view, /<table/);
});

test('a quiet chip is a labelled button that opens its tile, moves focus to it and reads it out (5A, 2A, 6A)', () => {
  // Value: protects=pulse-smart-view.md 5A, 2A and 6A; fails_when=a chip loses its label, opening stops adding the tile, focus or the polite line, or opened tiles survive a period change; why_new=new behavior; seam=none; no_claim=focus ring and VoiceOver output (live check)
  assert.match(view, /<button key=\{id\} type="button" className=\{`cth-quiet-chip/);
  assert.match(view, /aria-label=\{t\('pulse\.quiet\.chipAria', \{ name, period: periodWord \}\)\}/);
  assert.match(view, /onClick=\{\(\) => \{ setOpened\(\(o\) => new Set\(o\)\.add\(id\)\); setFocusTile\(id\); setNotice\(t\('pulse\.quiet\.opened'/);
  assert.match(view, /document\.getElementById\(`pulse-tile-\$\{focusTile\}`\)\?\.focus\(\);/);
  assert.match(view, /id=\{`pulse-tile-\$\{id\}`\} tabIndex=\{-1\} role="group"/);
  assert.match(view, /useEffect\(\(\) => \{ setOpened\(new Set\(\)\); setQuietRowsOpen\(false\); \}, \[period\]\);/);
  assert.equal(en.pulse.quiet.chipAria, '{{name}}: 0 {{period}}. Show tile.');
  const css = read('src/renderer/src/design/global.css');
  assert.match(css, /\.cth-quiet-chip \{[\s\S]*?height: 26px;[\s\S]*?background: var\(--cth-neutral-soft\);/);
  assert.match(css, /\.cth-tile-in \{ animation: cth-tile-in 150ms var\(--cth-ease\) both; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.cth-tile-in \{ animation: none; \} \}/);
});

test('Team at work folds members with no working time into one disclosure row, and says when nobody worked (1C, 2B)', () => {
  // Value: protects=pulse-smart-view.md 1C and 2B, eng D1; fails_when=idle members get full rows again, the fold loses aria-expanded, or an empty period goes back to one bare line; why_new=new behavior; seam=none; no_claim=pixel layout (live check)
  assert.match(view, /const busyRows = rows\.filter\(\(m\) => m\.busyMs > 0\);\n    const idleRows = rows\.filter\(\(m\) => m\.busyMs <= 0\);/);
  assert.match(view, /<button type="button" aria-expanded=\{quietRowsOpen\}/);
  assert.match(view, /\{quietRowsOpen && idleRows\.map\(memberRow\)\}/);
  assert.match(view, /t\(`pulse\.work\.nobody\.\$\{s\.period\}`\)/);
  assert.equal(en.pulse.work.quietMore, '{{n}} more were quiet');
  assert.equal(en.pulse.work.nobody.today, 'Nobody has worked yet today.');
  assert.equal(en.pulse.work.none, undefined, 'the old bare line is gone');
});

test('suggestions are amber soft cards, applied ones green with Undo; no coral and no left stripe anywhere', () => {
  // Value: protects=D10, D12 and calm by default; fails_when=a suggestion gets coral or a stripe, or Apply loses its Undo; why_new=design D12; seam=none; no_claim=none beyond protects
  assert.match(view, /background: 'var\(--cth-amber-soft\)'/);
  assert.match(view, /background: 'var\(--cth-green-soft\)'[\s\S]{0,400}t\('pulse\.undo'\)/);
  assert.doesNotMatch(view, /--cth-coral/, 'no coral color on Pulse');
  assert.doesNotMatch(view, /borderLeft|borderInlineStart/);
  assert.match(view, /window\.cth\.pulseApply\(a\.id, a\.change\)/, 'apply sends what the card showed');
  assert.match(view, /t\('pulse\.notNow'\)/);
});

test('line icons, never emoji; Team at work lists everyone on the team busiest first, Michael included, and opens their week', () => {
  // Value: protects=D11 icons and proposal 3 Team at work; fails_when=emoji return, a removed member shows, Michael is left out, a short worker is judged on cost, or a row stops opening the detail; why_new=owner proposal 3; seam=none; no_claim=pixel layout (visual QA)
  assert.match(view, /KIND_ICON: Record<WorkKind, IconName> = \{ email: 'mail', sent: 'send', task: 'check', check: 'clock' \}/);
  assert.doesNotMatch(view, /\p{Extended_Pictographic}/u);
  assert.match(view, /const rows = s\.members\.filter\(\(m\) => byId\.has\(m\.agentId\)\)\n\s+\.map\(\(m\) => \(\{ \.\.\.m, busyMs: m\.busyMs \?\? 0, turns: m\.turns \?\? 0, dayBusy: m\.dayBusy \?\? \[\] \}\)\)\n\s+\.sort\(\(a, b\) => b\.busyMs - a\.busyMs\);/);
  assert.match(view, /const work = teamAtWork\(rows\);/);
  assert.match(view, /m\.agentId === godId \? t\('pulse\.officeManager'\)/);
  assert.doesNotMatch(view, /pulse\.learning\.headline|pulse\.learning\.trend/, 'no Learning header or headline (owner, 2026-10-15)');
  assert.doesNotMatch(view, /pulse\.work\.perHour|stripOf\(|pulse\.work\.knows/, 'no day strip, per hour or Knows column (owner, 2026-10-15)');
  assert.match(view, /onClick=\{\(\) => setDetail\(m\.agentId\)\}/);
  for (const i of ['shield', 'search', 'pause', 'lock', 'book', 'help']) assert.match(view, new RegExp(`icon="${i}"`), i);
});

test('Kept safe counts what was stopped apart from what could not be checked, and held work is the only amber tile', () => {
  // Value: protects=Kept safe honesty; fails_when=held messages read as protection, or held turns calm while messages wait; why_new=owner proposal 3; seam=none; no_claim=none beyond protects
  const held = view.slice(view.indexOf('<StatTile icon="pause"'), view.indexOf('<StatTile icon="lock"'));
  assert.match(held, /text=\{t\('pulse\.safe\.held'\)\} amber=\{safe\.held > 0\}/);
  assert.equal(en.pulse.safe.held, 'messages held');
  assert.equal(en.pulse.safe.heldTip, 'When the check cannot run, the message waits instead of going out unchecked.', 'the (i) keeps "nothing goes out unchecked"');
  assert.doesNotMatch(view, /<Section title=\{t\('pulse\.safe\.title'\)\}/, 'no Kept safe header; each tile says what it guards (owner, 2026-10-15)');
  assert.match(view, /since: fmtDay\(view\.liveSince \?\? Date\.now\(\)\)/, 'recommendations count from live recording, not the backfill');
});

test('Kept safe tiles say what they count in a few words, keep the meaning in their own (i), and drop legends of zeros (owner, 2026-10-18)', () => {
  // Value: protects=design review D2 A, 1A and 2A (fields only, explanations behind the (i)); fails_when=a sentence comes back under a number, a zero state swaps the label, two tiles share one tip again, or a legend of zeros returns; why_new=owner report (too verbose); seam=source pins and locale files; no_claim=the rendered tiles
  assert.match(view, /tip=\{t\('pulse\.safe\.toInternetTip'\)\} text=\{t\('pulse\.safe\.toInternet'\)\}/);
  assert.match(view, /tip=\{t\('pulse\.safe\.answersTip'\)\} text=\{t\('pulse\.safe\.answersCleaned'\)\}/);
  assert.match(view, /text=\{t\('pulse\.safe\.rules'\)\}/);
  assert.doesNotMatch(view, /toInternetNone|heldNone|rulesNone|pulse\.safe\.trustTip/);
  assert.match(view, /const shown = all\.some\(\(p\) => p\.n > 0\) \? all\.filter\(\(p\) => p\.n > 0 \|\| all\.length <= 3\) : \[\];/, 'no legend of zeros');
  for (const k of ['toInternet', 'answersCleaned', 'held', 'rules']) assert.ok(en.pulse.safe[k].split(' ').length <= 5, `${k} is a label, not a sentence`);
  for (const k of ['sentAsWritten', 'privateOut', 'stopped', 'cleaned', 'nothingToRemove']) assert.ok(en.pulse.safe[k].split(' ').length <= 3, k);
  for (const g of Object.values(en.pulse.safe.gate)) assert.ok(g.split(' ').length <= 3, g);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/i18n/locales', `${loc}.json`), 'utf8')).pulse.safe;
    for (const k of ['toInternet', 'answersCleaned', 'held', 'rules', 'toInternetTip', 'answersTip', 'heldTip', 'rulesTip']) {
      assert.equal(typeof s[k], 'string', `${loc} ${k}`);
      assert.doesNotMatch(s[k], /[–—]| - /, `${loc} ${k}`);
    }
  }
});

test('the layout follows the stage width, and every picture has words', () => {
  // Value: protects=D14 reflow and D15 accessibility; fails_when=thresholds drift or a chart loses its label; why_new=design D14, D15; seam=none; no_claim=screen reader behavior (manual check)
  assert.match(view, /return w >= 1100 \? 'wide' : w >= 760 \? 'mid' : 'narrow';/);
  assert.match(view, /role="region" aria-label=\{t\('floorView\.pulse'\)\}/);
  assert.match(view, /role="img" aria-label=\{aria\}/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /aria-label=\{t\('pulse\.planAria'/);
  assert.ok((view.match(/<(?:button[^>]*type="button"|PixelButton)/g) || []).length >= 6, 'rows and actions are buttons');
  assert.match(view, /role="listitem"/, 'Team at work rows are a list');
});

test('Apply, Not now, Undo and Try again are PixelButtons, so they get the hover and the disabled state of DESIGN.md 7.7', () => {
  // Value: protects=one button look across the app and Apply showing it is busy; fails_when=a Pulse action goes back to a hand styled button; why_new=TODOS.md "Pulse buttons use PixelButton"; seam=source pins; no_claim=pixel layout
  assert.match(view, /import \{ PixelButton \} from '\.\.\/PixelButton';/);
  assert.doesNotMatch(view, /\bbtn\(/, 'no hand styled button helper');
  assert.match(view, /<PixelButton size="sm" disabled=\{busy === a\.id\} onClick=\{\(\) => \{ void apply\(a\); \}\}>/, 'Apply is the primary button and is disabled while busy');
  for (const key of ['pulse.notNow', 'pulse.undo', 'pulse.tryAgain']) {
    assert.match(view, new RegExp(`<PixelButton variant="secondary" size="sm"[^\\n]*\\{t\\('${key.replace('.', '\\.')}'\\)\\}</PixelButton>`), key);
  }
});

test('every pulse string is in all three locales, and the plan ring shows only on a plan', () => {
  // Value: protects=locale parity and E6 on an API key; fails_when=a key is missing in ar or zh-CN, or the ring shows for an API key; why_new=new strings; seam=none; no_claim=translation quality
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const want = keys(en.pulse).sort();
  for (const loc of ['ar', 'zh-CN']) assert.deepEqual(keys(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).pulse).sort(), want, loc);
  // Compare's copy (owner, 2026-10-16): every period has its words, the old periods' copy is gone, no dashes.
  for (const k of ['periods', 'compareWith', 'compareBefore']) assert.deepEqual(Object.keys(en.pulse[k]), ['today', 'this-week', 'this-month'], k);
  assert.deepEqual(Object.keys(en.pulse.learning.sub), ['today', 'this-week', 'this-month']);
  assert.ok(!('asksBefore' in en.pulse) && !('before' in en.pulse.learning) && !('down' in en.pulse.learning), 'no copy for the before lines');
  assert.equal(en.pulse.compare, 'Compare');
  assert.equal(en.pulse.compareTip, 'Both bars count the same days so far.');
  for (const v of keys(en.pulse).map((k) => k.split('.').reduce((o, x) => o[x], en.pulse))) assert.doesNotMatch(v, /[\u2013\u2014]| - /, v);
  assert.match(read('src/main/pulse.ts'), /headroom: billing === 'account' \? planHeadroom\(this\.reading\) : null/);
});

test('Pulse offers Today, This week and This month from one list, main and the select alike', () => {
  // Value: protects=D5 and the shared list (owner, 2026-10-16); fails_when=the select or main keeps its own list and a new period silently shows This week; why_new=three hand kept copies became one; seam=source pins; no_claim=IPC at run time
  assert.match(view, /import \{ dayKey, teamAtWork, PERIODS,/);
  assert.match(view, /\{PERIODS\.map\(\(p\) => <option key=\{p\} value=\{p\}>\{t\(`pulse\.periods\.\$\{p\}`\)\}<\/option>\)\}/);
  assert.match(view, /PERIODS\.includes\(v as Period\) \? \(v as Period\) : 'this-week'/, 'a stored Last week or Last 4 weeks opens This week');
  const main = read('src/main/index.ts');
  assert.doesNotMatch(main, /PULSE_PERIODS/);
  assert.match(main, /pulse\.snapshot\(isPeriod\(period\) \? period : 'this-week', compare === true\)/, 'a bad period is This week, anything but true is off');
  assert.match(view, /t\(`pulse\.learning\.sub\.\$\{s\.period\}`\)/);
  assert.doesNotMatch(view, /const span = |const off = |learn\.weeks|view\.weeks|<WeekLine /, 'no week slicing in the screen');
});

test('Compare: the app\'s switch reading Compare, remembered, kept in place and greyed while a period cannot compare, and two bars on every top tile', () => {
  // Value: protects=design D4 to D8 and eng D3, D6 (owner, 2026-10-16); fails_when=the switch loses the owner's choice when not ready, looks busy, a tile drops its bars, before lines return, or Pulse misses midnight; why_new=new screen behavior; seam=source pins; no_claim=pixel layout (live check)
  assert.match(view, /const LS_COMPARE = 'cth\.pulseCompare';/);
  assert.match(view, /<Toggle\s+on=\{compare\}/);
  assert.match(view, /onLabel=\{t\('pulse\.compare'\)\}\s+offLabel=\{t\('pulse\.compare'\)\}\s+label=\{t\(`pulse\.compareWith\.\$\{period\}`\)\}/);
  assert.match(view, /unavailable=\{!!view\?\.available && !view\.compareReady\}/);
  assert.match(view, /window\.cth\.pulseSnapshot\(period, compare\)/);
  const ui = read('src/renderer/src/components/triggers/ui.tsx');
  assert.match(ui, /aria-disabled=\{unavailable \|\| undefined\}/);
  assert.match(ui, /onClick=\{unavailable \? undefined : onClick\}/);
  assert.match(ui, /cursor: disabled \? 'progress' : unavailable \? 'default' : 'pointer'/, 'not ready is not busy');
  assert.equal((view.match(/\bpair\(/g) || []).length, 9, 'got done (one per tile), four Kept safe, questions, spent, your time, while away');
  assert.equal((view.match(/<WeekBars before /g) || []).length, 2, 'the pair helper and the stacked Learning bars');
  assert.match(view, /outline: '1px solid var\(--cth-ink-3\)'/, 'the earlier bar\'s outline (design D8)');
  assert.match(view, /\{total !== null && \(/, 'a missing value draws no bar (eng O2)');
  assert.doesNotMatch(view, /asksBefore|learning\.before|learning\.down/, 'no before lines with Compare off');
  assert.match(view, /next\.setHours\(24, 0, 1, 0\);/, 'reload at local midnight');
  assert.match(view, /return \(\) => clearTimeout\(timer\);/);
});

test('the held tile opens the list of what was held, each in plain words: what, why, and what happens next', () => {
  // Value: protects=the owner's 2026-10-16 ask (see what exactly was held) and its follow up (the first list "made no sense": jargon labels, an internal file, a raw error); fails_when=a row loses its headline, why or next step, a raw error shows outside the (i), an internal file or the app's reminder is quoted, or the list reads from anything but the private record; why_new=held list; seam=source pins; no_claim=pixel layout (live check)
  assert.match(view, /open=\{safe\.held > 0 \? \{ label: t\('pulse\.held\.open'\), onClick: \(\) => setHeldOpen\(true\) \} : undefined\}/);
  assert.match(view, /\{open && <button type="button" onClick=\{open\.onClick\}/, 'a real button, keyboard reachable, not the whole tile (it holds an InfoTip)');
  assert.match(view, /window\.cth\.pulseHeld\(fromMs, toMs\)/);
  assert.match(view, /const head = t\(`pulse\.held\.head\.\$\{kind\}`, \{ research, from, to \}\);/);
  assert.match(view, /next: t\(`pulse\.held\.next\.\$\{kind\}`, \{ research, from, to \}\)/);
  assert.match(view, /const what = notes \? notesPreview\(r\.opening\) \|\| t\('pulse\.held\.notesEmpty', \{ research \}\)\n\s+: officeOpen \? '' :/, 'the notes themselves, never the index page; no app reminder text');
  assert.match(view, /why: t\(`pulse\.held\.why\.\$\{heldCause\(r\)\}`\)/, 'why in the owner\'s terms');
  assert.match(view, /\{r\.error && <> <InfoTip text=\{t\('pulse\.held\.why\.detail', \{ error: r\.error \}\)\} \/><\/>\}/, 'the check\'s report only behind the (i)');
  assert.match(view, /t\('pulse\.held\.earlier', \{ count: earlier \}\)/);
  const kinds = ['answer', 'answerToMichael', 'app', 'member', 'michael', 'notes', 'officeOpen', 'you'];
  assert.deepEqual(Object.keys(en.pulse.held.head).sort(), kinds);
  assert.deepEqual(Object.keys(en.pulse.held.next).sort(), kinds);
  assert.equal(en.pulse.held.head.notes, "{{research}}'s notes were not added to the team's shared knowledge");
  assert.equal(en.pulse.held.next.notes, 'Notes now stay with {{research}}, and teammates ask {{research}} instead. Nothing for you to do.');
  assert.doesNotMatch(JSON.stringify(en.pulse.held), /memory index|hidden session|team's memory\b/, 'no jargon in the copy');
  // Research's notes were held at the same check until notes stopped being shared (owner, 2026-10-16); older rows still read plainly.
  assert.match(view, /const notes = r\.to === HELD_TO_MEMORY;/);
  assert.doesNotMatch(read('src/main/index.ts'), /HELD_TO_MEMORY/, 'no new notes rows');
  assert.deepEqual(Object.keys(en.pulse.held.why).sort(), ['checkDown', 'detail', 'off', 'settings', 'slow', 'starting', 'tooLong', 'unreadable']);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('pulse:held', \(_evt, fromMs: unknown, toMs: unknown\) =>/);
  assert.match(main, /Number\.isFinite\(fromMs\) && Number\.isFinite\(toMs\) \? pulse\.held\(fromMs, toMs\) : \[\]/);
});

test('Spent and Your time fill their tiles: title at the top, plan use or what it means at the foot', () => {
  // Value: protects=the owner\'s 2026-10-15 notes (title at the top, no empty foot); fails_when=the Spent tile centers its title or plan use leaves the foot; why_new=owner notes; seam=source pins; no_claim=pixel layout
  const spent = view.slice(view.indexOf("{t('pulse.whereMoneyWent')}") - 400, view.indexOf("{/* Your time and while you were away"));
  assert.match(spent, /\.\.\.tight, justifyContent: 'space-between'/);
  assert.match(spent, /width: `\$\{Math\.min\(100, view\.headroom\.usedPct\)\}%`/, 'plan use is a bar at the foot');
});

test('the Learning number opens the notes behind it, read on open by the same rule, each note as plain text', () => {
  // Value: protects=the owner can see what was learned (owner, 2026-10-18); fails_when=the link is lost, the list stops reading through pulse:learned, a note is rendered as markdown, or a deleted note shows nothing; why_new=list of new notes; seam=source pin, the renderer has no DOM harness; no_claim=how it looks
  assert.match(view, /curAdded > 0 && <button type="button" onClick=\{\(\) => setLearnedOpen\(true\)\}/);
  assert.match(view, /window\.cth\.pulseLearned\(from, to\)/);
  const detail = view.slice(view.indexOf('function LearnedDetail'), view.indexOf('function Marked'));
  assert.ok(detail.length > 0 && !/MarkdownPreview/.test(detail), 'agent written lines are never rendered as markdown');
  assert.match(detail, /dir="auto"/);
  assert.match(detail, /t\('pulse\.learning\.removed'\)/);
  for (const k of ['open', 'none', 'removed', 'who']) assert.ok(en.pulse.learning[k], k);
  assert.doesNotMatch(en.pulse.learning.tip, /day it was written/, 'the tip says a note counts when added, not edited');
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('pulse:learned'/);
  assert.match(main, /kind: 'note-added', ts, attrs: \{ id: n\.id, source: n\.source \}/, 'the record carries the id and source, never the note');
});

test('emails sent says how many went out approved without edits, and only once any were sent', () => {
  // Value: protects=the owner's 2026-10-19 wording ("as written" read as jargon; "0 as written" said nothing at zero); fails_when=the second part returns at zero or the old words come back; why_new=owner ask 2026-10-19; seam=none; no_claim=ar and zh-CN wording (presence only)
  assert.equal(en.pulse.outcome.sent, 'emails sent for you, {{sub}} approved without edits');
  assert.equal(en.pulse.outcome.sentNone, 'emails sent for you');
  assert.match(view, /t\(o\.kind === 'sent' && o\.total === 0 \? 'pulse\.outcome\.sentNone' : `pulse\.outcome\.\$\{o\.kind\}`, \{ sub: o\.sub \?\? 0 \}\)/);
  for (const loc of ['ar', 'zh-CN']) {
    const o = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).pulse.outcome;
    assert.ok(o.sentNone && o.sent.includes('{{sub}}') && !o.sentNone.includes('{{sub}}'), loc);
  }
});

test('before advice, Pulse shows what the rules see so far under a bold line, as facts with nothing to apply (owner, 2026-10-19)', () => {
  // Value: protects=the owner's bold "not advice yet" ask, eng D1 and D2 on screen; fails_when=the bold line goes, an early line gets Apply or a model name, or an older main without early crashes the view; why_new=new UI; seam=none; no_claim=layout (live look)
  assert.equal(en.pulse.early.title, 'What Pulse sees so far, not advice yet.');
  assert.match(view, /const early = view\.early \?\? \[\];/, 'an older main sends no early lines');
  assert.match(view, /\{noAdvice && early\.length > 0 \? \(/, 'insight cards replace the bare line (design A, owner 2026-10-19)');
  assert.match(view, /<Icon name="sparkle" size=\{0\.75\} \/>\{t\('pulse\.early\.pill'\)\}[\s\S]{0,120}fontWeight: 600[^}]*\}\}>\{t\('pulse\.early\.title'\)\}/, 'the Early look pill and the title (600, DESIGN.md 4.1)');
  assert.match(view, /t\('pulse\.early\.dayOf', \{ n: learnDay, days: ADVICE_DAYS \}\)/, 'the countdown to advice');
  const block = view.slice(view.indexOf('Before advice: what the advice rules see so far'), view.indexOf("noAdvice && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)'"));
  const cardFn = view.slice(view.indexOf('function EarlyCard('), view.indexOf('/** A Kept safe tile'));
  for (const part of [block, cardFn]) assert.doesNotMatch(part, /PixelButton|pulse\.apply|pulse\.notNow|savesAbout|<button/, 'facts only, nothing to apply');
  assert.match(cardFn, /role="group" aria-label=\{text\}/, 'each card is spoken as its full sentence');
  const facts = Object.values(en.pulse.early).join(' ');
  assert.doesNotMatch(facts, /\{\{model\}\}|model/i, 'a model fact names no model');
  for (const loc of ['ar', 'zh-CN']) {
    const o = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).pulse.early;
    assert.deepEqual(Object.keys(o).sort(), Object.keys(en.pulse.early).sort(), loc);
    assert.doesNotMatch(Object.values(o).join(' '), /[\u2013\u2014]/, `${loc}: no dashes`);
  }
});

