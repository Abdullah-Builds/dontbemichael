'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { validateHookEvent, isTerminalPrompt, TERMINAL_PROMPT_TYPES, batchToolUseIds, MAX_BATCH_TOOL_USE_IDS } = loadTs('src/shared/hookEvents.ts');

test('accepts valid hook event payloads', () => {
  assert.equal(validateHookEvent({
    agentId: 'jim-1',
    event: 'PreToolUse',
    tool: 'Bash',
    notificationType: 'permission',
    source: 'claude',
    message: 'Running a command',
    detail: 'Run the full test suite',
    blocked: false
  }), true);
});

test('accepts optional agent ids and open provider event names', () => {
  assert.equal(validateHookEvent({ event: 'Stop' }), true);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 'Unknown' }), true);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 'FutureProviderEvent' }), true);
});

test('rejects payloads missing a valid event name', () => {
  assert.equal(validateHookEvent({ agentId: 'jim-1' }), false);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: '' }), false);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 42 }), false);
});

test('rejects malformed optional fields', () => {
  assert.equal(validateHookEvent({ agentId: '', event: 'Stop' }), false);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 'PreToolUse', tool: 42 }), false);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 'Stop', blocked: 'false' }), false);
  assert.equal(validateHookEvent({ agentId: 'jim-1', event: 'PreToolUse', detail: 7 }), false);
  assert.equal(validateHookEvent(null), false);
});

test('a finished batch carries a clean list of call ids', () => {
  // Value: protects=only call ids cross to the panel; fails_when=a bad entry or an endless list gets through; why_new=maintainer review of #401; seam=none
  const list = [{ tool_use_id: 'toolu_a' }, { tool_use_id: 7 }, null, 'toolu_b', {}, { tool_use_id: '' }, { tool_use_id: 'x'.repeat(129) }, { tool_use_id: 'toolu_c' }];
  assert.deepEqual(batchToolUseIds(list), ['toolu_a', 'toolu_c']);
  assert.deepEqual(batchToolUseIds(undefined), []);
  assert.deepEqual(batchToolUseIds({ tool_use_id: 'toolu_a' }), []);
  assert.equal(batchToolUseIds(Array.from({ length: 300 }, (_, i) => ({ tool_use_id: `toolu_${i}` }))).length, MAX_BATCH_TOOL_USE_IDS);
  assert.equal(validateHookEvent({ agentId: 'pam', event: 'PostToolBatch', toolUseIds: ['toolu_a', 'toolu_c'] }), true);
  assert.equal(validateHookEvent({ agentId: 'pam', event: 'PostToolBatch', toolUseIds: [] }), true);
  assert.equal(validateHookEvent({ agentId: 'pam', event: 'PostToolBatch', toolUseIds: 'toolu_a' }), false);
  assert.equal(validateHookEvent({ agentId: 'pam', event: 'PostToolBatch', toolUseIds: ['toolu_a', 7] }), false);
  assert.equal(validateHookEvent({ agentId: 'pam', event: 'PostToolBatch', toolUseIds: Array(300).fill('toolu_a') }), false);
});

test('main and preload share the hook event contract', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main/hooks.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');

  assert.match(main, /validateHookEvent.*shared\/hookEvents|shared\/hookEvents.*validateHookEvent/s);
  assert.match(preload, /HookEvent.*shared\/hookEvents|shared\/hookEvents.*HookEvent/s);
  assert.match(preload, /payload: HookEvent/);
});

test('isTerminalPrompt: shared prompt detection across IPC formats', () => {
  assert.equal(isTerminalPrompt(null), false);
  assert.equal(isTerminalPrompt(undefined), false);
  assert.equal(isTerminalPrompt({}), false);
  // Structured types (camelCase from renderer HookEvent and snake_case from raw hook payload)
  assert.equal(isTerminalPrompt({ notificationType: 'permission_prompt' }), true);
  assert.equal(isTerminalPrompt({ notification_type: 'permission_prompt' }), true);
  assert.equal(isTerminalPrompt({ notificationType: 'elicitation_dialog' }), true);
  assert.equal(isTerminalPrompt({ notification_type: 'elicitation_dialog' }), true);
  assert.equal(isTerminalPrompt({ notificationType: 'idle_prompt' }), false);
  assert.equal(isTerminalPrompt({ notification_type: 'idle_prompt' }), false);
  // String message fallbacks
  assert.equal(isTerminalPrompt({ message: 'Claude needs your permission to use Write' }), true);
  assert.equal(isTerminalPrompt({ message: 'needs your approval' }), true);
  assert.equal(isTerminalPrompt({ message: 'Claude is waiting for your input' }), false);
  assert.equal(isTerminalPrompt({ message: '' }), false);
});

test('renderer useHive and main hooks share isTerminalPrompt', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main/hooks.ts'), 'utf8');
  const useHive = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useHive.ts'), 'utf8');

  assert.match(main, /isTerminalPrompt/);
  assert.match(useHive, /import\s*\{\s*isTerminalPrompt\s*\}\s*from\s*['"][^'"]*shared\/hookEvents['"]/);
  assert.match(useHive, /if\s*\(\s*isTerminalPrompt\(e\)\s*\)/);
});
