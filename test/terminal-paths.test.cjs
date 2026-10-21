'use strict';

/**
 * ⌘-click on a path in terminal output. Two jobs, and the matcher is the one
 * that actually breaks: agent output is full of version strings and decimals
 * that look like filenames if the extension rule is loose.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  classifyPathToken, isPathToken, pathTokenMatcher, stripPathToken
} = loadTs('src/shared/terminalPaths.ts');

/** Every token the provider would underline on one line of output. */
function tokensIn(line) {
  const re = pathTokenMatcher();
  const out = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    const p = stripPathToken(m[0]);
    if (isPathToken(p)) out.push(p);
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * classification
 * ---------------------------------------------------------------- */

test('markdown previews, source edits — the v0.3.4 behaviour is unchanged', () => {
  assert.equal(classifyPathToken('RELEASE.md'), 'preview');
  assert.equal(classifyPathToken('docs/drops/v0.4.5.markdown'), 'preview');
  assert.equal(classifyPathToken('src/main/updater.ts'), 'edit');
  assert.equal(classifyPathToken('tools/copy-main-assets.cjs'), 'edit');
  assert.equal(classifyPathToken('electron-builder.yml'), 'edit');
  assert.equal(classifyPathToken('.github/workflows/release.yml'), 'edit');
});

test('images reveal rather than open — a click on a path is a navigation gesture', () => {
  for (const p of ['build/icon.png', 'shot.JPEG', 'a/b/logo.svg', 'anim.webp']) {
    assert.equal(classifyPathToken(p), 'reveal', p);
  }
});

test('anything we cannot honestly render reveals instead of guessing', () => {
  for (const p of ['report.pdf', 'dump.bin', 'archive.zip', 'db.sqlite', 'font.woff2']) {
    assert.equal(classifyPathToken(p), 'reveal', p);
  }
});

test('an executable never classifies as anything but reveal', () => {
  // The whole safety argument: reveal opens a file browser, it never launches.
  for (const p of ['installer.dmg', 'Payload.app', 'setup.exe', 'run.desktop']) {
    assert.equal(classifyPathToken(p), 'reveal', p);
  }
});

/* ---------------------------------------------------------------- *
 * matching — the part that goes wrong
 * ---------------------------------------------------------------- */

test('version strings and decimals are not files', () => {
  assert.deepEqual(tokensIn('bumped to v0.4.5 after 1.5 hours, cost $0.92'), []);
  assert.deepEqual(tokensIn('electron 43.0 and vite 7.1.2'), []);
});

test('a bare unknown extension needs a separator to count as a path', () => {
  // No separator and an extension we do not know: could be prose. Left alone.
  assert.deepEqual(tokensIn('the release is codenamed spring.thaw'), []);
  // Same extension, now unambiguously a path.
  assert.deepEqual(tokensIn('wrote out/spring.thaw'), ['out/spring.thaw']);
});

test('a known extension is a path with or without a separator', () => {
  assert.deepEqual(tokensIn('see RELEASE.md'), ['RELEASE.md']);
  assert.deepEqual(tokensIn('edited package.json'), ['package.json']);
});

test('several tokens on one line all resolve independently', () => {
  assert.deepEqual(
    tokensIn('moved src/main/updater.ts and build/icon.png, see RELEASE.md'),
    ['src/main/updater.ts', 'build/icon.png', 'RELEASE.md']
  );
});

test('shell and prose wrapping comes off, and so does :line', () => {
  assert.equal(stripPathToken('`src/main/index.ts`'), 'src/main/index.ts');
  assert.equal(stripPathToken('"docs/a.md",'), 'docs/a.md');
  assert.equal(stripPathToken('(build/icon.png)'), 'build/icon.png');
  assert.equal(stripPathToken('src/main/updater.ts:165'), 'src/main/updater.ts');
});

test('a :line suffix survives matching and still classifies by extension', () => {
  assert.deepEqual(tokensIn('fails at src/main/updater.ts:165'), ['src/main/updater.ts']);
  assert.equal(classifyPathToken('src/main/updater.ts'), 'edit');
});

test('absolute, home, and Windows paths are all recognised', () => {
  assert.deepEqual(tokensIn('at /Users/x/notes.md'), ['/Users/x/notes.md']);
  assert.deepEqual(tokensIn('at ~/HarnessAgents/board.md'), ['~/HarnessAgents/board.md']);
  assert.deepEqual(tokensIn('at C:\\Users\\x\\a.ts'), ['C:\\Users\\x\\a.ts']);
});

test('quoted paths with spaces keep their entire path, including the Windows drive', () => {
  assert.deepEqual(
    tokensIn('saved "C:\\Users\\Jane\\Business Reports\\summary.md"'),
    ['C:\\Users\\Jane\\Business Reports\\summary.md']
  );
  assert.deepEqual(tokensIn("saved '/Users/Jane/Business Reports/summary.md'"), ['/Users/Jane/Business Reports/summary.md']);
  assert.deepEqual(tokensIn('saved `~/Business Reports/summary.md`'), ['~/Business Reports/summary.md']);
  assert.deepEqual(tokensIn('saved "./Business Reports/summary.md"'), ['./Business Reports/summary.md']);
  assert.deepEqual(tokensIn('saved "../Business Reports/summary.md"'), ['../Business Reports/summary.md']);
  assert.deepEqual(tokensIn('saved "\\Business Reports\\summary.md"'), ['\\Business Reports\\summary.md']);
});

test('quoted paths coexist with unquoted paths and preserve line suffix handling', () => {
  assert.deepEqual(
    tokensIn('see "./src/my folder/index.ts:42", build/icon.png and \'./docs/my notes.md\''),
    ['./src/my folder/index.ts', 'build/icon.png', './docs/my notes.md']
  );
});

test('quoted prose keeps linking the file name inside it', () => {
  assert.deepEqual(tokensIn('git commit -m "Update README.md"'), ['README.md']);
  assert.deepEqual(tokensIn('error: "Could not read config.yml"'), ['config.yml']);
  assert.deepEqual(tokensIn("Michael's notes: see plan.md' later"), ['plan.md']);
});

test('quoted prose that starts with a slash links only the file name inside it', () => {
  assert.deepEqual(tokensIn('note: "/ see notes.md"'), ['notes.md']);
  assert.deepEqual(tokensIn("note: '/ see notes.md'"), ['notes.md']);
  assert.deepEqual(tokensIn('note: `./ then open plan.md`'), ['plan.md']);
  // a real path with spaces inside its folder names still links whole
  assert.deepEqual(tokensIn('saved "/Users/Jane/Business Reports/summary.md"'), ['/Users/Jane/Business Reports/summary.md']);
});

test('quoted versions and prose do not become file paths', () => {
  assert.deepEqual(tokensIn('version "v0.4.5", cost \'0.92\', called `spring.thaw`'), []);
});

test('a dotted directory name cannot masquerade as an extension', () => {
  // extensionOf looks at the LAST segment only, so v1.2 here is not the extension.
  assert.equal(classifyPathToken('reports/v1.2/summary.md'), 'preview');
});

test('case does not decide the verdict', () => {
  assert.equal(classifyPathToken('README.MD'), 'preview');
  assert.equal(classifyPathToken('src/App.TSX'), 'edit');
});

test('a link covers the cells of its path, past wide characters and inside its quotes', () => {
  // Value: protects=the underline and click land on the path when the line holds Chinese text or quotes; fails_when=string offsets are used as cell columns or the quotes are underlined; why_new=design review of #280; seam=none
  const { linkCellRange } = loadTs('src/shared/terminalPaths.ts');
  const cellsFor = (s) => [...s].flatMap((ch) => (/[一-鿿]/.test(ch) ? [{ chars: ch, width: 2 }, { chars: '', width: 0 }] : [{ chars: ch, width: 1 }]));
  const line = '报告 "/tmp/a b.md"';
  const raw = '"/tmp/a b.md"';
  const start = line.indexOf(raw);
  assert.deepEqual(linkCellRange(cellsFor(line), start, start + raw.length, raw), { startX: 7, endX: 17 });
  const plain = 'see notes.md';
  assert.deepEqual(linkCellRange(cellsFor(plain), 4, 12, 'notes.md'), { startX: 5, endX: 12 });
});

test('a dotfile is named by its type: .gitignore, .env and .npmrc open as text', () => {
  // Value: protects=dotfiles on the edit list open for editing instead of revealing; fails_when=the dotfile rule is dropped or extensionOf's no-extension answer wins; why_new=gitignore, dockerignore, env and npmrc never matched a real dotfile; seam=none; no_claim=a long dotfile name as a token, which waits on the longer extension fix (#190)
  for (const p of ['.gitignore', 'src/.dockerignore', './.env', '~/.npmrc', 'C:\\proj\\.editorconfig']) {
    assert.equal(classifyPathToken(p), 'edit', p);
  }
  assert.deepEqual(tokensIn('wrote ./.env and ~/.npmrc'), ['./.env', '~/.npmrc']);
  // A dotfile that is not on a list is still only revealed, and a name with a
  // real extension after the dot keeps it.
  assert.equal(classifyPathToken('~/.bashrc'), 'reveal');
  assert.equal(classifyPathToken('.env.local'), 'reveal');
  assert.equal(classifyPathToken('src/.eslintrc.json'), 'edit');
});

test('extensions longer than 8 characters match without truncation and classify correctly', () => {
  // Bare properties file (10-char extension in EDIT_EXTS)
  assert.deepEqual(tokensIn('check application.properties for db config'), ['application.properties']);
  assert.equal(classifyPathToken('application.properties'), 'edit');

  // Quoted path containing spaces and explicit path prefix
  assert.deepEqual(tokensIn('saved "./My Docs/app.properties" in project'), ['./My Docs/app.properties']);
  assert.equal(classifyPathToken('./My Docs/app.properties'), 'edit');

  // Windows path with long extension
  assert.deepEqual(tokensIn('configured C:\\proj\\settings.properties successfully'), ['C:\\proj\\settings.properties']);
  assert.equal(classifyPathToken('C:\\proj\\settings.properties'), 'edit');

  // Existing short extensions and version-like strings behave correctly
  assert.deepEqual(tokensIn('built src/index.ts in v0.4.5 after 1.5 hours'), ['src/index.ts']);
  assert.equal(classifyPathToken('src/index.ts'), 'edit');
});
