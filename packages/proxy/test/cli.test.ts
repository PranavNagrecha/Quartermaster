import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArgs, startFromConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

test('parseCliArgs reads --config <path>', () => {
  assert.deepEqual(parseCliArgs(['--config', '/x/quartermaster.json']), { config: '/x/quartermaster.json' });
});

test('parseCliArgs reads --config=<path>', () => {
  assert.deepEqual(parseCliArgs(['--config=/y.json']), { config: '/y.json' });
});

test('parseCliArgs throws usage when --config is missing', () => {
  assert.throws(() => parseCliArgs([]), /usage: quartermaster-mcp --config/);
});

test('parseCliArgs throws usage when --config has no value', () => {
  assert.throws(() => parseCliArgs(['--config']), /usage: quartermaster-mcp --config/);
});

test('startFromConfig rejects (does not hang) on an unreadable config', async () => {
  await assert.rejects(() => startFromConfig('/no/such/quartermaster.json'), /cannot read config file/);
});
