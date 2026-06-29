import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectCatalog, formatInspectOutput } from '../dist/inspect.js';
import { scoreToolQuality, findOverlappingTools } from '../dist/quality.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const STATIC_CONFIG = join(REPO_ROOT, 'examples', 'static-demo', 'quartermaster.json');
const AUDIT = join(HERE, 'fixtures', 'sample-audit.jsonl');

test('scoreToolQuality deducts for missing description', () => {
  const r = scoreToolQuality({ name: 'x.y', description: '' });
  assert.equal(r.score, 70);
  assert.equal(r.descriptionRating, 'missing');
});

test('scoreToolQuality deducts for generic description', () => {
  const r = scoreToolQuality({ name: 'x.y', description: 'A tool for running commands on the server' });
  assert.equal(r.descriptionRating, 'generic');
  assert.ok(r.score < 100);
});

test('scoreToolQuality deducts for large schema', () => {
  const big = 'x'.repeat(9000);
  const r = scoreToolQuality({ name: 'x.y', description: 'A well-written description here', inputSchema: { data: big } });
  assert.ok(r.schemaTokens > 2000);
  assert.ok(r.score <= 85);
});

test('inspectCatalog scores static demo tools', async () => {
  const lines = await inspectCatalog({ configPath: STATIC_CONFIG });
  assert.equal(lines.length, 4);
  const issue = lines.find((l) => l.name === 'github.create_issue');
  assert.ok(issue);
  assert.equal(issue!.quality.descriptionRating, 'good');
  assert.ok(issue!.quality.score >= 80);
});

test('inspectCatalog cross-references audit traffic', async () => {
  const lines = await inspectCatalog({ configPath: STATIC_CONFIG, auditPath: AUDIT });
  const issue = lines.find((l) => l.name === 'github.create_issue');
  assert.ok(issue?.traffic);
  assert.ok((issue?.traffic?.retrieved ?? 0) >= 1);
  assert.ok((issue?.traffic?.called ?? 0) >= 1);
});

test('formatInspectOutput renders human-readable lines', async () => {
  const lines = await inspectCatalog({ configPath: STATIC_CONFIG, auditPath: AUDIT });
  const text = formatInspectOutput(lines, []);
  assert.match(text, /github\.create_issue/);
  assert.match(text, /quality: \d+\/100/);
  assert.match(text, /retrieved:/);
});

test('findOverlappingTools detects identical descriptions across servers', () => {
  const overlaps = findOverlappingTools([
    { name: 'a.do_thing', description: 'Send a notification to users' },
    { name: 'b.do_thing', description: 'Send a notification to users' },
  ]);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0]?.reason, 'same bare name');
});
