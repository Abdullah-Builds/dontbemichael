'use strict';

/**
 * An office is recognised by its folder, never by the business name typed into
 * setup (owner, 2026-09-24).
 *
 * After the 0.0.2 data folder rename, setup ran again. The team's folders are
 * `~/Documents/<Business name>/<Folder>`, so a name typed differently would have
 * pointed the team at new, empty folders while the real office sat in the home
 * folder. Now the office records itself in `<home>/office.json` (or is read from
 * its hive registry), setup offers to continue it, and team start brings back a
 * member the registry knows but the floor lost, in the folder it really uses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { windowsOnly } = require('./platform.cjs');

const rec = loadTs('src/shared/officeRecord.ts');
const file = loadTs('src/main/officeFile.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const DOCS = '/Users/owner/Documents/SunriseBakery';
const team = [
  { agentId: 'oscar', folder: `${DOCS}/Finance` },
  { agentId: 'pam', folder: `${DOCS}/Admin` }
];
const cfg = {
  onboardingComplete: true,
  harnessHome: '/Users/owner/HarnessAgents',
  businessName: 'SunriseBakery',
  businessCity: 'Mountain View, CA',
  businessType: 'saas-consulting',
  businessFolder: DOCS,
  businessTeam: team
};

// --- the record, as plain data ---------------------------------------------

test('the config describes the office once setup has finished, and not before', () => {
  assert.equal(rec.officeRecordFromConfig({ ...cfg, onboardingComplete: false }), null);
  assert.equal(rec.officeRecordFromConfig({ ...cfg, harnessHome: null }), null);
  assert.deepEqual(rec.officeRecordFromConfig(cfg), {
    version: 1,
    businessName: 'SunriseBakery',
    businessCity: 'Mountain View, CA',
    businessType: 'saas-consulting',
    businessFolder: DOCS,
    team
  });
  // An office set up before 2026-09-25 recorded its shared Office folder;
  // Michael's folder is the one holding it.
  const { businessFolder, ...older } = cfg;
  void businessFolder;
  assert.equal(rec.officeRecordFromConfig({ ...older, officeFolder: `${DOCS}/Office` }).businessFolder, DOCS);
  assert.equal(rec.parseOfficeRecord({ version: 1, officeFolder: `${DOCS}/Office`, team }).businessFolder, DOCS);
});

test('a record read from disk is checked, and junk is dropped rather than trusted', () => {
  assert.equal(rec.parseOfficeRecord(null), null);
  assert.equal(rec.parseOfficeRecord({ version: 2, team }), null);
  const parsed = rec.parseOfficeRecord({
    version: 1,
    businessName: '  ',
    team: [...team, { agentId: 'pam', folder: '/dup' }, { agentId: '', folder: '/x' }, 'nope']
  });
  assert.equal(parsed.businessName, undefined);
  assert.deepEqual(parsed.team, team, 'duplicates, blanks and non-objects are dropped');
});

test('an older office is described from its registry: every member with a folder, never Michael', () => {
  const r = rec.officeRecordFromRegistry({
    god: { id: 'god', cwd: '/Users/owner/HarnessAgents/hive/agents/god' },
    oscar: { id: 'oscar', cwd: `${DOCS}/Finance` },
    pam: { id: 'pam', cwd: `${DOCS}/Admin` },
    toby: { id: 'toby', cwd: `${DOCS}/HR`, archived: true },
    ghost: { id: 'ghost' }
  });
  // archived in the registry means its terminal closed (every agent, on quit),
  // not that the owner removed it, so Toby is still on the team.
  assert.deepEqual(r.team, [...team, { agentId: 'toby', folder: `${DOCS}/HR` }]);
  assert.equal(r.businessName, 'SunriseBakery', 'best guess: the folder the team shares');
  assert.equal(rec.officeRecordFromRegistry({ god: { id: 'god', cwd: '/x' } }), null, 'no team, nothing to continue');
});

test('continuing an office keeps its recorded folders, whatever name is typed this time', () => {
  const plan = rec.teamPlanFromRecord(rec.officeRecordFromConfig({ ...cfg, businessName: 'Sunrise Bakery' }));
  assert.equal(plan.ok, true);
  assert.equal(plan.business, DOCS);
  assert.deepEqual(plan.team, team);
  assert.deepEqual(plan.folders, [DOCS, `${DOCS}/Finance`, `${DOCS}/Admin`]);
});

test('an office with no recorded business folder uses the one its team shares', () => {
  const plan = rec.teamPlanFromRecord({ version: 1, team });
  assert.equal(plan.business, DOCS);
  assert.deepEqual(rec.teamPlanFromRecord({ version: 1, team: [] }), { ok: false });
  assert.deepEqual(rec.teamPlanFromRecord(null), { ok: false });
});

test('Windows drive paths share a business folder despite different casing', () => {
  const windowsTeam = [
    { agentId: 'oscar', folder: 'C:\\Biz\\Sales' },
    { agentId: 'pam', folder: 'c:\\biz\\Support' }
  ];
  const record = rec.officeRecordFromRegistry({
    oscar: { cwd: windowsTeam[0].folder },
    pam: { cwd: windowsTeam[1].folder }
  });
  assert.equal(record.businessName, 'Biz');
  const plan = rec.teamPlanFromRecord(record);
  assert.equal(plan.ok, true);
  assert.equal(plan.business, 'C:\\Biz', 'keep the first path\'s spelling');
  assert.deepEqual(plan.team, windowsTeam);
});

test('Windows UNC paths share a business folder despite different casing', () => {
  const windowsTeam = [
    { agentId: 'oscar', folder: '\\\\Server\\Share\\Biz\\Sales' },
    { agentId: 'pam', folder: '\\\\server\\share\\biz\\Support' }
  ];
  const record = rec.officeRecordFromRegistry({
    oscar: { cwd: windowsTeam[0].folder },
    pam: { cwd: windowsTeam[1].folder }
  });
  assert.equal(record.businessName, 'Biz');
  const plan = rec.teamPlanFromRecord(record);
  assert.equal(plan.ok, true);
  assert.equal(plan.business, '\\\\Server\\Share\\Biz', 'keep the first UNC path\'s spelling');
  assert.deepEqual(plan.team, windowsTeam);
});

test('slash-style UNC paths keep their spelling with a backslash-style registry peer', () => {
  const team = [
    { agentId: 'oscar', folder: '//Server/Share/Biz/Sales' },
    { agentId: 'pam', folder: '\\\\server\\share\\biz\\Support' }
  ];
  const record = rec.officeRecordFromRegistry({
    oscar: { cwd: team[0].folder },
    pam: { cwd: team[1].folder }
  });
  assert.equal(record.businessName, 'Biz');
  assert.equal(rec.teamPlanFromRecord(record).business, '//Server/Share/Biz');
});

test('a UNC server or share root is not a business folder', () => {
  for (const folders of [
    ['\\\\Server\\ShareA\\Sales', '\\\\server\\ShareB\\Support'],
    ['\\\\Server\\Share\\Sales', '\\\\server\\share\\Support']
  ]) {
    const record = rec.officeRecordFromRegistry({
      oscar: { cwd: folders[0] },
      pam: { cwd: folders[1] }
    });
    assert.equal(record.businessName, undefined);
    assert.deepEqual(rec.teamPlanFromRecord(record), { ok: false });
  }
});

test('POSIX path segments remain case-sensitive when finding a shared folder', () => {
  assert.deepEqual(rec.teamPlanFromRecord({
    version: 1,
    team: [
      { agentId: 'oscar', folder: '/Biz/Sales' },
      { agentId: 'pam', folder: '/biz/Support' }
    ]
  }), { ok: false });
});

// --- the file, on disk -------------------------------------------------------

function office() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  fs.mkdirSync(path.join(home, 'hive'), { recursive: true });
  fs.writeFileSync(path.join(home, 'hive', 'registry.json'), JSON.stringify({
    godId: 'god',
    agents: {
      god: { id: 'god', cwd: path.join(home, 'hive', 'agents', 'god') },
      oscar: { id: 'oscar', cwd: `${DOCS}/Finance` },
      pam: { id: 'pam', cwd: `${DOCS}/Admin` }
    }
  }));
  return home;
}

test('a config save writes office.json, and an unchanged one is not rewritten', () => {
  const home = office();
  try {
    assert.equal(file.syncOfficeRecord({ ...cfg, harnessHome: home }), true);
    assert.equal(file.readOfficeRecord(home).businessName, 'SunriseBakery');
    assert.equal(file.syncOfficeRecord({ ...cfg, harnessHome: home }), false, 'same record, no write');
    assert.equal(file.syncOfficeRecord({ ...cfg, harnessHome: home, businessCity: 'Austin, TX' }), true);
    assert.equal(file.syncOfficeRecord({ ...cfg, harnessHome: path.join(home, 'gone') }), false, 'a missing office is never recreated');
    assert.equal(file.syncOfficeRecord({ ...cfg, onboardingComplete: false, harnessHome: home }), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('finding an office: its own record first, its registry for an older office, nothing for an empty folder', () => {
  const home = office();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  try {
    const older = file.findOffice(home);
    assert.equal(older.hasOffice, true);
    assert.equal(older.source, 'registry');
    assert.deepEqual(older.record.team, team);

    file.syncOfficeRecord({ ...cfg, harnessHome: home });
    const recorded = file.findOffice(home);
    assert.equal(recorded.source, 'file');
    assert.equal(recorded.record.businessType, 'saas-consulting');

    assert.deepEqual(file.findOffice(empty), { path: empty, hasOffice: false, record: null, source: null });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('an older Windows office keeps its team when registry paths differ in case', windowsOnly('Windows drive paths ignore case on disk'), () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const business = fs.mkdtempSync(path.join(os.tmpdir(), 'Biz Office-'));
  try {
    fs.mkdirSync(path.join(business, 'Sales'));
    fs.mkdirSync(path.join(business, 'Support'));
    fs.mkdirSync(path.join(home, 'hive'));
    const sales = path.join(business, 'Sales');
    const support = path.join(business.toLowerCase(), 'Support');
    fs.writeFileSync(path.join(home, 'hive', 'registry.json'), JSON.stringify({
      agents: { oscar: { cwd: sales }, pam: { cwd: support } }
    }));

    const found = file.findOffice(home);
    assert.equal(found.source, 'registry');
    assert.equal(found.record.businessFolder, business);
    assert.deepEqual(found.record.team, [
      { agentId: 'oscar', folder: sales },
      { agentId: 'pam', folder: support }
    ]);
    assert.equal(rec.teamPlanFromRecord(found.record).business, business);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(business, { recursive: true, force: true });
  }
});

// --- wiring ------------------------------------------------------------------

test('main writes office.json only when the office itself changes, and backfills it carefully', () => {
  const main = read('src/main/index.ts');
  // Switching offices saves harnessHome alone; it must never copy the previous
  // office's (global) business fields into the new office's record.
  assert.match(main, /const next = writeConfig\(patch\);[\s\S]{0,500}if \(touchesOffice\(patch\)\) syncOfficeRecord\(next\);/);
  const hook = main.slice(main.indexOf('onConfigWritten((config) => {'), main.indexOf('onConfigWritten((config) => {') + 300);
  assert.doesNotMatch(hook, /syncOfficeRecord/);
  assert.match(main, /backfillOfficeRecord\(readConfig\(\)\);/);
  assert.match(main, /ipcMain\.handle\('office:find'/);
});

test('only saves that describe the office count, and the backfill needs the office to agree', () => {
  assert.equal(rec.touchesOffice({ harnessHome: '/x' }), false, 'switching offices');
  assert.equal(rec.touchesOffice({ autoMode: true }), false);
  for (const k of rec.OFFICE_FIELDS) assert.equal(rec.touchesOffice({ [k]: undefined }), true, k);
  const agents = { oscar: { id: 'oscar', cwd: `${DOCS}/Finance` }, pam: { id: 'pam', cwd: `${DOCS}/Admin/` } };
  assert.equal(rec.configMatchesRegistry(cfg, agents, false), true, 'same folders (a trailing slash is the same folder)');
  const typedDifferently = { ...cfg, businessTeam: team.map((m) => ({ ...m, folder: m.folder.replace('SunriseBakery', 'SunRiseBakery') })) };
  assert.equal(rec.configMatchesRegistry(typedDifferently, agents, true), true, 'macOS folder names ignore case');
  assert.equal(rec.configMatchesRegistry(typedDifferently, agents, false), false);
  assert.equal(rec.configMatchesRegistry(cfg, { oscar: agents.oscar }, true), false, 'a member this office never had');
  assert.equal(rec.configMatchesRegistry({ ...cfg, businessTeam: [] }, agents, true), false);
});

test('the launch backfill skips an office whose registry holds a different team', () => {
  const home = office(); // registry: oscar and pam in DOCS
  try {
    const other = { ...cfg, harnessHome: home, businessTeam: [{ agentId: 'kelly', folder: '/Users/owner/Documents/Other/Support' }] };
    assert.equal(file.backfillOfficeRecord(other), false);
    assert.equal(file.readOfficeRecord(home), null, 'nothing written');
    assert.equal(file.backfillOfficeRecord({ ...cfg, harnessHome: home }), true, 'its own team: written');
    assert.equal(file.backfillOfficeRecord({ ...cfg, harnessHome: home }), false, 'only once');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('setup opens on the office it found, and continuing uses the recorded team and folders', () => {
  const wiz = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(wiz, /window\.cth\.officeFind\(DEFAULT_HOME\)/);
  assert.match(wiz, /setStep\(\(s\) => \(s === 'business' \? 'resume' : s\)\)/);
  // Offered only when the office can really be continued, so Finish can't dead-end.
  assert.match(wiz, /!f\.record \|\| !teamPlanFromRecord\(f\.record\)\.ok\) return;/);
  assert.match(wiz, /const finishPlan = resuming && foundPlan \? foundPlan : plan;/);
  // The owner sees the folders before continuing.
  assert.match(wiz, /foundPlan\?\.ok && foundPlan\.folders\.map/);
  // A new office never lands in the folder of the one it found: the first free
  // "~/HarnessAgents N", or an empty field (the home step then asks) when none is.
  assert.match(wiz, /if \(!st\.exists\) \{ free = candidate; break; \}/);
  assert.match(wiz, /setHome\(free\);/);
});

test('team start brings back a member the registry knows but the floor lost, in its real folder', () => {
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.doesNotMatch(hive, /if \(reg\?\.agents\?\.\[id\]\) continue;/, 'no more skipping on the hope the roster restores it');
  assert.match(hive, /\[\.\.\.floor\.agents, \.\.\.floor\.archivedAgents, \.\.\.floor\.restorableAgents\]\.map\(\(a\) => a\.id\)/);
  assert.match(hive, /const decision = teamMemberStart\(id, member\.folder, floorIds, reg\?\.agents\?\.\[id\]\?\.cwd\);/);
  assert.doesNotMatch(hive, /\.archived\) continue/, 'the registry archived flag is not a removal');
});

// --- which members team start starts ------------------------------------------

const { teamMemberStart } = loadTs('src/shared/teamPlan.ts');

test('team start leaves the floor alone and brings a lost member back in its real folder', () => {
  const floor = new Set(['oscar']);
  assert.deepEqual(teamMemberStart('oscar', `${DOCS}/Finance`, floor, `${DOCS}/Finance`), { start: false }, 'already on the floor');
  assert.deepEqual(teamMemberStart('pam', '/Users/owner/Documents/Sunrise Bakery/Admin', floor, `${DOCS}/Admin`),
    { start: true, cwd: `${DOCS}/Admin` }, 'the registry folder wins over a name typed differently');
  assert.deepEqual(teamMemberStart('toby', `${DOCS}/HR`, floor, undefined), { start: true, cwd: `${DOCS}/HR` }, 'new member: setup folder');
  assert.deepEqual(teamMemberStart('toby', `${DOCS}/HR`, floor, '  '), { start: true, cwd: `${DOCS}/HR` });
});

// --- folders a record may name ------------------------------------------------

test('a record never sends agents to the disk root, the home folder, or key and settings folders', () => {
  const home = office();
  const h = os.homedir();
  try {
    fs.writeFileSync(path.join(home, 'office.json'), JSON.stringify({
      version: 1,
      businessFolder: h,
      team: [
        { agentId: 'oscar', folder: `${DOCS}/Finance` },
        { agentId: 'root', folder: '/' },
        { agentId: 'home', folder: h },
        { agentId: 'ssh', folder: path.join(h, '.ssh') },
        { agentId: 'claude', folder: path.join(h, '.claude', 'x') },
        { agentId: 'lib', folder: path.join(h, 'Library', 'Keychains') },
        { agentId: 'rel', folder: 'Documents/Finance' }
      ]
    }));
    const found = file.findOffice(home);
    assert.deepEqual(found.record.team.map((m) => m.agentId), ['oscar']);
    assert.notEqual(found.record.businessFolder, h, 'the home folder is not a business folder');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a disk root is never a usable folder, however its letters are cased', () => {
  // Value: protects=no agent is sent to a disk root on Windows; fails_when=the root check compares a lowercased path with an uppercased root again; why_new=Windows accepted C:\ because "c:\" !== "C:\"; seam=none
  const root = path.parse(os.tmpdir()).root;
  for (const r of [root, root.toLowerCase(), root.toUpperCase()]) {
    assert.equal(file.isUsableTeamFolder(r), false, r);
  }
});

test('an older office uses the folder its team shares as Michael\'s', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const biz = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-'));
  try {
    for (const f of ['Finance', 'Admin', 'Office']) fs.mkdirSync(path.join(biz, f));
    fs.mkdirSync(path.join(home, 'hive'), { recursive: true });
    fs.writeFileSync(path.join(home, 'hive', 'registry.json'), JSON.stringify({
      agents: {
        oscar: { id: 'oscar', cwd: path.join(biz, 'Finance'), archived: true },
        pam: { id: 'pam', cwd: path.join(biz, 'Admin'), archived: true }
      }
    }));
    const found = file.findOffice(home);
    assert.equal(found.record.businessFolder, biz);
    assert.equal(found.record.team.length, 2, 'archived in the registry is still on the team');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(biz, { recursive: true, force: true });
  }
});

test('an older office whose folders share only the home folder is not offered to continue', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const h = os.homedir();
  try {
    fs.mkdirSync(path.join(home, 'hive'), { recursive: true });
    fs.writeFileSync(path.join(home, 'hive', 'registry.json'), JSON.stringify({
      agents: {
        a: { id: 'a', cwd: path.join(h, 'code-app-that-does-not-exist') },
        b: { id: 'b', cwd: path.join(h, 'Documents', 'Other-that-does-not-exist', 'Sales') }
      }
    }));
    const found = file.findOffice(home);
    assert.equal(found.hasOffice, true);
    assert.deepEqual(found.record.team, [], 'no team to continue, so setup starts fresh');
    assert.equal(rec.teamPlanFromRecord(found.record).ok, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a team folder that is a link to the home folder counts as the home folder', () => {
  const home = office();
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'link-')), 'Finance');
  try {
    fs.symlinkSync(os.homedir(), link);
    fs.writeFileSync(path.join(home, 'office.json'), JSON.stringify({
      version: 1, businessFolder: DOCS, team: [{ agentId: 'oscar', folder: link }, ...team.slice(1)]
    }));
    assert.deepEqual(file.findOffice(home).record.team.map((m) => m.agentId), ['pam']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.dirname(link), { recursive: true, force: true });
  }
});

test('setup checks a folder picked by hand, and team start finds members in any pack', () => {
  const wiz = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(wiz, /if \(step === 'home'\) \{\s*setBusy\(true\);\s*const f = await window\.cth\.officeFind\(home\.trim\(\)\)/);
  assert.match(wiz, /setError\(t\('onboarding\.resume\.folderInUse'\)\);/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /for \(const p of \[pack, \.\.\.packs\.map\(\(x\) => x\.pack\), core\]\)/);
});

test('the folder check ignores letter case where the disk does', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, () => {
  const home = office();
  const h = os.homedir();
  try {
    fs.writeFileSync(path.join(home, 'office.json'), JSON.stringify({
      version: 1, businessFolder: DOCS,
      team: [...team, { agentId: 'lib', folder: path.join(h, 'LIBRARY', 'x') }, { agentId: 'home', folder: h.toUpperCase() }]
    }));
    assert.deepEqual(file.findOffice(home).record.team.map((m) => m.agentId), ['oscar', 'pam']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('an unknown business type picks the pack that holds most of the team; a failed folder check stops setup', () => {
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /\?\? byTeam \?\? core;/);
  const wiz = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(wiz, /if \(!f\) \{ setError\(t\('onboarding\.resume\.folderCheckFailed'\)\); return; \}/);
  assert.match(wiz, /disabled=\{busy \|\| \(step === 'orchestrator' && engineBlocked\)\}/);
});
