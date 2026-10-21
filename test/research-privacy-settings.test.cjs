'use strict';

/**
 * Settings, Research & privacy (issue #230, design review D3 to D22): the
 * Research row's live states, the class rows, the update card, the Team step
 * row and the copy, checked in the source the way the other UI tests are.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const ui = read('src/renderer/src/components/ResearchPrivacySettings.tsx');
const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));

test('one Settings section, after Connections, with Research first', () => {
  // Value: protects=the switch and what it may be sent read as one decision; fails_when=the section moves or splits; why_new=design review D3; seam=source
  const modal = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(modal, /'Connections', 'Research & privacy', 'Voice'/);
  assert.equal(en.settings.nav.research, 'Research & privacy');
  assert.ok(ui.indexOf("t('research.title')") < ui.indexOf("t('research.sendTitle'"));
  assert.match(modal, /classes=\{pending\.dataClasses \?\? config\.dataClasses\}/, 'classes are staged for the footer Save');
});

test('the Research row speaks every state and acts at once', () => {
  // Value: protects=the owner sees whether Research started; fails_when=a state has no words or waits for Save; why_new=design review D6; seam=source
  assert.match(ui, /<span role="status"/);
  for (const k of ['off', 'on', 'starting', 'stopping', 'failed']) assert.ok(en.research[k], k);
  assert.equal(en.research.off, "Off. {{name}} can't look things up for your team.");
  assert.equal(en.research.on, 'On. {{name}} looks things up for the team.');
  assert.match(ui, /t\('research\.on', \{ name: researchName \}\)/, 'with the name the owner gave it (ship 2 D17)');
  assert.match(ui, /await startResearch\(config\)/);
});

test('turning off with asks waiting asks first, with focus on Cancel', () => {
  // Value: protects=a double Enter never drops the team's open asks; fails_when=the confirm is skipped or focus lands on Turn off; why_new=design review D7 and D14; seam=source
  assert.match(ui, /if \(s && s\.waiting > 0\) setWaiting\(s\.waiting\);\n    else await stop\(\);/);
  assert.match(ui, /confirmRow\.current\?\.querySelector<HTMLButtonElement>\('button'\)\?\.focus\(\)/);
  assert.ok(ui.indexOf("t('research.cancel')") < ui.lastIndexOf("t('research.turnOff')"), 'Cancel comes first');
  assert.match(ui, /e\.key === 'Escape' && !e\.nativeEvent\.isComposing/);
  assert.equal(en.research.waitingMany, '{{count}} asks are waiting. They go back to the sender.');
});

test('classes are named radio groups in a fixed order; passwords are locked', () => {
  // Value: protects=keyboard and screen reader owners can set privacy; fails_when=classes lose their group, words or order; why_new=design review D4, D12, D13; seam=source
  assert.match(ui, /DATA_CLASSES\.map\(\(c, i\) =>/);
  assert.match(ui, /<RadioRows\n\s+inline\n\s+label=\{name\}/);
  assert.match(read('src/renderer/src/components/CapabilitiesTab.tsx'), /<div role="radiogroup" aria-label=\{label\} onKeyDown=\{onKey\}/);
  assert.match(ui, /<Icon name="lock" size=\{0\.75\} \/><span>\{t\('research\.alwaysPrivate'\)\}<\/span>/, 'the locked state is spoken as visible text');
  assert.match(ui, /t\('research\.otherEngines', \{ names: uncovered\.join\(', '\) \}\)/, 'members on other engines are named (D4)');
  for (const id of ['places', 'industry', 'dates', 'general', 'names', 'contact', 'companies', 'money', 'accounts', 'health', 'quoted', 'secrets']) {
    for (const lang of ['en', 'ar', 'zh-CN']) {
      const l = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`));
      assert.ok(l.research.class[id].name && l.research.class[id].tip, `${lang} ${id}`);
    }
  }
  assert.equal(en.research.usedWhenOn, 'Used when {{name}} is on.');
});

test('Windows owners are told Research is not walled off there', () => {
  // Value: protects=an owner on Windows knows the guard does not fully hold; fails_when=the line is missing or softened; why_new=eng D4, design review D21; seam=source
  assert.match(ui, /const win = window\.cth\.platform === 'win32';/);
  assert.equal(en.research.windows, 'On Windows, {{name}} can still reach your office files.');
});

test('Windows owners are told the team\'s commands still reach the internet there', () => {
  // Value: protects=an owner on Windows does not believe only Research uses the internet; fails_when=the line is missing, shown off Windows, or softened; why_new=TODOS "Take the internet from team members' shells on Windows" (say it on the Research screen); seam=source
  // It sits right under the Research Windows line, in the top section.
  assert.match(ui, /text=\{t\('research\.windowsTip', \{ name: researchName \}\)\} \/>\s*<\/div>\s*\)\}\s*\{\/\*[^*]*\*\/\}\s*\{win && \(\s*<div style=\{\{ \.\.\.hint, marginTop: 8, paddingInlineStart: 16,[^>]*>\s*\{t\('research\.windowsTeam'\)\}<InfoTip label=\{t\('research\.windowsTeam'\)\} text=\{t\('research\.windowsTeamTip', \{ name: researchName \}\)\} \/>/);
  assert.ok(ui.indexOf("t('research.windowsTeam')") < ui.indexOf("t('research.sendTitle'"), 'above the send section');
  assert.equal(en.research.windowsTeam, 'On Windows, your team\'s commands can still reach the internet.');
  assert.match(en.research.windowsTeamTip, /only their web tools are refused there\. On a Mac, only \{\{name\}\} uses the internet\.$/);
});

test('the update card is a quiet report, once, that opens the section', () => {
  // Value: protects=updated owners learn the team lost the internet without a false alarm; fails_when=the card turns coral, repeats, or misses the deep link; why_new=design review D9 and D20; seam=source
  const ask = read('src/renderer/src/components/AskMeTab.tsx');
  assert.match(ask, /\}\)\}\n      \{\/\* A report, after the questions like every Report card \(DESIGN\.md 7\.8\)\. \*\/\}\n      \{researchNotice && <ResearchNoticeCard \/>\}/);
  assert.match(read('src/renderer/src/components/SettingsModal.tsx'), /\{VISIBLE_SECTIONS\.map\(\(section\) => \{/, 'every office (owner, ship 2 D16)');
  assert.match(ask, /detail: \{ section: 'Research & privacy' \}/);
  assert.match(read('src/renderer/src/shell/useNeedsYou.ts'), /\+ \(merged\.researchNotice \? 1 : 0\)/);
  assert.equal(en.research.noticeTitle, 'Your team no longer uses the internet');
  assert.match(read('src/main/index.ts'), /if \(!cfg\.research\) writeConfig\(\{ research: \{ on: false, notice: !!cfg\.onboardingComplete \} \}\);/, 'every updated office (ship 2 D16)');
});

test('setup offers Research as one unchecked Team step row', () => {
  // Value: protects=new owners can choose Research without a longer setup; fails_when=it is checked by default or missing; why_new=design review D10 and D11; seam=source
  const wiz = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(wiz, /const \[researchPicked, setResearchPicked\] = useState\(false\);/);
  assert.match(wiz, /research: \{ on: researchPicked, notice: false \}/);
  // Picked alone, with no other member, Research still starts (ship plan audit).
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hive, /if \(team\.length === 0 \|\| retry\?\.size === 0\) \{\n    if \(!retry\) await startPickedResearch\(config\);\n    return;\n  \}/);
  assert.match(hive, /if \(!retry\) await startPickedResearch\(config\);\n\}/);
  assert.equal(en.research.teamTag, 'uses the internet');
});

test('Research copy has no dashes', () => {
  // Value: protects=the owner's no dash rule; fails_when=a dash slips into Research strings; why_new=standing rule; seam=none
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const l = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`));
    assert.doesNotMatch(JSON.stringify(l.research) + l.capabilities.research, /[–—]| - /, lang);
  }
});

test('the Research member reads as Research everywhere the owner sees it, under the name they gave it', () => {
  // Value: protects=the setup card shows its role, its locked engine stays labelled for screen readers, its name is the owner's to edit, and Pete, in his own face, takes part in the studio's idle talk; fails_when=the card drops the role, the name locks again, or the floor filters Research out of idle talk again; why_new=design review, owner ship 2 D17, owner 2026-10-13 (Pete joins idle time fun); seam=source
  const wiz = read('src/renderer/src/components/OnboardingWizard.tsx');
  assert.match(wiz, /name=\{`\$\{researchName\} · \$\{t\('research\.title'\)\}`\}/, 'its current name (third ship)');
  assert.match(wiz, /character="pete"/, 'Pete, its own face, not Ryan (owner, third ship D4)');
  const modal = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.doesNotMatch(modal, /readOnly value=\{agent\.name\}/, 'the name is editable (ship 2 D17)');
  assert.match(modal, /info=\{isResearch \? t\('editAgent\.researchName', \{ name: researchName \}\) : undefined\}/);
  assert.match(modal, /<input readOnly value=\{providerLabel\} aria-label=\{t\('editAgent\.provider'\)\} style=\{lockedValueStyle\} \/>/);
  assert.doesNotMatch(read('src/renderer/src/scene/studio/StudioStage.tsx'), /\.filter\(\(p\) => p\.id !== RESEARCH_ID\)/, 'Pete joins idle talk (owner, 2026-10-13)');
  // The hook program's big call handling is driven for real in test/hook-frame-paths.test.cjs.
});
