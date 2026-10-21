'use strict';

/**
 * The floating "hive memory" panel on the office floor is gone (owner,
 * 2026-09-24). Nothing in it was about the floor: its on/off duplicated
 * Settings → Memory & Knowledge, searching memory is on Michael's Memory tab,
 * and its one unique control, the search language, moved into Settings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the office floor no longer carries the memory panel', () => {
  assert.doesNotMatch(read('src/renderer/src/App.tsx'), /MemoryPanel/);
  assert.ok(!fs.existsSync(path.resolve(__dirname, '../src/renderer/src/components/MemoryPanel.tsx')));
});

test('Company knowledge and search by meaning have no switches: the document tools, the status and the search language', () => {
  const s = read('src/renderer/src/components/SettingsModal.tsx');
  const start = s.indexOf("activeSection === 'Memory & Knowledge'");
  const section = s.slice(start, start + 9000);
  assert.ok(section.indexOf("t('settings.memory.kg')") < section.indexOf("t('settings.memory.meaning.title')"));
  assert.doesNotMatch(s, /toggleKg|toggleSemMem|kgEnabled|semMemOn|stage\(\{ semanticMemory|stage\(\{ knowledgeGraph/);
  assert.doesNotMatch(section, /t\('common\.on'\)|t\('common\.off'\)/, 'no On or Off button in the section');
  assert.match(section, /<KnowledgeDocList refreshKey=\{kgDocCount\} \/>/);
  assert.match(section, /t\('memoryPanel\.onReady'\)/);
  assert.match(section, /onClick=\{\(\) => pickEmbeddingModel\(id\)\}/);
  assert.match(section, /settings\.memory\.meaning\.languageTip/);
  assert.match(s, /stage\(\{ embeddingModel: m \} as Partial<HarnessConfig>\);/);
  // Not installed: straight to the setup that installs it.
  assert.match(section, /setActiveSection\('Prerequisites'\)/);
  // Main: always on; search by meaning follows the install; members pointed at the store once it has a document.
  const main = read('src/main/index.ts');
  assert.match(main, /\(\) => \(\{ enabled: true, model: readConfig\(\)\.embeddingModel \?\? 'minilm' \}\)/);
  assert.match(main, /knowledgeGraph: knowledge\.hasDocuments\(\),/);
  assert.match(read('src/main/knowledge.ts'), /if \(!this\.hasDocuments\(\)\) return \{ active: false \};/);
  assert.doesNotMatch(read('src/main/realtimeActions.ts'), /semanticMemory/, 'voice cannot turn it off either');
});

test('Michael\'s Memory tab searches the team\'s notes by exact words only', () => {
  const panel = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.doesNotMatch(panel, /searchMemory|memoryNotes\.byMeaning|role="radiogroup" aria-label=\{t\('memoryNotes\.searchTitle'\)\}/);
  assert.match(panel, /window\.cth\.textSearch\(q\)/);
  assert.doesNotMatch(read('src/renderer/src/realtime/tools.ts'), /window\.cth\.searchMemory/, 'the voice tool reads notes by exact words too');
});

test('a new search language rebuilds the index, and running members get the command for it', () => {
  const main = read('src/main/index.ts');
  assert.match(main, /'embeddingModel' in patch && \(next\.embeddingModel \?\? 'minilm'\) !== modelBefore\) memory\.modelChanged\(\);/);
  assert.match(main, /\{ bin, palace, model: memory\.model\(\) \}/);
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const m = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`)).settings.memory;
    for (const text of [m.kg, m.kgTitle, m.kgDesc, ...Object.values(m.meaning)]) assert.doesNotMatch(text, /[\u2013\u2014]| - /, `${lang}: ${text}`);
  }
});
