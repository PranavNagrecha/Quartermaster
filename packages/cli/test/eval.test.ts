import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCasesJsonl } from '../dist/config-tools.js';
import { appendEvalRun } from '../dist/eval-audit.js';
import { runEval, checkCiGate } from '../dist/eval.js';
import type { Tool } from '@quartermaster/core';

const HERE = dirname(fileURLToPath(import.meta.url));

const TOOLS: Tool[] = [
  { name: 'github.create_issue', description: 'Open a new issue in a repository' },
  { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
];

test('runEval scores bm25 above zero on fixture cases', () => {
  const cases = loadCasesJsonl(join(HERE, 'fixtures', 'eval-cases.jsonl'));
  const result = runEval(TOOLS, cases, { bug: ['issue'], dm: ['message'] }, {});
  const bm25 = result.rows.find((r) => r.variant === 'bm25');
  assert.ok(bm25);
  assert.ok((bm25!.recall[1] ?? 0) > 0);
  assert.equal(result.caseCount, 2);
});

test('checkCiGate fails when R@8 below floor', () => {
  const result = runEval(TOOLS, [{ query: 'zzz', expectedTool: 'nope' }], {}, {});
  const gate = checkCiGate(result, 0.99);
  assert.equal(gate.ok, false);
});

test('bm25 baseline ignores config synonyms unlike bm25+synonyms', () => {
  const tools: Tool[] = [{ name: 'github.create_issue', description: 'Open a new issue in a repository' }];
  const cases = [{ query: 'file a bug', expectedTool: 'github.create_issue' }];
  const synonyms = { bug: ['issue'] };
  const result = runEval(tools, cases, synonyms, { synonyms, expansionWeight: 0.5 });
  const bm25 = result.rows.find((r) => r.variant === 'bm25');
  const bm25syn = result.rows.find((r) => r.variant === 'bm25+synonyms');
  assert.ok(bm25);
  assert.ok(bm25syn);
  assert.equal(bm25!.recall[8], 0);
  assert.equal(bm25syn!.recall[8], 1);
});

test('appendEvalRun writes eval_run JSONL event', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qm-eval-audit-'));
  const path = join(dir, 'audit.jsonl');
  const result = runEval(TOOLS, [{ query: 'file a bug', expectedTool: 'github.create_issue' }], {}, {});
  appendEvalRun(path, result, { evalId: 'eval-test-1', configPath: '/tmp/qm.json' });
  const line = JSON.parse(readFileSync(path, 'utf8').trim()) as {
    schemaVersion: number;
    event: string;
    evalId: string;
    caseCount: number;
    toolCount: number;
    variants: { id: string }[];
    configPath: string;
  };
  assert.equal(line.schemaVersion, 2);
  assert.equal(line.event, 'eval_run');
  assert.equal(line.evalId, 'eval-test-1');
  assert.equal(line.caseCount, 1);
  assert.equal(line.toolCount, 2);
  assert.ok(line.variants.some((v) => v.id === 'bm25'));
  assert.equal(line.configPath, '/tmp/qm.json');
  rmSync(dir, { recursive: true, force: true });
});
