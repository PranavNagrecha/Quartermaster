import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, startFromConfig, validateConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));

test('parseCliArgs reads --config <path>', () => {
  assert.deepEqual(parseCliArgs(['--config', '/x/quartermaster.json']), { action: 'run', config: '/x/quartermaster.json' });
});

test('parseCliArgs reads --config=<path>', () => {
  assert.deepEqual(parseCliArgs(['--config=/y.json']), { action: 'run', config: '/y.json' });
});

test('parseCliArgs --validate', () => {
  assert.deepEqual(parseCliArgs(['--validate', '--config', '/z.json']), { action: 'validate', config: '/z.json' });
});

test('parseCliArgs --help', () => {
  assert.deepEqual(parseCliArgs(['--help']), { action: 'help' });
});

test('parseCliArgs --version', () => {
  assert.deepEqual(parseCliArgs(['--version']), { action: 'version' });
});

test('parseCliArgs throws usage when --config is missing', () => {
  assert.throws(() => parseCliArgs([]), /usage: quartermaster-mcp --config/);
});

test('parseCliArgs throws usage when --config has no value', () => {
  assert.throws(() => parseCliArgs(['--config']), /usage: quartermaster-mcp --config/);
});

test('validateConfig accepts a valid static config', async () => {
  await assert.doesNotReject(() => validateConfig(join(HERE, 'fixtures', 'ext-synonyms', 'quartermaster.json')));
});

test('startFromConfig rejects (does not hang) on an unreadable config', async () => {
  await assert.rejects(() => startFromConfig('/no/such/quartermaster.json'), /cannot read config file/);
});
