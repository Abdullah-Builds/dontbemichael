'use strict';

/**
 * A link in agent text on a card shows a name, not the raw URL
 * (docs/designs/named-links.md; owner, 2026-10-11: "it will be nicer to show a
 * named link rather such as HubSpot that takes to it"). The words can come from
 * outside email, so the card shows the real site when they name another one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { isBareLink, linkName, labelMismatch } = loadTs('src/renderer/src/markdown/mdLinks.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

async function linksOf(markdown) {
  const { unified } = await import('unified');
  const { default: remarkParse } = await import('remark-parse');
  const { default: remarkGfm } = await import('remark-gfm');
  const proc = unified().use(remarkParse).use(remarkGfm);
  const tree = proc.runSync(proc.parse(markdown));
  const out = [];
  const walk = (n) => {
    if (n.type === 'link') out.push({ href: n.url, text: n.children.map((c) => c.value ?? '').join('') });
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

test('a pasted URL, a www address and an email are bare; words are not (E1)', async () => {
  // Value: protects=every pasted address is named, through the real parser; fails_when=bare means text equals href only (www and email stay raw); why_new=no link naming existed; seam=none; no_claim=React rendering (parser plus pure function)
  const ask = '1. Open https://app.hubspot.com/contacts/5773691/record/0-2/18164826678 (the company has no name)\n'
    + '2. See www.northwindcafe.com/menu, mail francis@example.com, or <https://x.io/a>\n'
    + '3. [the company in HubSpot](https://app.hubspot.com/contacts/1)';
  const links = await linksOf(ask);
  assert.deepEqual(links.map((l) => isBareLink(l.text, l.href)), [true, true, true, true, false]);
  assert.deepEqual(links.slice(0, 4).map((l) => linkName(l.href)), ['HubSpot', 'northwindcafe.com', 'francis@example.com', 'x.io']);
  assert.equal(isBareLink('', 'https://x.io'), false, 'empty text is not a pasted address');
});

test('known apps by domain, everything else by its host (D2, E2)', () => {
  // Value: protects=the app name a card shows and that a look-alike never borrows one; fails_when=a domain is matched as a substring or the raw host is shown; why_new=new table; seam=none; no_claim=none beyond protects
  const rows = [
    ['https://app.hubspot.com/contacts/1/record/0-2/9', 'HubSpot'],
    ['https://qbo.intuit.com/app/invoice?txnId=118', 'QuickBooks'],
    ['https://mail.google.com/mail/u/0/#inbox', 'Gmail'],
    ['https://docs.google.com/spreadsheets/d/abc/edit', 'Google Sheets'],
    ['https://docs.google.com/presentation/d/abc', 'Google Slides'],
    ['https://docs.google.com/document/d/abc', 'Google Docs'],
    ['https://drive.google.com/drive/folders/x', 'Google Drive'],
    ['https://calendar.google.com/calendar/r', 'Google Calendar'],
    ['https://outlook.office.com/mail/', 'Outlook'],
    ['https://acme.slack.com/archives/C1', 'Slack'],
    ['https://www.notion.so/acme/Page-1', 'Notion'],
    ['https://dashboard.stripe.com/payments/py_1', 'Stripe'],
    ['https://github.com/acme/app/pull/3', 'GitHub'],
    ['https://linear.app/acme/issue/A-1', 'Linear'],
    ['https://acme.atlassian.net/browse/OPS-12', 'Jira'],
    ['https://acme.atlassian.net/wiki/spaces/OPS', 'Confluence'],
    ['https://acme.sentry.io/issues/1', 'Sentry'],
    ['https://go.xero.com/Dashboard', 'Xero'],
    ['https://www.northwindcafe.com/menu/fall', 'northwindcafe.com'],
    ['HTTPS://Shop.Example.COM/a', 'shop.example.com'],
    ['https://app.hubspot.com.evil.io/x', 'app.hubspot.com.evil.io'],
    ['https://evilhubspot.com/x', 'evilhubspot.com'],
    ['http://hubspоt.com/', 'xn--hubspt-0qf.com'],
    [`https://${'user'}:${'pw'}@app.hubspot.com/x`, 'HubSpot'],
    ['mailto:francis@example.com?subject=Hi', 'francis@example.com']
  ];
  for (const [href, name] of rows) assert.equal(linkName(href), name, href);
  for (const href of ['https://', 'file:///Users/me/a.md', 'javascript:alert(1)', 'notes.md', '']) {
    assert.equal(linkName(href), null, `${href || '(empty)'} keeps its raw text`);
  }
});

test('words that name another site show the real one; honest words show nothing (D4)', () => {
  // Value: protects=a look-alike link cannot hide behind a friendly name; fails_when=the app or address check is dropped or flags honest links; why_new=new behavior; seam=none; no_claim=words that name nothing checkable (accepted limit)
  const rows = [
    ['HubSpot', 'https://hubspot-login.example/a', 'hubspot-login.example'],
    ['the company in HubSpot', 'https://app.hubspot.com/contacts/1', null],
    ['Open it in hubspot', 'https://www.evil.example/x', 'evil.example'],
    ['app.hubspot.com', 'https://evil.example/x', 'evil.example'],
    ['https://app.hubspot.com/contacts', 'https://app.hubspot.com.evil.io/x', 'app.hubspot.com.evil.io'],
    ['hubspot.com', 'https://app.hubspot.com/x', null],
    ['www.northwindcafe.com', 'https://northwindcafe.com/menu', null],
    ['the Q3 sheet in Google Sheets', 'https://docs.google.com/spreadsheets/d/1', null],
    ['Google Sheets', 'https://sheets.example/1', 'sheets.example'],
    ['the wiki page', 'https://acme.atlassian.net/wiki/x', null],
    ['the record', 'https://evil.example/x', null],
    ['report.md', 'https://drive.google.com/file/d/1', null],
    ['Email support@hubspot.com', 'mailto:help@evil.example', 'help@evil.example'],
    ['francis@example.com', 'mailto:francis@example.com', null]
  ];
  for (const [label, href, real] of rows) assert.equal(labelMismatch(label, href), real, `${label} -> ${href}`);
});

test('cards name links; documents show them as written (D3, D5, D6, R2)', () => {
  // Value: protects=file tabs keep their addresses and every card link says where it goes; fails_when=naming loses its card check or an icon or phrase is dropped; why_new=no rendering test covers link text; seam=none; no_claim=pixel look (source assertions)
  const view = read('src/renderer/src/markdown/MarkdownPreview.tsx');
  assert.match(view, /if \(card && isExternal\(h\)\) \{/, 'naming only in card mode');
  assert.match(view, /const name = bare \? linkName\(h\) : null;/);
  assert.match(view, /if \(!bare \|\| name\) \{/, 'an unparseable pasted URL keeps its raw text');
  assert.match(view, /<Icon name=\{mail \? 'mail' : 'external'\}/);
  assert.match(view, /\{'\\u2060'\}/, 'a word joiner keeps the icon on the last word');
  assert.match(view, /t\(mail \? 'markdown\.opensInEmail' : 'markdown\.opensInBrowser'\)/);
  assert.match(view, /\{real && <span className="cth-md-linkhost"> \(\{real\}\)<\/span>\}/);
  assert.match(read('src/renderer/src/components/Icon.tsx'), /'external' \| 'mail'/);
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const m = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).markdown;
    assert.ok(m?.opensInBrowser && m?.opensInEmail, `${loc} has both phrases`);
  }
});

test('Michael is told to write links as words, in asks and in dock replies (D2, R3)', () => {
  // Value: protects=the agent rule in all four places; fails_when=a rule is rewritten and drops the sentence; why_new=new rule; seam=none; no_claim=whether agents follow it (no eval)
  const hive = read('src/main/hive.ts');
  assert.match(hive, /Put amounts and account names in backticks, and name each file by its full path, with its file ending, in backticks, so the owner can open it\. Write each link as a few words naming what opens/, 'ask rule (owner, 2026-10-19: a file opens from its chip)');
  assert.match(hive, /never paste a report\. Write each link as a few words naming what opens/, 'dock reply rule');
  assert.match(hive, /in \\`backticks\\`; write each link as a few words naming what opens/, 'Michael standing rule');
  assert.match(hive, /\n- each link as a few words naming what opens, like \[the company in HubSpot\]/, 'HIVE doc rule');
});

test('an owner action on a website keeps the link from the email, from the team member to the ask', () => {
  // Value: protects=an ask to sign in, accept terms or pay carries the link to where it happens, so the owner never digs the email out (owner, 2026-10-14: an Apple agreement ask lost developer.apple.com/account between Nick's report and Michael's ask); fails_when=a rule is rewritten and drops the sentence; why_new=new rule; seam=none; no_claim=whether agents follow it (no eval)
  const hive = read('src/main/hive.ts');
  const own = /only (a link on )?the sender\\?'s own site, never a tracking or shortened (one|link)/;
  const parts = [
    ['team member files or tells Michael', /give the exact link the email or page offers for it, copied as it is, in your filing or message to \$\{michael\}/],
    ['ask rule', /When the ask is something the owner does on a website, such as signing in, accepting terms or paying, link straight to where they do it/],
    ['Michael standing rule', /when the ask is something the owner does on a website \(signing in, accepting terms, paying\), link straight to where they do it/],
    ['HIVE doc rule', /\n- an action the owner takes on a website \(signing in, accepting terms, paying\) links straight to where they do it,/],
    ['HIVE triage rule', /carries the exact link for it from the email or page \(the sender\\?'s own site, never a tracking or shortened link\), and Michael keeps it in the ask/]
  ];
  for (const [where, re] of parts) assert.match(hive, re, where);
  assert.ok((hive.match(new RegExp(own.source, 'g')) || []).length >= 3, 'each copy limits it to the sender\'s own site');
});
