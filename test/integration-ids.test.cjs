'use strict';

/**
 * 2026-10-16: adding an integration in Settings, Connections could replace
 * one already there. A new integration's id is slugged from its label, and
 * saving under an id in use replaces that record and its secret
 * (upsertRecord in src/main/integrations.ts, secret `int:<id>`). A second
 * "Stripe" slugged to `stripe`, and every label with no a to z letters, an
 * Arabic or Chinese one, to the same `api-x`. A new integration's id now skips
 * the ids already registered (src/renderer/src/integrations/registryClient.ts).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { slugify } = loadTs('src/renderer/src/integrations/registryClient.ts');
const { INTEGRATION_SLUG_RE } = loadTs('src/shared/integrations.ts');

test('a new integration never takes an id already registered', () => {
  // Value: protects=adding an integration never replaces another one and its secret; fails_when=slugify ignores the ids in use; why_new=a second Stripe, and any two Arabic or Chinese labels, took the same id; seam=none
  assert.equal(slugify('Stripe', ['stripe']), 'stripe-2');
  assert.equal(slugify('Stripe', ['stripe', 'stripe-2']), 'stripe-3');
  assert.equal(slugify('واجهة المبيعات', ['api-x']), 'api-x-2', 'an Arabic label');
  assert.equal(slugify('销售接口', ['api-x', 'api-x-2']), 'api-x-3', 'a Chinese label');
  assert.equal(slugify('Orders API', ['stripe']), 'orders-api', 'a free id is kept');
  assert.equal(slugify('stripe-2'), 'stripe-2', 'the saved draft id reads back unchanged');
});

test('the next free id is still a valid id, at the 40 character cap too', () => {
  // Value: protects=a numbered id passes main's check, so the save goes through; fails_when=the number runs past 40 characters or follows a hyphen; why_new=ids had no number before; seam=none
  const label = `${'x'.repeat(37)} ${'y'.repeat(5)}`; // slugs to 40 characters, a hyphen where a number's cut lands
  const taken = [];
  for (let i = 0; i < 12; i++) taken.push(slugify(label, taken));
  assert.equal(new Set(taken).size, 12, 'every id is new');
  for (const id of taken) {
    assert.match(id, INTEGRATION_SLUG_RE);
    assert.ok(id.length <= 40, id);
    assert.doesNotMatch(id, /--/);
  }
});

test('the Connections form gives a new integration an id the others do not have', () => {
  // Value: protects=both ways Settings sets a new integration's id pass the registered ids; fails_when=the template pick or a typed label slugs the id without them; why_new=neither passed them; seam=source pin, the form needs React
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/IntegrationsRegistry.tsx'), 'utf8');
  assert.match(src, /const takenIds = records\.map\(\(r\) => r\.id\);/);
  assert.match(src, /draftFromTemplate\(t, Date\.now\(\), takenIds\)/);
  const newIds = [...src.matchAll(/\bid: slugify\(([^)]*)\)/g)].map((m) => m[1]);
  assert.equal(newIds.length, 2, 'the template pick and a typed label');
  for (const args of newIds) assert.match(args, /, takenIds$/);
});
