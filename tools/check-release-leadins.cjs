#!/usr/bin/env node
'use strict';

/**
 * Release gate: every bold lead in under "What's new" must be one dontbemichael.com can show.
 *
 * WHY THIS EXISTS. RELEASE.md is published as the GitHub release body, and the website's
 * /download page lists the first three bold lead ins of its "## What's new in X.Y.Z" section
 * as "New in vX.Y.Z" (website public/assets/latest.js, whatsNew). A bold part that does not end
 * in . ! ? or a comma is read as a run-in head and skipped without a word. 0.2.4 shipped with
 * "**Company foundations:**" (a colon), so the site dropped the release's headline and led with
 * "No switches for company knowledge" instead; 0.2.1 had led with an in joke the same week.
 * RELEASE-CHECKLIST.md states the rule; this makes it fail before a tag instead of after.
 *
 * The rule mirrors whatsNew exactly: the first "What's new" heading opens the list, the next
 * # or ## heading closes it, and a bullet counts when it starts with a bold part ending in
 * . ! ? or a comma. Bold only the lines the site should show; write the rest as plain bullets.
 */

const fs = require('node:fs');
const path = require('node:path');

const COUNTS = /[.!?,]\s*$/;

/** Problems with a release body's "What's new" lead ins; an empty list passes. */
function leadInProblems(body) {
  const lines = String(body).split(/\r?\n/);
  const problems = [];
  let inList = false, seen = false, counted = 0;
  for (const line of lines) {
    if (!inList) {
      if (/^##\s+What['’]s new in v?\d+\.\d+\.\d+\b/i.test(line)) { inList = true; seen = true; }
      continue;
    }
    if (/^#{1,2}\s/.test(line)) break;
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*/.exec(line);
    if (!m) continue;
    if (COUNTS.test(m[1])) counted++;
    else problems.push(`"**${m[1]}**" does not end in . ! ? or a comma, so dontbemichael.com skips it. End the bold part with one, or make the line a plain bullet.`);
  }
  if (!seen) problems.push('No "## What\'s new in X.Y.Z" heading, so dontbemichael.com shows no list.');
  else if (!counted && !problems.length) problems.push('No bold lead in under "What\'s new", so dontbemichael.com shows no list.');
  return problems;
}

module.exports = { leadInProblems };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'RELEASE.md');
  const problems = leadInProblems(fs.readFileSync(file, 'utf8'));
  if (problems.length) {
    console.error(`Release lead ins: ${problems.length} problem(s) in ${path.basename(file)}`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('Release lead ins: every bold lead in can show on dontbemichael.com.');
}
