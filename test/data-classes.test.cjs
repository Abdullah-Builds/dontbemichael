'use strict';

/**
 * The data privacy layer (issue #230, docs/designs/research-agent-privacy.md):
 * the seeded classes, the owner's choices over them, and the fixed patterns
 * that refuse a message to Research before any AI call.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const dc = loadTs('src/shared/dataClasses.ts');

test('the seeded classes keep their fixed order and safe defaults', () => {
  // Value: protects=the owner sees one stable list with the sensitive kinds kept in; fails_when=a default flips to allowed or the order changes; why_new=new feature; seam=none
  assert.deepEqual(dc.DATA_CLASSES.map((c) => c.id), ['places', 'industry', 'dates', 'general', 'names', 'contact', 'companies', 'money', 'accounts', 'health', 'quoted', 'secrets']);
  const s = dc.dataClassSettings(undefined);
  assert.deepEqual(['places', 'industry', 'dates', 'general'].map((id) => s[id]), ['allowed', 'allowed', 'allowed', 'allowed']);
  for (const id of ['names', 'contact', 'companies', 'money', 'accounts', 'health', 'quoted', 'secrets']) assert.equal(s[id], 'private', id);
  assert.deepEqual(dc.allowedCount(s), { allowed: 4, private: 8 });
});

test('passwords and keys stay private whatever is stored', () => {
  // Value: protects=a secret never reaches the internet; fails_when=a stored "allowed" unlocks secrets; why_new=new feature; seam=none
  const s = dc.dataClassSettings({ secrets: 'allowed', names: 'allowed', places: 'private', bogus: 'allowed' });
  assert.equal(s.secrets, 'private');
  assert.equal(s.names, 'allowed');
  assert.equal(s.places, 'private');
  assert.equal(dc.dataClassSettings({ names: 'maybe' }).names, 'private');
});

test('only choices that differ from a default are saved', () => {
  // Value: protects=a later default change reaches offices that never touched it; fails_when=defaults are copied into config; why_new=new feature; seam=none
  assert.deepEqual(dc.cleanDataClassOverrides({ places: 'allowed', names: 'allowed', secrets: 'allowed' }), { names: 'allowed' });
  assert.equal(dc.cleanDataClassOverrides('nope'), null);
  assert.equal(dc.cleanDataClassOverrides([]), null);
});

test('patterns name the class of what they find', () => {
  // Value: protects=a refusal names what to leave out; fails_when=a pattern maps to the wrong class or misses a shape; why_new=new feature; seam=none
  const cls = (t) => dc.patternHits(t).map((h) => h.classId);
  assert.ok(cls('write to jane.smith@example.com').includes('contact'));
  assert.ok(cls('call +1 512 555 0142 today').includes('contact'));
  assert.ok(cls('card 4111 1111 1111 1111').includes('money'));
  assert.ok(!cls('order 4111 1111 1111 1112').includes('money'), 'fails Luhn: not a card');
  assert.ok(cls('IBAN GB82 WEST 1234 5698 7654 32').includes('accounts'));
  assert.ok(cls('SSN 123-45-6789').includes('accounts'));
  // Fake keys are built at run time so the repository's secret scan stays quiet.
  assert.ok(cls('key sk-' + 'abcdefghijklmnopqrstuvwx').includes('secrets'));
  assert.ok(cls('ghp_' + 'abcdefghijklmnopqrstuvwxyz0123').includes('secrets'));
  assert.ok(cls('pass' + 'word: ' + 'hunter22x').includes('secrets'));
  assert.ok(cls('customer 123456789012').includes('accounts'));
  assert.ok(cls('call 5125550142').includes('contact'), 'a bare phone length run counts as contact too');
});

test('a card is found beside its expiry, its security code or another number', () => {
  // Value: protects=card details never reach Research; fails_when=digits next to a card fail it on Luhn and it passes as plain text; why_new=a card typed with its expiry tripped no pattern at all; seam=none
  const money = (t) => dc.patternHits(t).some((h) => h.classId === 'money');
  for (const t of [
    'charge 4111 1111 1111 1111 12/27',
    'card 4111-1111-1111-1111 12-27',
    'visa 4242 4242 4242 4242 0827 cvc 314',
    'card 4111111111111111 123',
    'room 12 4111 1111 1111 1111',
    'amex 3782 822463 10005 0425',
    'card 6011 0000 0000 0000 001 12/27',
    'mastercard 2223 0031 2200 3222 12/27',
    'diners 3056 930902 5904 12/27',
    'jcb 3530 1113 3330 0000 12/27'
  ]) assert.ok(money(t), t);
  assert.ok(!money('order 4111 1111 1111 1112 12/27'), 'fails Luhn: not a card');
});

test('plain research questions trip no pattern', () => {
  // Value: protects=ordinary asks reach Research; fails_when=years, prices or counts read as private; why_new=new feature; seam=none
  for (const t of ['pizza suppliers in Austin', 'food safety rules for 2026', 'average price of flour per 50 lb bag, around $25', 'how many restaurants opened in Texas in 2025',
    'Is the exchange open on 2026-10-13 10:30 Eastern?', 'sales tax for 2022 2023 2024', 'ISBN 978-0-13-468599-1', 'compare 1.234.567.890 units',
    'stock sizes 6 8 10 12 14 16 18 20 22 24', 'delivery zones 78701 78702 78703 78704', 'revenue by year 2017 2018 2019 2020 2021 2022',
    'price points 1100 1200 1300 1400 1500 1600 1700']) {
    assert.deepEqual(dc.patternHits(t), [], t);
  }
});

test('a pattern on a class the owner allows does not refuse', () => {
  // Value: protects=the owner's choice decides; fails_when=an allowed class still refuses; why_new=new feature; seam=none
  const allowContact = dc.dataClassSettings({ contact: 'allowed' });
  assert.equal(dc.privatePatternHit('email info@example.com', allowContact), null);
  assert.equal(dc.privatePatternHit('email info@example.com', dc.dataClassSettings(undefined)).classId, 'contact');
});
