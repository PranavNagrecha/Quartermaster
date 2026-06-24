import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));
const CURSOR_EXAMPLE = join(HERE, '..', '..', '..', 'examples', 'cursor', 'quartermaster.json');
const GJS_EXAMPLE = join(HERE, '..', '..', '..', 'examples', 'github-jira-slack', 'quartermaster.json');

// Keeps the documented recipe config honest: it must parse with the real loader.
test('the Cursor recipe example config is valid', () => {
  const cfg = parseConfig(readFileSync(CURSOR_EXAMPLE, 'utf8'), CURSOR_EXAMPLE);
  assert.equal(cfg.servers?.length, 2);
  assert.equal(cfg.servers?.[0]?.id, 'filesystem');
  assert.deepEqual(cfg.servers?.[1]?.env, { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' });
  assert.equal(cfg.k, 8);
});

test('the github-jira-slack example config is valid', () => {
  const cfg = parseConfig(readFileSync(GJS_EXAMPLE, 'utf8'), GJS_EXAMPLE);
  assert.equal(cfg.servers?.length, 2);
  assert.equal(cfg.ranker?.expansionWeight, 0.5);
});
