'use strict';

/**
 * A file Michael or an Ask me card names opens as a tab inside the office
 * (docs/designs/open-file-tab.md; owner, 2026-10-10: show the Open option
 * instead of the path, and open it as a tab next to Who talks to whom). The
 * path is agent written, so main reads only readable kinds inside the office
 * or a team member's folder, judged on the canonical path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { askFilePaths, plainFilePaths, unescapeMarkdown, kindOf, TAB_EXTENSIONS, OPEN_EXTENSIONS } = loadTs('src/shared/askFiles.ts');
const { askFileVerdict, readAskFile } = loadTs('src/main/fs.ts');
const { remarkFileChips } = loadTs('src/renderer/src/markdown/remarkFileChips.ts');
const { openTab, closeTab, MAX_FILE_TABS } = loadTs('src/renderer/src/store/fileTabs.ts');
const { parseDelimited, CSV_ROW_LIMIT } = loadTs('src/renderer/src/components/delimited.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('full paths in plain text are files; URLs, words and relative bits are not (R1)', () => {
  // Value: protects=a path Michael writes without backticks gets a chip; fails_when=plain paths are missed or a URL becomes a file; why_new=only backtick spans were read before; seam=none
  const reply = '**Nick handled it.** Full report: /Users/me/Office/IT/it-mail-report-2026-10-10.md.\n\n'
    + 'See https://example.com/notes.md, and/or.md, 1/2.pdf, ops@example.com/x.md, `Sales/F.xlsx`, ~/notes/a.txt and C:\\Reports\\q3.csv;\n'
    + '[the data](/Users/me/b.json) and (/Users/me/c.md).\n\n```\ncat /Users/me/skip.md\n```';
  assert.deepEqual(askFilePaths(reply), [
    '/Users/me/Office/IT/it-mail-report-2026-10-10.md', 'Sales/F.xlsx', '~/notes/a.txt', 'C:\\Reports\\q3.csv', '/Users/me/b.json', '/Users/me/c.md'
  ], 'in order, each once, sentence punctuation trimmed, nothing from a fence, no URL, word or email tail');
  assert.deepEqual(plainFilePaths('see /a/b.md, ok').map((p) => p.path), ['/a/b.md']);
  assert.deepEqual(plainFilePaths('/a/notes'), [], 'no known ending, no file');
  assert.equal(unescapeMarkdown('C:\\Reports\\_q3.md'), 'C:\\Reports_q3.md', 'how Markdown reads a backslash before punctuation');
  assert.equal(kindOf('a.json'), 'json');
  assert.equal(TAB_EXTENSIONS.has('json') && !OPEN_EXTENSIONS.has('json'), true, 'JSON reads in a tab and never launches an app');
  for (const ext of ['pdf', 'docx', 'xlsx', 'pptx']) assert.equal(TAB_EXTENSIONS.has(ext), false, `${ext} opens in its app (R3)`);
});

test('the chip replaces exactly the path, from the source, in text, code spans and links (R2)', async () => {
  // Value: protects=the path becomes one chip and the sentence around it stays; fails_when=escapes, link targets or code spans stop matching; why_new=chips are new; seam=none
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const chips = (md) => {
    const proc = unified().use(remarkParse).use(remarkGfm).use(remarkFileChips);
    const tree = proc.runSync(proc.parse(md), md);
    const out = [];
    const walk = (n) => { if (n.data && n.data.hName === 'cth-file') out.push(n.data.hProperties.dataPath); (n.children || []).forEach(walk); };
    walk(tree);
    return { out, tree };
  };
  const { out, tree } = chips('Full report: /Users/me/IT/report.md. Also `Sales/F.xlsx` and [data](/Users/me/b.json) but not [site](https://x.com/a.md).');
  assert.deepEqual(out, ['/Users/me/IT/report.md', 'Sales/F.xlsx', '/Users/me/b.json']);
  const para = tree.children[0].children;
  assert.equal(para[0].value, 'Full report: ');
  assert.equal(para[1].children[1].value, '.', 'the sentence period stays text, kept with its chip');
  assert.equal(para[2].value, ' Also ');
  assert.deepEqual(chips('Saved to C:\\Reports\\_q3.md today').out, ['C:\\Reports\\_q3.md'], 'Windows path read from the source, backslash kept');
  assert.deepEqual(chips('Saved to C:/Reports/q3.csv. See [notes](D:/Reports/notes.md).').out,
    ['C:/Reports/q3.csv', 'D:/Reports/notes.md'], 'Windows forward slash paths become chips in prose and links');
  assert.deepEqual(chips('See [site](https://example.com/C:/Reports/q3.csv).').out, [], 'a URL containing a drive path stays a link');
  for (const md of [
    'See [report](/Users/me/Q3(final)/report.md)',
    'See [report](/Users/me/Q3\\(final\\)/report.md "review")',
    'See [report](C:\\Reports\\_q3.md)',
    'See [report](/Users/me/report.md\n "Q3")',
    'See [report](</Users/me/Harbor & Pine/Q3 (final)/report.md>)'
  ]) {
    assert.deepEqual(askFilePaths(md), chips(md).out, 'paths checked by main match rendered chip paths');
  }
  for (const depth of [32, 33]) {
    const md = `See [report](/Users/me/Q3${'('.repeat(depth)}final${')'.repeat(depth)}/report.md)`;
    assert.deepEqual(askFilePaths(md), chips(md).out, `destination nesting depth ${depth} matches the renderer`);
  }
  assert.deepEqual(chips('```\n/Users/me/skip.md\n```').out, [], 'code fences stay code');
  // 2026-10-11: Michael wrote **... 10 Oct (`/path/report.md`).** and the chip
  // wrapped to its own line, stranding "(" above it and ")." below it.
  const wrapped = chips('**Covered 7 to 10 Oct (`/Users/me/IT/report.md`).** Next week too.').tree.children[0].children[0].children;
  assert.equal(wrapped[0].value, 'Covered 7 to 10 Oct ', 'the "(" before a chip goes');
  assert.equal(wrapped[1].data.hName, 'span', 'the chip and its period break as one');
  assert.equal(wrapped[1].children[0].data.hName, 'cth-file');
  assert.equal(wrapped[1].children[1].value, '.', 'the ")" goes, the period stays with the chip');
  assert.equal(wrapped.length, 2);
  const aside = chips('See (in /Users/me/a.md) for more').tree.children[0].children;
  assert.equal(aside[0].value, 'See (in ', 'parentheses that hold more than the path stay');
  assert.equal(aside[2].value, ') for more');
  // Value (extension): protects=only a pair hugging the chip goes, at any place in a line and around a linked file; fails_when=one sided parens are stripped, a leading space is left, or link chips are skipped; why_new=one middle of line case was checked; seam=none
  const open = chips('Open (`/Users/me/a.md` today)').tree.children[0].children;
  assert.deepEqual([open[0].value, open[1].data.hName, open[2].value], ['Open (', 'cth-file', ' today)'], 'a "(" with no ")" right after the chip stays');
  const first = chips('(`/Users/me/a.md`) first').tree.children[0].children;
  assert.deepEqual([first.length, first[0].data.hName, first[1].value], [2, 'cth-file', ' first'], 'a chip opening the line keeps no stray space');
  const linked = chips('See ([data](/Users/me/b.json)), ok').tree.children[0].children;
  assert.deepEqual([linked[0].value, linked[1].children[0].data.hName, linked[1].children[1].value, linked[2].value], ['See ', 'cth-file', ',', ' ok'], 'a linked file sheds its parentheses too');
});

test('main reads only readable kinds inside the folders, capped, by canonical path (R3)', async (t) => {
  // Value: protects=a tab never reads a file outside the office folders or an unbounded one; fails_when=the folder check, kind check or caps are dropped; why_new=no read by named path existed; seam=none
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-filetab-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const office = path.join(base, 'office');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(office, 'IT'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(office, 'IT', 'report.md'), '# report');
  fs.writeFileSync(path.join(office, 'data.json'), '{"a":1}');
  fs.writeFileSync(path.join(office, 'empty.md'), '');
  fs.writeFileSync(path.join(office, 'leads.csv'), 'a,b\n1,2\n');
  fs.writeFileSync(path.join(office, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(office, 'Plan.pdf'), 'x');
  fs.writeFileSync(path.join(office, 'big.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
  fs.writeFileSync(path.join(outside, 'id_rsa.txt'), 'secret');
  fs.symlinkSync(path.join(outside, 'id_rsa.txt'), path.join(office, 'key.txt'));
  const roots = [office];

  const md = await readAskFile(path.join(office, 'IT', 'report.md'), roots);
  assert.equal(md.ok, true);
  assert.equal(md.kind, 'markdown');
  assert.equal(md.text, '# report');
  assert.equal(md.path, path.join(office, 'IT', 'report.md'), 'the canonical path keys the tab');
  assert.equal((await readAskFile('data.json', roots)).kind, 'json');
  assert.equal((await readAskFile('leads.csv', roots)).kind, 'csv');
  assert.equal((await readAskFile('empty.md', roots)).size, 0, 'an empty file reads, as Empty file');
  const png = await readAskFile('pic.png', roots);
  assert.equal(png.kind, 'image');
  assert.equal(png.bytes.length, 4);
  assert.deepEqual(await readAskFile('Plan.pdf', roots), { ok: false, error: 'not found' }, 'PDF opens in its app, never in a tab');
  assert.deepEqual(await readAskFile('big.md', roots), { ok: false, error: 'too large' });
  assert.deepEqual(await readAskFile('key.txt', roots), { ok: false, error: 'not found' }, 'a link to a secret outside the office is refused');
  assert.deepEqual(await readAskFile(path.join(outside, 'id_rsa.txt'), roots), { ok: false, error: 'not found' });
  assert.deepEqual(await readAskFile('../outside/id_rsa.txt', roots), { ok: false, error: 'not found' });

  const json = await askFileVerdict('data.json', roots);
  assert.equal(json.verdict, 'reveal', 'JSON never launches an app');
  assert.equal(json.tab, true, 'but reads in a tab');
  assert.equal((await askFileVerdict('Plan.pdf', roots)).tab, false);
});

test('file tabs: one per file, at most five, closing the selected one goes left (R4)', () => {
  // Value: protects=tabs stay one per file and never pile up; fails_when=dedupe, the cap or close selection breaks; why_new=tabs are new; seam=none
  const tab = (id, at) => ({ id, title: id, kind: 'markdown', who: {}, openedAt: at });
  let s = { fileTabs: [], activeFileTab: null };
  for (let i = 1; i <= MAX_FILE_TABS; i++) s = openTab(s, tab(`f${i}`, i));
  assert.equal(s.fileTabs.length, 5);
  s = openTab(s, tab('f3', 99));
  assert.equal(s.fileTabs.length, 5, 'opening a file again selects its tab');
  assert.equal(s.activeFileTab, 'f3');
  s = openTab(s, tab('f6', 6));
  assert.deepEqual(s.fileTabs.map((f) => f.id), ['f2', 'f3', 'f4', 'f5', 'f6'], 'a sixth closes the oldest');
  let c = closeTab({ ...s, activeFileTab: 'f4' }, 'f4');
  assert.equal(c.activeFileTab, 'f3', 'the tab to its left');
  assert.equal(c.select, 'file');
  c = closeTab({ ...s, activeFileTab: 'f2' }, 'f2');
  assert.equal(c.activeFileTab, null, 'the first file tab: back to the view the owner came from');
  assert.equal(c.select, null);
  c = closeTab({ ...s, activeFileTab: 'f6' }, 'f2');
  assert.equal(c.activeFileTab, 'f6', 'closing another tab keeps the selection');
});

test('CSV and TSV become a table; broken quoting falls back to text (E3)', () => {
  // Value: protects=quoted commas stay in one cell; fails_when=the parser splits inside quotes; why_new=no CSV parser existed; seam=none
  assert.deepEqual(parseDelimited('name,note\n"Acme, Inc","said ""hi"""\r\nB,\n', ','), [['name', 'note'], ['Acme, Inc', 'said "hi"'], ['B', '']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.equal(parseDelimited('a,"b\n1,2', ','), null);
  // Excel's CSV UTF-8 starts with a byte order mark; the quoted header still reads as one column.
  assert.deepEqual(parseDelimited('﻿"Client, name",Amount\r\n"Acme, Inc",10', ','), [['Client, name', 'Amount'], ['Acme, Inc', '10']]);
  assert.deepEqual(parseDelimited('﻿name\tnote\n1\t2', '\t'), [['name', 'note'], ['1', '2']]);
  assert.equal(CSV_ROW_LIMIT, 1000);
});

test('CSV and TSV retain an empty quoted final record without a trailing newline', () => {
  // Value: protects=an empty quoted final record stays in the preview; fails_when=EOF drops a record whose cell text is empty; why_new=only nonempty cells and completed separators were checked at EOF; seam=none
  for (const sep of [',', '\t']) {
    for (const ending of ['\n', '\r\n', '\r']) {
      assert.deepEqual(parseDelimited(`name${ending}""`, sep), [['name'], ['']]);
    }
    assert.deepEqual(parseDelimited('""', sep), [['']]);
    assert.deepEqual(parseDelimited('\ufeff""', sep), [['']], 'a BOM does not hide the empty quoted record');
    assert.deepEqual(parseDelimited(`name${sep}note\nA${sep}""`, sep), [['name', 'note'], ['A', '']]);
    assert.equal(parseDelimited('name\n"', sep), null, 'unclosed quotes still fall back to text');
  }
});

test('CSV and TSV do not invent final records for empty files or trailing line endings', () => {
  // Value: protects=the EOF fix does not add a phantom row; fails_when=an empty file or completed line ending produces an extra record; why_new=guards the record-start boundary used for quoted empty fields; seam=none
  for (const sep of [',', '\t']) {
    assert.deepEqual(parseDelimited('', sep), []);
    assert.deepEqual(parseDelimited('\ufeff', sep), []);
    for (const ending of ['\n', '\r\n', '\r']) {
      assert.deepEqual(parseDelimited(`name${ending}`, sep), [['name']]);
      assert.deepEqual(parseDelimited(`name${ending}""${ending}`, sep), [['name'], ['']]);
      assert.deepEqual(parseDelimited(`""${ending}`, sep), [['']]);
    }
  }
});

test('wiring: tabs after Who talks to whom, never saved, Ask me beside a file, watchers dropped on reload', () => {
  // Value: protects=the owner's tab and column behavior and the watcher cap; fails_when=the column hides on a file tab, the bottom bar shows on one, a restart lands on a file tab, or watchers leak; why_new=all new; seam=none
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /if \(view === 'file'\) \{ set\(\{ floorView: view \}\); return; \}/, 'a file tab is never written to cth.floorView');
  assert.match(store, /if \(view === 'office' \|\| view === 'file'\) return \{\};/, 'opening the column on a file tab (or Pulse) stays on it (F1, D14)');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /const columnView = floorView === 'office' \|\| floorView === 'file';\s*const columnShown = columnOpen && columnView;/);
  assert.match(app, /display: columnView \? 'flex' : 'none'/, 'the column style too, not only columnShown');
  assert.match(app, /\{floorView === 'file' && <FileTabView \/>\}/);
  assert.match(app, /const barHidden = floorView === 'pulse' \|\| floorView === 'file';/, 'no Talk to Michael bar on a file tab or Pulse (owner, 2026-10-16)');
  assert.match(read('src/renderer/src/components/FileTabView.tsx'), /<div ref=\{scroller\} className="cth-file-tab"/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-file-tab \.cth-md-preview \{ max-width: none; \}/, 'a report fills the file tab, no 72ch cap');
  const bar = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(bar, /\{tab\('graph', t\('floorView\.graph'\)\)\}\n[\s\S]*?\{fileTabs\.map/, 'file tabs come after Who talks to whom');
  assert.match(bar, /aria-label=\{t\('fileTab\.close', \{ name: f\.title \}\)\}/, 'close is its own labelled button');
  assert.match(bar, /flex: '0 1 auto', minWidth: 72/, 'file tabs shrink to fit (DD2)');
  const main = read('src/main/index.ts');
  assert.match(main, /wc\.once\('destroyed', drop\);\n\s+wc\.once\('render-process-gone', drop\);\n\s+wc\.on\('did-start-navigation'/, 'a reload or crash drops its watchers');
  assert.match(main, /if \(askFileWatches\.get\(wc\.id\) === forWindow\) askFileWatches\.delete\(wc\.id\);\n\s+wc\.off\('destroyed', drop\);\n\s+wc\.off\('render-process-gone', drop\);\n\s+wc\.off\('did-start-navigation', onNavigate\);/, 'each drop removes its own listeners and never clears a newer map');
  assert.match(main, /const watcher = watchFs\(dirname\(v\.path\)/, 'the folder is watched, so a rename over the file is seen');
  assert.match(main, /ipcMain\.handle\('fs:readAskFile'[\s\S]*?const r = await readAskFile\(p, askFileRoots\(who\)\);/, 'main checks the folders itself');
  const hive = read('src/main/hive.ts');
  assert.match(hive, /Name files by their full path in backticks so the owner can open them/, 'E4');
  assert.match(hive, /then the full paths of its files, each in backticks/, 'E4b');
  for (const loc of ['en', 'zh-CN', 'ar']) {
    const f = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).fileTab;
    for (const k of ['close', 'office', 'openInApp', 'reading', 'empty', 'tooLarge', 'unreadable', 'rows']) assert.ok(f[k], `${loc} ${k}`);
    assert.match(f.close, /\{\{name\}\}/);
    assert.doesNotMatch(JSON.stringify(f), /[–—]/, `${loc}: no dashes`);
  }
});
