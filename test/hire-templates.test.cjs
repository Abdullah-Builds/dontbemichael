'use strict';

/**
 * The hire wizard's jobs, folders and instant overlap rules
 * (src/shared/hireTemplates.ts, docs/designs/hire-redesign.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const H = loadTs('src/shared/hireTemplates.ts');
const { OFFICE_CAST } = (() => {
  // cast.ts imports renderer paths; read the names from the source instead.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/scene/office/cast.ts'), 'utf8');
  const names = [...src.matchAll(/name: '([a-z]+)'/g)].map((m) => m[1]);
  return { OFFICE_CAST: [...new Set(names)] };
})();

const packsDir = path.resolve(__dirname, '..', 'resources/packs');
const all = fs.readdirSync(packsDir).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(packsDir, f), 'utf8')));
const core = all.find((p) => p.businessType === 'core');
const packs = all.filter((p) => p !== core);
const business = { name: 'Taco Shop', city: 'Austin' };

test('every character but Michael has a job family whose card exists in some pack', () => {
  const cards = H.cardJobs(packs, core, 'restaurant-food', business);
  // Pete is the Research member's own face, never a hire's (owner, third ship D4).
  for (const c of OFFICE_CAST.filter((n) => n !== 'michael' && n !== 'pete')) {
    const job = H.ownJob(c, [], cards);
    assert.ok(job, `${c} has a job`);
  }
});

test('the office pack comes first, core text shown once, every job filled for the business', () => {
  const cards = H.cardJobs(packs, core, 'restaurant-food', business);
  assert.equal(cards[0].sourceCard.split('/')[0], 'restaurant-food');
  const keys = cards.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of cards) {
    assert.doesNotMatch(c.workStyle, /\{Business\}|\{City\}/);
    assert.ok(c.title && c.routing, c.key);
  }
  // Erin's own job in a restaurant is this office's Pam card.
  assert.equal(H.ownJob('erin', [], cards).sourceCard, 'restaurant-food/pam');
  // Nick's own job in a restaurant is the restaurant's IT card.
  assert.equal(H.ownJob('nick', [], cards).sourceCard, 'restaurant-food/nick');
});

test('a live teammate in the family wins over the card, with the owner edits', () => {
  const cards = H.cardJobs(packs, core, 'restaurant-food', business);
  const team = H.teamJobs([
    { id: 'michael', name: 'Michael', isGod: true, description: 'office manager' },
    { id: 'pam', name: 'Pam', character: 'pam', description: 'Executive Admin: Pam sorts the catering inbox.', goal: 'Pam: edited by the owner.' }
  ], cards);
  assert.equal(team.length, 1);
  const job = H.ownJob('erin', team, cards);
  assert.equal(job.key, 'team:pam');
  const copy = H.jobFor(job, 'Erin');
  assert.equal(copy.routing, 'Erin sorts the catering inbox.');
  assert.equal(copy.workStyle, 'Erin: edited by the owner.');
});

test('name swap is whole word only', () => {
  assert.equal(H.swapName('Pam and Pamphlets; ask Pam.', 'Pam', 'Erin'), 'Erin and Pamphlets; ask Erin.');
  assert.equal(H.swapName('text', '', 'Erin'), 'text');
});

test('a new name with a dollar sign is written as typed', () => {
  assert.equal(H.swapName('Pam sorts the inbox. Ask Pam.', 'Pam', 'A$$AP'), 'A$$AP sorts the inbox. Ask A$$AP.');
  assert.equal(H.swapName('Ask Pam first.', 'Pam', 'Mr $& Jr'), 'Ask Mr $& Jr first.');
  assert.equal(H.swapName('Ask Pam first.', 'Pam', "Cash$'"), "Ask Cash$' first.");
});

test('a hire gets its own folder, suffixed with its name on a clash', () => {
  const taken = new Set(['Admin', 'Admin_Erin']);
  assert.equal(H.hireFolderName('Finance', 'Kevin', (f) => taken.has(f)), 'Finance');
  assert.equal(H.hireFolderName('Admin', 'Jim', (f) => taken.has(f)), 'Admin_Jim');
  assert.equal(H.hireFolderName('Admin', 'Erin', (f) => taken.has(f)), 'Admin_Erin_2');
});

test('a folder name never ends in a dot or a space that Windows would drop', () => {
  // "a".repeat(59) + " b" is 61 chars: the 60-char cut used to leave a
  // trailing space, which Windows silently drops from the folder on disk.
  const long = H.safeFolder(`${'a'.repeat(59)} b`);
  assert.equal(long.length, 59);
  assert.equal(long, 'a'.repeat(59));
  assert.equal(H.safeFolder('AR/AP Clerk'), 'AR-AP Clerk');
  assert.equal(H.safeFolder('  ..Reports  '), 'Reports');
  assert.equal(H.hireFolderName('Sales', 'Dwight.', (f) => f === 'Sales'), 'Sales_Dwight');
});

test('the rules flag a near copy of what to send, not a title', () => {
  const pam = { name: 'Pam', title: 'Executive Admin', routing: 'Pam sorts the business inbox: customer orders, catering enquiries, supplier mail and bills.' };
  const ryan = { name: 'Ryan', title: 'Marketing', routing: 'Ryan writes the daily special, promotions and social posts.' };
  // The title alone decides nothing: same title with different work is not flagged.
  assert.deepEqual(H.overlapsByRules({ name: 'Erin', title: 'Executive Admin', routing: 'Erin books travel and keeps the owner calendar.' }, [pam, ryan]), []);
  assert.deepEqual(H.overlapsByRules({ name: 'Erin', title: 'Receptionist', routing: 'Erin sorts the business inbox: customer orders, catering enquiries, supplier mail and bills.' }, [pam, ryan]), ['Pam']);
  assert.deepEqual(H.overlapsByRules({ name: 'Jim', title: 'Social Media', routing: 'Jim follows the company Instagram feed and answers comments.' }, [pam, ryan]), []);
});

test('a binding scopes the new line and hands the rest back once', () => {
  const b = H.bindingLines('the support@ mailbox', 'Erin');
  assert.equal(b.own, 'Only the support@ mailbox.');
  assert.equal(b.others, 'Not for the support@ mailbox; that goes to Erin.');
  assert.equal(H.appendOnce(H.appendOnce('Pam sorts mail.', b.others), b.others), `Pam sorts mail. ${b.others}`);
});

test('the AI verdict keeps only real teammate names and falls back to null on junk', () => {
  const v = H.parseDistinctAnswer('ok {"distinct": false, "overlapsWith": ["pam", "Bob"], "why": "Both sort mail.", "suggestion": "Bind to support@"}', ['Pam', 'Ryan']);
  assert.deepEqual(v.overlapsWith, ['Pam']);
  assert.equal(v.distinct, false);
  assert.equal(v.source, 'ai');
  assert.equal(H.parseDistinctAnswer('{"distinct": true, "overlapsWith": ["Ryan"]}', ['Ryan']).distinct, false);
  assert.equal(H.parseDistinctAnswer('no json here', ['Pam']), null);
  assert.equal(H.parseDistinctAnswer('{"distinct": "maybe"}', ['Pam']), null);
});

test('the check prompt names every teammate and asks for JSON', () => {
  const p = H.distinctPrompt({ name: 'Erin', title: 'Admin', routing: 'r' }, [{ name: 'Pam', title: 'Admin', routing: 'p', mailbox: 'ceo@x.com' }]);
  assert.match(p, /- Pam: title "Admin"/);
  assert.match(p, /mailbox ceo@x\.com/);
  assert.match(p, /ONE JSON object/);
});

test('office jobs are listed only in the character\'s family (owner, 2026-09-27)', () => {
  const cards = H.cardJobs(packs, core, 'restaurant-food', business);
  const team = H.teamJobs([
    { id: 'pam', name: 'Pam', character: 'pam', description: 'Executive Admin: Pam sorts the inbox.' },
    { id: 'ryan', name: 'Ryan', character: 'ryan', description: 'Marketing: Ryan writes posts.' },
    { id: 'jim-1', name: 'Jim', character: 'jim', description: 'Social Media Manager: Jim follows Instagram.' }
  ], cards);
  const forErin = team.filter((j) => H.sameFamily(j, 'erin')).map((j) => j.fromName);
  assert.deepEqual(forErin, ['Pam']);
  // A job the owner wrote for Jim stays in Jim's Sales family.
  assert.deepEqual(team.filter((j) => H.sameFamily(j, 'stanley')).map((j) => j.fromName), ['Jim']);
  assert.equal(H.sameFamily(team[0], 'michael'), false);
});

test('renaming the job title never clears an overlap (owner, 2026-09-27)', () => {
  const dwight = { name: 'Dwight', title: 'Sales Director', routing: 'Dwight runs the sales pipeline: leads, open deals and their stages, draft proposals and quotes, prospect follow ups, and the monthly forecast.' };
  const jim = (title) => ({ name: 'Jim', title, routing: H.swapName(dwight.routing, 'Dwight', 'Jim') });
  for (const title of ['Sales Director', 'Sales Director1', 'Head of Growth', '']) {
    assert.deepEqual(H.overlapsByRules(jim(title), [dwight]), ['Dwight'], title);
  }
  assert.match(H.distinctPrompt(jim('x'), [dwight]), /The job title and the person's name never make a job distinct/);
});

test('Creed\'s own job fits the business he is hired into', () => {
  // Value: protects=hiring Creed as Quality Control never brings another trade's duties; fails_when=a business without its own Creed card borrows the restaurant's food safety job; why_new=owner 2026-10-03: a SaaS hire showed food safety checks; seam=none
  const expect = {
    'saas-consulting': /release checklist/,
    'home-services': /completion checklist/,
    'pro-services': /review checklist/,
    'retail-shop': /reason for every return/,
    'restaurant-food': /food safety/
  };
  for (const [type, duty] of Object.entries(expect)) {
    const job = H.ownJob('creed', [], H.cardJobs(packs, core, type, business));
    assert.equal(job.sourceCard, `${type}/creed`, `${type} has its own Creed card`);
    assert.equal(job.title, 'Quality Control');
    assert.match(job.routing, duty, type);
    if (type !== 'restaurant-food') assert.doesNotMatch(`${job.routing} ${job.workStyle} ${job.summary}`, /food|kitchen|temperature|inspector/i, type);
  }
});

test('every character\'s own job comes from the business they are hired into', () => {
  // Value: protects=no hire starts on another trade's duties (van parts in SaaS, food handler training in a shop); fails_when=a business pack lacks a card for a job family, so ownJob borrows another pack's; why_new=owner 2026-10-03: write fitting cards for the borrowed jobs; seam=none
  const borrowed = [];
  for (const p of packs) {
    const cards = H.cardJobs(packs, core, p.businessType, business);
    for (const c of Object.keys(H.CHARACTER_CARD)) {
      const job = H.ownJob(c, [], cards);
      if (!job.sourceCard.startsWith(`${p.businessType}/`)) borrowed.push(`${p.businessType}: ${c} from ${job.sourceCard}`);
    }
  }
  assert.deepEqual(borrowed, []);
  // And none of the new cards keeps the trade it was borrowed from.
  const text = (type, id) => { const a = all.find((x) => x.businessType === type).agents.find((x) => x.id === id); return `${a.summary} ${a.routing} ${a.workStyle}`; };
  for (const t of ['home-services', 'pro-services', 'retail-shop']) assert.doesNotMatch(text(t, 'toby'), /food|cook|kitchen|inspection/i, `${t} HR`);
  for (const t of ['home-services', 'pro-services', 'restaurant-food', 'retail-shop']) assert.doesNotMatch(text(t, 'nick'), /\bthe product\b|bug report/i, `${t} IT`);
  for (const t of ['home-services', 'restaurant-food', 'retail-shop']) assert.doesNotMatch(text(t, 'sadiq'), /tax return|closing documents|license/i, `${t} security`);
  for (const t of ['pro-services', 'saas-consulting']) for (const id of ['meredith', 'darryl']) assert.doesNotMatch(text(t, id), /\bvan\b|parts|before a job/i, `${t} ${id}`);
  assert.doesNotMatch(text('restaurant-food', 'dwight'), /maintenance|service visit/i);
});

test('"Write a new job" keeps the picked character\'s role and folder, for the owner to change', () => {
  // Value: protects=picking Creed and writing a new job starts at Quality Control, not a blank title; fails_when=the new job path clears the title, or a family member (Erin, Jim) gets a different role than their family's cards; why_new=owner 2026-10-03; seam=source pin for the wizard
  assert.deepEqual(H.newJobStart('creed'), { title: 'Quality Control', folder: 'Quality' });
  assert.deepEqual(H.newJobStart('erin'), { title: 'Executive Admin', folder: 'Admin' });
  assert.deepEqual(H.newJobStart('jim'), { title: 'Sales Director', folder: 'Sales' });
  assert.deepEqual(H.newJobStart('darryl'), { title: 'Inventory & Shipping', folder: 'Inventory' });
  assert.deepEqual(H.newJobStart('michael'), { title: '' }, 'no job family, nothing to carry');
  // The same title every pack card for that character uses.
  for (const p of all) for (const a of p.agents) assert.equal(H.newJobStart(a.character).title, a.role, `${p.businessType}/${a.id}`);
  const wizard = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/components/AddAgentModal.tsx'), 'utf8');
  assert.match(wizard, /if \(!chosenJob\) \{ setTitle\(newJobStart\(character\)\.title\); setRouting\(''\); setInstructions\(''\); setSourceCard\(undefined\); return; \}/);
  assert.match(wizard, /const sig = `\$\{chosenKey\}\|\$\{name\.trim\(\)\}\|\$\{character\}`;/, 'a different character applies again');
});

test('SaaS Quality Control tests releases and leaves bugs to the IT Engineer', () => {
  // Value: protects=hiring Creed in a SaaS office is not always flagged as overlapping the IT Engineer; fails_when=the card claims the bug list, bug reports or fix checks again; why_new=the real overlap check flagged Nick until the card was narrowed (2026-10-03); seam=none
  const saas = all.find((p) => p.businessType === 'saas-consulting');
  const creed = saas.agents.find((a) => a.id === 'creed');
  assert.match(creed.routing, /Not for bug reports, fixes or the bug list; that goes to IT Engineer\./);
  assert.doesNotMatch(`${creed.routing} ${creed.workStyle}`, /keep the open bug list|really fixed|before you mark it fixed/i);
  assert.deepEqual(H.overlapsByRules({ name: 'Creed', title: creed.role, routing: creed.routing, workStyle: creed.workStyle }, saas.agents.filter((a) => a.id !== 'creed').map((a) => ({ name: a.id, title: a.role, routing: a.routing, workStyle: a.workStyle }))), []);
});

test('a binding whose scope has a period or a semicolon is released too', () => {
  // Value: protects=every "Not for X; that goes to Name." line bindingLines writes leaves with the hire; fails_when=the release pattern stops at a period or semicolon inside the scope; why_new=ship review 2026-10-03 (QA probe 004: "orders over $1.5k" and "refunds; returns" stayed); seam=none
  for (const scope of ['the data in HubSpot', 'orders over $1.5k', 'refunds; returns', 'mail to support@x.com']) {
    const { others } = H.bindingLines(scope, 'Creed');
    assert.deepEqual(H.releaseBindings('Creed', [{ id: 'o', description: `Finance: Books. ${others}` }]), [{ id: 'o', description: 'Finance: Books.' }], scope);
  }
  // Only that hire's lines: another hire's binding stays.
  const { others } = H.bindingLines('the data in HubSpot', 'Nick');
  assert.deepEqual(H.releaseBindings('Creed', [{ id: 'o', description: `Finance: Books. ${others}` }]), []);
});
