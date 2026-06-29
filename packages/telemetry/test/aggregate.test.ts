import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateAudit, aggregateOverview, aggregateQueryChains, aggregateToolStats } from '../dist/aggregate.js';
import type { AuditLine } from '../dist/read.js';

const SAMPLE: AuditLine[] = [
  {
    event: 'retrieve',
    traceId: 'a',
    ts: 1,
    query: 'file bug',
    confidence: 'high',
    candidates: [{ tool: 'gh.create_issue', score: 1 }],
    estimatedTokenSavings: 100,
    estimatedCostSavingsUsd: 0.01,
    latencyMs: 5,
  },
  {
    event: 'call',
    traceId: 'a',
    ts: 2,
    tool: 'gh.create_issue',
    ok: true,
    rank: 1,
    latencyMs: 50,
  },
  { event: 'call_miss', traceId: 'b', tool: 'slack.post', query: 'dm', shortlisted: ['gh.create_issue'] },
];

test('aggregateOverview counts retrieves and savings', () => {
  const o = aggregateOverview(SAMPLE);
  assert.equal(o.retrieveCount, 1);
  assert.equal(o.callCount, 1);
  assert.equal(o.callMissCount, 1);
  assert.equal(o.totalEstimatedTokenSavings, 100);
});

test('aggregateQueryChains pairs retrieve with call', () => {
  const chains = aggregateQueryChains(SAMPLE);
  assert.equal(chains.length, 1);
  const first = chains.find((c) => c.traceId === 'a');
  assert.equal(first?.calledTool, 'gh.create_issue');
  assert.equal(first?.callOk, true);
});

test('aggregateToolStats scores tools', () => {
  const stats = aggregateToolStats(SAMPLE);
  const gh = stats.find((s) => s.tool === 'gh.create_issue');
  assert.ok(gh);
  assert.equal(gh!.called, 1);
  assert.ok(gh!.qualityScore > 0);
});

test('aggregateAudit produces CLI report summary', () => {
  const s = aggregateAudit(SAMPLE);
  assert.equal(s.totalRetrieves, 1);
  assert.equal(s.totalCalls, 1);
  assert.ok(s.topSearchedTools.some((t) => t.tool === 'gh.create_issue'));
});

test('aggregateSavingsReport breaks down by server and agent', async () => {
  const { aggregateSavingsReport } = await import('../dist/aggregate.js');
  const report = aggregateSavingsReport([
    {
      event: 'retrieve',
      traceId: 't1',
      agentId: 'agent-a',
      sessionId: 'sess-1',
      totalSchemaTokens: 1000,
      shortlistSchemaTokens: 100,
      estimatedTokenSavings: 900,
      estimatedCostSavingsUsd: 0.0027,
      candidateTools: ['gh.create_issue'],
    } as AuditLine,
  ]);
  assert.equal(report.overview.retrieveCount, 1);
  assert.ok(report.byAgent.some((r) => r.key === 'agent-a'));
  assert.ok(report.bySession.some((r) => r.key === 'sess-1'));
});
