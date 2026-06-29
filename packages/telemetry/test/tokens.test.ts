import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estimateCatalogTokens,
  estimateTokens,
  estimateToolSchemaTokens,
  estimateCostSavingsUsd,
} from '../dist/tokens.js';

test('estimateTokens uses chars/4 rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('estimateToolSchemaTokens includes name, description, keywords, schema', () => {
  const withSchema = estimateToolSchemaTokens({
    name: 'github.create_issue',
    description: 'Open an issue',
    keywords: 'bug defect',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
  });
  const bare = estimateToolSchemaTokens({ name: 'github.create_issue' });
  assert.ok(withSchema > bare);
});

test('estimateCatalogTokens sums per-tool estimates', () => {
  const tools = [
    { name: 'a.one', description: 'first' },
    { name: 'b.two', description: 'second' },
  ];
  const schemas = new Map([['a.one', { type: 'object' }]]);
  const est = estimateCatalogTokens(tools, schemas);
  assert.equal(est.totalTools, 2);
  assert.ok(est.totalSchemaTokens > 0);
  assert.equal(est.perTool.size, 2);
});

test('estimateTokens supports words*1.3 method', () => {
  assert.equal(estimateTokens('one two three four', 'words*1.3'), 6);
});

test('estimateCostSavingsUsd uses pricing config override', () => {
  assert.equal(estimateCostSavingsUsd(2000, { costPer1kTokensUsd: 0.005 }), 0.01);
});

test('estimateCostSavingsUsd scales by token savings from env', () => {
  const prev = process.env.QM_TOKEN_COST_PER_1K;
  process.env.QM_TOKEN_COST_PER_1K = '0.01';
  try {
    assert.equal(estimateCostSavingsUsd(1000), 0.01);
  } finally {
    if (prev === undefined) delete process.env.QM_TOKEN_COST_PER_1K;
    else process.env.QM_TOKEN_COST_PER_1K = prev;
  }
});
