import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertWithinConfigDir, buildRouterOptions, loadConfig, parseConfig } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));

test('loadConfig merges external synonyms + overlays files (P1-10)', () => {
  const cfg = loadConfig(join(HERE, 'fixtures', 'ext-synonyms', 'quartermaster.json'));
  assert.deepEqual(cfg.synonyms?.bug, ['issue', 'defect']);
  assert.deepEqual(cfg.synonyms?.folder, ['directory']);
  assert.deepEqual(cfg.overlays?.['gh.create_issue'], { keywords: 'report filing' });
});

test('loadConfig rejects synonymsFile paths that escape the config directory', () => {
  assert.throws(
    () => loadConfig(join(HERE, 'fixtures', 'ext-traversal', 'quartermaster.json')),
    /must stay within the config directory/,
  );
});

test('assertWithinConfigDir allows paths under the config directory', () => {
  const dir = join(HERE, 'fixtures', 'ext-synonyms');
  assert.doesNotThrow(() => assertWithinConfigDir(dir, join(dir, 'synonyms.json')));
});

test('loadConfig fails clearly when a referenced synonyms file is missing', () => {
  assert.throws(
    () => loadConfig(join(HERE, 'fixtures', 'ext-missing', 'quartermaster.json')),
    /cannot read synonyms file/,
  );
});

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

test('rejects duplicate server ids (they namespace tool names)', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ servers: [{ id: 'gh', command: 'a' }, { id: 'gh', command: 'b' }] })),
    /duplicate server id "gh"/,
  );
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

test('rejects server id containing a dot', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ servers: [{ id: 'a.b', command: 'npx' }] })),
    /id must not contain '\.'/,
  );
});

test('parses ranker block and buildRouterOptions merges synonyms', () => {
  const cfg = parseConfig(
    JSON.stringify({
      tools: [{ name: 'a' }],
      synonyms: { bug: ['issue'] },
      ranker: { ranker: 'tfidf', expansionWeight: 0, marginThreshold: 0.2 },
    }),
  );
  assert.equal(cfg.ranker?.ranker, 'tfidf');
  assert.equal(cfg.ranker?.expansionWeight, 0);
  const opts = buildRouterOptions(cfg);
  assert.equal(opts.ranker, 'tfidf');
  assert.equal(opts.expansionWeight, 0);
  assert.deepEqual(opts.synonyms, { bug: ['issue'] });
});

test('rejects unknown ranker keys', () => {
  assert.throws(
    () => parseConfig(JSON.stringify({ tools: [{ name: 'a' }], ranker: { foo: 1 } })),
    /unknown key "foo"/,
  );
});
