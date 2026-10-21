'use strict';

/**
 * Where agents' folders go on the owner's disk (Decisions 44, 45).
 *
 * Both inputs come from outside the app: the business name is typed by the
 * owner, and folder names come from packs that can be imported. The cases here
 * are the ones that would do lasting damage if they slipped through: a path
 * that climbs out of Documents, a name that nests unexpectedly, and a "create"
 * that clobbers something the owner already had.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { safeFolderName, businessFolderRoot, defaultAgentFolder, ensureFolder, OFFICE_FOLDER } =
  loadTs('src/main/agentFolders.ts');

// Unique per run: a shared fixed path collides across parallel checkouts and
// with a killed run's leftovers.
const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-folders-docs-'));
test.after(() => fs.rmSync(docs, { recursive: true, force: true }));

test('ordinary names pass through untouched', () => {
  for (const n of ['Finance', 'Client Records', 'Pho Saigon Kitchen & Catering', 'Café Olé']) {
    assert.equal(safeFolderName(n), n);
  }
});

test('path characters become a dash rather than a nested folder', () => {
  assert.equal(safeFolderName('A/B Consulting'), 'A-B Consulting');
  assert.equal(safeFolderName('Sales\\Leads'), 'Sales-Leads');
  assert.equal(safeFolderName('Q: What?'), 'Q- What-');
});

test('nothing can climb out: dots, hidden names and traversal are neutralised', () => {
  assert.equal(safeFolderName('../../.ssh'), 'ssh');
  assert.equal(safeFolderName('..'), 'Folder');
  assert.equal(safeFolderName('.hidden'), 'hidden');
  assert.equal(safeFolderName('Finance.'), 'Finance');
});

test('empty or unusable business names fall back to a sensible default', () => {
  assert.equal(path.basename(businessFolderRoot(docs, '')), 'My Business');
  assert.equal(path.basename(businessFolderRoot(docs, '   ')), 'My Business');
  assert.equal(path.basename(businessFolderRoot(docs, '///')), 'My Business');
});

test('Windows device names are made safe', () => {
  assert.equal(safeFolderName('CON'), 'CON-folder');
  assert.equal(safeFolderName('lpt1'), 'lpt1-folder');
});

test('a device name with an extension is made safe, the suffix before the first dot', () => {
  // Value: protects=a folder named CON.txt can be created and opened on Windows; fails_when=only the bare name is checked, or the suffix goes after the extension (Windows reads only the part before the first dot); why_new=PR #291; seam=none
  assert.equal(safeFolderName('CON.txt'), 'CON-folder.txt');
  assert.equal(safeFolderName('Aux.Studio'), 'Aux-folder.Studio');
  assert.equal(safeFolderName('com1.data'), 'com1-folder.data');
  assert.equal(safeFolderName('con.tar.gz'), 'con-folder.tar.gz');
  assert.equal(safeFolderName('NUL.log'), 'NUL-folder.log');
  // Not a device name: left as it is.
  assert.equal(safeFolderName('CONference'), 'CONference');
  assert.equal(safeFolderName('Console.Team'), 'Console.Team');
  assert.equal(safeFolderName('com10.data'), 'com10.data');
});

test('very long names are shortened without leaving a trailing space', () => {
  const n = safeFolderName('Word '.repeat(30));
  assert.ok(n.length <= 60, `${n.length}`);
  assert.doesNotMatch(n, /\s$/);
});

test('an agent folder is Documents/<Business>/<Folder>', () => {
  assert.equal(
    defaultAgentFolder(docs, 'Pho Saigon Kitchen', 'Finance'),
    path.join(docs, 'Pho Saigon Kitchen', 'Finance')
  );
  assert.equal(
    defaultAgentFolder(docs, 'Pho Saigon Kitchen', OFFICE_FOLDER),
    path.join(docs, 'Pho Saigon Kitchen', 'Office')
  );
});

test('hostile inputs on both sides still land inside the business folder', () => {
  const root = businessFolderRoot(docs, '../../etc');
  const p = defaultAgentFolder(docs, '../../etc', '../../../.ssh');
  assert.ok(root.startsWith(docs + path.sep), root);
  assert.ok(p.startsWith(root + path.sep), p);
});

test('ensureFolder creates a missing folder, parents included', () => {
  const p = path.join(docs, 'Biz', 'Marketing');
  const r = ensureFolder(p);
  assert.deepEqual(r, { ok: true, path: p, created: true });
  assert.ok(fs.statSync(p).isDirectory());
});

test('ensureFolder leaves an existing folder and its contents exactly as they were', () => {
  const p = path.join(docs, 'Biz', 'Finance');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'ledger.xlsx'), 'the owner\'s file');
  const r = ensureFolder(p);
  assert.deepEqual(r, { ok: true, path: p, created: false });
  assert.equal(fs.readFileSync(path.join(p, 'ledger.xlsx'), 'utf8'), 'the owner\'s file');
});

test('ensureFolder refuses when a file already sits where the folder would go', () => {
  const p = path.join(docs, 'Biz', 'Notes');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'a file, not a folder');
  const r = ensureFolder(p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /file with that name/);
  assert.equal(fs.readFileSync(p, 'utf8'), 'a file, not a folder', 'the file is untouched');
});

test('ensureFolder refuses a relative path rather than guessing where it goes', () => {
  assert.equal(ensureFolder('Finance').ok, false);
});

test('ensureFolder says plainly when the app may not create a folder there', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'needs POSIX permissions and a non-root user' : false
}, () => {
  // A parent the owner can't write to (a shared drive, someone else's folder).
  const locked = path.join(docs, 'Locked');
  fs.mkdirSync(locked, { recursive: true });
  fs.chmodSync(locked, 0o555);
  try {
    const r = ensureFolder(path.join(locked, 'Finance'));
    assert.equal(r.ok, false);
    assert.match(r.reason, /isn't allowed to create a folder there/);
    assert.ok(!fs.existsSync(path.join(locked, 'Finance')));
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});
