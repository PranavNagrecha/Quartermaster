import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(HERE, '..', '..', '..', 'examples', 'cursor', 'quartermaster.json');

// Keeps the documented recipe config honest: it must parse with the real loader.
test('the Cursor recipe example config is valid', () => {
  const cfg = parseConfig(readFileSync(EXAMPLE, 'utf8'), EXAMPLE);
  assert.equal(cfg.servers?.length, 2);
  assert.equal(cfg.servers?.[0]?.id, 'filesystem');
  assert.deepEqual(cfg.servers?.[1]?.env, { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' });
  assert.equal(cfg.k, 8);
});
