import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

test('parses a valid static-manifest config', () => {
  const cfg = parseConfig(
    JSON.stringify({ tools: [{ name: 'a.b', description: 'do a thing' }], synonyms: { bug: ['issue'] }, k: 5 }),
  );
  assert.equal(cfg.tools?.length, 1);
  assert.equal(cfg.tools?.[0]?.name, 'a.b');
  assert.deepEqual(cfg.synonyms, { bug: ['issue'] });
  assert.equal(cfg.k, 5);
});

test('parses a valid downstream-servers config (with env)', () => {
  const cfg = parseConfig(
    JSON.stringify({ servers: [{ id: 'github', command: 'npx', args: ['-y', 'x'], env: { TOKEN: '${GH}' } }] }),
  );
  assert.equal(cfg.servers?.length, 1);
  assert.equal(cfg.servers?.[0]?.id, 'github');
  assert.deepEqual(cfg.servers?.[0]?.env, { TOKEN: '${GH}' });
});

test('rejects a server whose env is not a string map', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ servers: [{ id: 'gh', command: 'npx', env: { TOKEN: 123 } }] })),
    /\.env must be an object of string/,
  );
});

test('rejects invalid JSON with an actionable message', () => {
  assert.throws(() => parseConfig('{ not json'), /not valid JSON/);
});

test('rejects a non-object top level', () => {
  assert.throws(() => parseConfig('[]'), /must be a JSON object/);
});

test('rejects a config with neither tools nor servers', () => {
  assert.throws(() => parseConfig(JSON.stringify({ k: 8 })), /non-empty "tools".*or "servers"/);
});

test('rejects a tool missing a name', () => {
  assert.throws(() => parseConfig(JSON.stringify({ tools: [{ description: 'x' }] })), /tools\[0\] is missing/);
});

test('rejects a server missing a command', () => {
  assert.throws(() => parseConfig(JSON.stringify({ servers: [{ id: 'gh' }] })), /missing.*"command"/);
});

test('rejects a non-positive k', () => {
  assert.throws(() => parseConfig(JSON.stringify({ tools: [{ name: 'a' }], k: 0 })), /"k" must be a positive number/);
});

test('parses per-tool overlays', () => {
  const cfg = parseConfig(JSON.stringify({ tools: [{ name: 'a' }], overlays: { a: { keywords: 'x y' } } }));
  assert.deepEqual(cfg.overlays, { a: { keywords: 'x y' } });
});

test('rejects malformed overlays', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ tools: [{ name: 'a' }], overlays: { a: { keywords: 5 } } })),
    /overlays\["a"\] must be an object with a string/,
  );
});

test('rejects malformed synonyms', () => {
  assert.throws(() => parseConfig(JSON.stringify({ tools: [{ name: 'a' }], synonyms: { bug: 'issue' } })), /synonyms\["bug"\] must be an array/);
});
