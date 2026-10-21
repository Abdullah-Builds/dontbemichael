'use strict';

/**
 * The pick-your-team step of onboarding (Decisions 44, 47): who starts picked,
 * which folder each agent works in, what needs connecting, and what finish
 * persists. The wizard is a view over these rules.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { OFFICE_KEY, folderNameFor, folderNames, initialPicks, folderFor, michaelFolderFor, connectionsNeeded, teamPlan } =
  loadTs('src/shared/teamPlan.ts');

const agent = (id, over = {}) => ({
  schemaVersion: 1, id, role: id[0].toUpperCase() + id.slice(1), summary: 's',
  does: [], wontDo: [], connections: [], tools: [], ...over
});

const oscar = agent('oscar', { role: 'Finance', folder: 'Finance', connections: [{ id: 'quickbooks', required: false }] });
const pam = agent('pam', { role: 'Admin', folder: 'Admin', connections: [{ id: 'email', required: true }] });
const kelly = agent('kelly', {
  role: 'Customer Care', folder: 'Customers',
  connections: [{ id: 'email', required: true }, { id: 'google-business', required: false }]
});
const creed = agent('creed', { role: 'Quality' }); // no folder: falls back to role
const pack = { agents: [oscar, pam, kelly, creed], defaultPicks: ['oscar', 'pam', 'kelly'] };

const suggestions = {
  root: '/D/Pho',
  byFolder: { Finance: '/D/Pho/Finance', Admin: '/D/Pho/Admin', Customers: '/D/Pho/Customers', Quality: '/D/Pho/Quality' }
};

test('an agent works in its pack folder, or its role when the pack names none', () => {
  assert.equal(folderNameFor(oscar), 'Finance');
  assert.equal(folderNameFor(creed), 'Quality');
  assert.deepEqual(folderNames(pack.agents), ['Finance', 'Admin', 'Customers', 'Quality']);
});

test('agents sharing a folder name ask for it once', () => {
  const twin = agent('ryan', { folder: 'Customers' });
  assert.deepEqual(folderNames([kelly, twin]), ['Customers']);
});

test('the pack\'s default picks start checked, and only those', () => {
  assert.deepEqual(initialPicks(pack), { oscar: true, pam: true, kelly: true, creed: false });
});

test('the owner\'s folder choice wins over the suggestion', () => {
  assert.equal(folderFor(oscar, suggestions, {}), '/D/Pho/Finance');
  assert.equal(folderFor(oscar, suggestions, { oscar: '/Users/me/Dropbox/Books' }), '/Users/me/Dropbox/Books');
});

test('no folder is invented before main has said where folders go', () => {
  assert.equal(folderFor(oscar, undefined, {}), undefined);
});

test('accounts to connect: counted once, and required wins over optional', () => {
  const picked = { oscar: true, pam: true, kelly: true, creed: false };
  assert.deepEqual(connectionsNeeded(pack.agents, picked), {
    required: ['email'],
    optional: ['quickbooks', 'google-business']
  });
});

test('unpicked agents add nothing to connect', () => {
  assert.deepEqual(connectionsNeeded(pack.agents, { creed: true }), { required: [], optional: [] });
});

test('finish persists only picked agents, each with its folder, Michael\'s first and deduplicated', () => {
  const plan = teamPlan(pack.agents, { oscar: true, pam: false, kelly: true, creed: true }, suggestions,
    { kelly: '/D/Pho/Finance' }); // owner pointed Kelly at Oscar's folder: they share it
  assert.equal(plan.ok, true);
  assert.equal(plan.business, '/D/Pho');
  assert.deepEqual(plan.team, [
    { agentId: 'oscar', folder: '/D/Pho/Finance' },
    { agentId: 'kelly', folder: '/D/Pho/Finance' },
    { agentId: 'creed', folder: '/D/Pho/Quality' }
  ]);
  assert.deepEqual(plan.folders, ['/D/Pho', '/D/Pho/Finance', '/D/Pho/Quality']);
});

test('picking Michael\'s folder moves the team\'s default folders with it', () => {
  const picked = { [OFFICE_KEY]: '/Users/me/Dropbox/Pho' };
  // Until main has worked out the defaults under the new folder, nothing is ready.
  assert.equal(teamPlan(pack.agents, { oscar: true }, suggestions, picked).ok, false);
  assert.equal(michaelFolderFor(suggestions, picked), '/Users/me/Dropbox/Pho');
  const moved = {
    root: '/Users/me/Dropbox/Pho',
    byFolder: { Finance: '/Users/me/Dropbox/Pho/Finance', Admin: '/Users/me/Dropbox/Pho/Admin' }
  };
  const plan = teamPlan(pack.agents, { oscar: true }, moved, picked);
  assert.equal(plan.business, '/Users/me/Dropbox/Pho');
  assert.deepEqual(plan.team, [{ agentId: 'oscar', folder: '/Users/me/Dropbox/Pho/Finance' }]);
  // A folder main refused (the home folder, say) never becomes the plan.
  assert.equal(teamPlan(pack.agents, { oscar: true }, { ...moved, rootRefused: true }, picked).ok, false);
});

test('Michael\'s folder is the suggested business folder until the owner picks one', () => {
  assert.equal(michaelFolderFor(suggestions, {}), suggestions.root);
});

test('a team of just Michael is allowed', () => {
  const plan = teamPlan(pack.agents, {}, suggestions, {});
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.team, []);
  assert.deepEqual(plan.folders, ['/D/Pho']);
});

test('not ready until every folder is resolved', () => {
  assert.equal(teamPlan(pack.agents, { oscar: true }, undefined, {}).ok, false);
  const partial = { ...suggestions, byFolder: { Finance: '/D/Pho/Finance' } };
  assert.equal(teamPlan(pack.agents, { oscar: true, pam: true }, partial, {}).ok, false);
});

// ─── Starting a picked team member ───────────────────────────────────────────

const { teamMemberName, teamMemberRole, teamMemberGoal, teamAccent } = loadTs('src/shared/teamPlan.ts');

test('a team member is named after their character', () => {
  assert.equal(teamMemberName({ id: 'oscar', character: 'oscar' }), 'Oscar');
  assert.equal(teamMemberName({ id: 'kelly' }), 'Kelly');
});

test('the role is the job title plus the plain-language summary, so Michael can route by it', () => {
  assert.equal(teamMemberRole({ role: 'Finance', summary: 'Tracks food cost.' }), 'Finance: Tracks food cost.');
});

test('the Work style comes from the pack, with the business filled in', () => {
  const ws = 'The owner set this work style for your role at {Business}, {City}.\n\n### The job\nTrack food cost.';
  assert.equal(
    teamMemberGoal({ role: 'Finance', summary: 's', does: [], wontDo: [], workStyle: ws }, { name: 'Pho Saigon Kitchen', city: 'Austin, TX' }),
    'The owner set this work style for your role at Pho Saigon Kitchen, Austin, TX.\n\n### The job\nTrack food cost.'
  );
  assert.match(teamMemberGoal({ role: 'F', summary: 's', does: [], wontDo: [], workStyle: ws }, {}), /^The owner set this work style for your role at the business\./, 'no name, no city');
  assert.equal(teamMemberRole({ role: 'Finance', summary: 'owner card text', routing: 'Oscar keeps the books.' }), 'Finance: Oscar keeps the books.');
});

test('a business name or city with a dollar sign is filled in as typed', () => {
  const ws = 'Your role at {Business}, {City}.';
  const goal = (business) => teamMemberGoal({ role: 'Finance', summary: 's', does: [], wontDo: [], workStyle: ws }, business);
  assert.equal(goal({ name: 'Ca$$h Cuts', city: 'Austin' }), 'Your role at Ca$$h Cuts, Austin.');
  assert.equal(goal({ name: 'Buck$& Co', city: "St. $' Paul" }), "Your role at Buck$& Co, St. $' Paul.");
});

test('an imported pack agent without a Work style gets one from its card fields, written to it', () => {
  const goal = teamMemberGoal(
    { role: 'Finance', summary: 'Tracks food cost.', does: ['Watch invoices'], wontDo: ['Move money'] },
    { name: 'Pho Saigon Kitchen', city: 'Austin, TX' }
  );
  assert.equal(goal, [
    'The owner set this work style for your role at Pho Saigon Kitchen, Austin, TX.',
    '',
    'The job: Tracks food cost.',
    '',
    'What you do:',
    '• Watch invoices',
    '',
    "Needs the owner's approval (send it to Michael first):",
    '• Move money'
  ].join('\n'));
  assert.doesNotMatch(goal, /You are the/);
});

test('team colours cycle, with Michael\'s lemon last', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(teamAccent), ['mint', 'sky', 'coral', 'lilac', 'peach', 'lemon', 'mint']);
});

test('Michael hears who did not start, by name, and that the app tries again', () => {
  const { didNotStartNote } = loadTs('src/shared/teamPlan.ts');
  assert.deepEqual(didNotStartNote(['Pam'], false), {
    subject: 'Pam did not start',
    body: 'Pam did not start when the office opened and is not on the floor. The app tries again the next time the office opens. Tell the owner who is missing.'
  });
  const two = didNotStartNote(['Pam', 'Jim', 'Oscar'], true);
  assert.equal(two.subject, 'Team members did not start');
  assert.match(two.body, /^Pam, Jim and Oscar did not start again on this launch and are not on the floor\./);
});

test("Michael's briefing names a business or city with a dollar sign as typed", () => {
  // Value: protects=Michael is told the business's real name; fails_when=String.replace reads $$, $& or $' in the name as a pattern; why_new=the same fill as fillBusiness, in hive.ts; seam=none
  const { michaelInstructions } = loadTs('src/main/hive.ts');
  const paths = { inbox: 'i', inboxDone: 'd', outbox: 'o', protocol: 'p', hiveRoot: 'h' };
  const text = michaelInstructions('Michael', { name: 'Ca$$h Cuts', city: "Austin$'", briefing: 'Welcome to {Business} in {City}. {City} is home.' }, paths);
  assert.match(text, /Welcome to Ca\$\$h Cuts in Austin\$'\. Austin\$' is home\./);
});
