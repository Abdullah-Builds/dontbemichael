'use strict';

/**
 * The heartbeat box in Schedules: text the owner writes there goes to Michael
 * ahead of the summary; the shipped default and an empty box send the summary
 * alone, so offices that never touched the box see no change.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { heartbeatMessage, HEARTBEAT_MISSION } = loadTs('src/main/config.ts');
const digest = 'Floor summary: 2 waiting, nobody stuck.';

test("the owner's heartbeat text goes ahead of the summary", () => {
  // Value: protects=an owner who edits the heartbeat box sees Michael get it; fails_when=the box text is dropped; why_new=the box did nothing before; seam=none
  assert.equal(heartbeatMessage('  Check the invoices board first.  ', digest), `Check the invoices board first.\n\n${digest}`);
});

test('the shipped default and an empty box send the summary alone', () => {
  // Value: protects=Michael is not told the team went quiet on a beat for waiting mail; fails_when=the default text is sent on every beat; why_new=owner review on #200; seam=none
  assert.equal(heartbeatMessage(HEARTBEAT_MISSION.body, digest), digest);
  assert.equal(heartbeatMessage(`  ${HEARTBEAT_MISSION.body}\n`, digest), digest);
  assert.equal(heartbeatMessage('', digest), digest);
  assert.equal(heartbeatMessage('   ', digest), digest);
  assert.equal(heartbeatMessage(undefined, digest), digest);
});

test('each beat reads the box again, so an edit counts from the next beat', () => {
  // Value: protects=an edit made while the heartbeat runs takes effect without a restart; fails_when=the body is captured once when the timer is armed; why_new=owner review on #200; seam=source
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const beat = src.slice(src.indexOf('function armHeartbeat'), src.indexOf('const remaining', src.indexOf('function armHeartbeat')));
  assert.match(beat, /const beat = \(\): void => \{[\s\S]*readConfig\(\)\.missions\?\.find\(\(x\) => x\.id === m\.id\)\?\.body[\s\S]*heartbeatMessage\(body, buildHeartbeatDigest\(quiet, actionable\)\)/);
  assert.doesNotMatch(beat, /m\.body/);
});
