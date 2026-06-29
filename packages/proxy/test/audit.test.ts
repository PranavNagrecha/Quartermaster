import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { auditLog, initAudit, createServer, forwardCall } from '../dist/index.js';
import { buildStaticRouter } from '../dist/index.js';

test('auditLog writes structured JSON to stderr when QM_AUDIT=1', () => {
  const prev = process.env.QM_AUDIT;
  process.env.QM_AUDIT = '1';
  initAudit('test-session');
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  try {
    auditLog({ event: 'test', foo: 'bar' });
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? '{}') as {
      event: string;
      foo: string;
      ts: number;
      schemaVersion: number;
      sessionId: string;
    };
    assert.equal(parsed.event, 'test');
    assert.equal(parsed.foo, 'bar');
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.sessionId, 'test-session');
    assert.equal(typeof parsed.ts, 'number');
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('auditLog is silent when QM_AUDIT is unset', () => {
  const prev = process.env.QM_AUDIT;
  delete process.env.QM_AUDIT;
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  try {
    auditLog({ event: 'test' });
    assert.equal(lines.length, 0);
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('forwardCall links call audit to retrieve traceId', async () => {
  const prev = process.env.QM_AUDIT;
  process.env.QM_AUDIT = '1';
  initAudit('trace-session');
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  const idx = {
    router: buildStaticRouter({
      tools: [{ name: 'github.create_issue', description: 'Open an issue' }],
    }),
    clients: new Map([['github', { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }]]),
    toolToServer: new Map([['github.create_issue', 'github']]),
    toolToBare: new Map([['github.create_issue', 'create_issue']]),
    schemas: new Map([['github.create_issue', { type: 'object' }]]),
    lastKnownTools: new Map(),
    skippedServers: [],
    configuredServerCount: 1,
    callTimeoutMs: 30_000,
    maxK: 50,
    catalogTools: [{ name: 'github.create_issue', description: 'Open an issue' }],
    retrieveByTraceId: new Map(),
    lastRetrieve: { query: 'open issue', tools: ['github.create_issue'], traceId: 'trace-abc' },
    serverById: new Map([['github', { id: 'github', command: 'noop', transport: 'stdio' as const }]]),
    circuitBreakers: new Map(),
    semaphores: new Map(),
  };
  try {
    await forwardCall(idx, 'github.create_issue', {});
    const callLine = lines.find((l) => {
      try {
        return (JSON.parse(l) as { event?: string }).event === 'call';
      } catch {
        return false;
      }
    });
    assert.ok(callLine);
    const parsed = JSON.parse(callLine ?? '{}') as {
      event: string;
      traceId: string;
      wasShortlisted: boolean;
      rank: number;
      latencyMs: number;
    };
    assert.equal(parsed.traceId, 'trace-abc');
    assert.equal(parsed.wasShortlisted, true);
    assert.equal(parsed.rank, 1);
    assert.equal(typeof parsed.latencyMs, 'number');
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('forwardCall uses explicit traceId when lastRetrieve points elsewhere', async () => {
  const prev = process.env.QM_AUDIT;
  process.env.QM_AUDIT = '1';
  initAudit('trace-explicit');
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  const traceA = { query: 'open issue', tools: ['github.create_issue'], traceId: 'trace-a' };
  const traceB = { query: 'post message', tools: ['slack.post_message'], traceId: 'trace-b' };
  const idx = {
    router: buildStaticRouter({
      tools: [
        { name: 'github.create_issue', description: 'Open an issue' },
        { name: 'slack.post_message', description: 'Send a message' },
      ],
    }),
    clients: new Map([
      ['github', { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
      ['slack', { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
    ]),
    toolToServer: new Map([
      ['github.create_issue', 'github'],
      ['slack.post_message', 'slack'],
    ]),
    toolToBare: new Map([
      ['github.create_issue', 'create_issue'],
      ['slack.post_message', 'post_message'],
    ]),
    schemas: new Map(),
    lastKnownTools: new Map(),
    catalogTools: [
      { name: 'github.create_issue', description: 'Open an issue' },
      { name: 'slack.post_message', description: 'Send a message' },
    ],
    retrieveByTraceId: new Map([
      ['trace-a', traceA],
      ['trace-b', traceB],
    ]),
    skippedServers: [],
    configuredServerCount: 2,
    callTimeoutMs: 30_000,
    maxK: 50,
    lastRetrieve: traceB,
    serverById: new Map([
      ['github', { id: 'github', command: 'noop', transport: 'stdio' as const }],
      ['slack', { id: 'slack', command: 'noop', transport: 'stdio' as const }],
    ]),
    circuitBreakers: new Map(),
    semaphores: new Map(),
  };
  try {
    await forwardCall(idx, 'github.create_issue', {}, { traceId: 'trace-a' });
    const events = lines.map((l) => JSON.parse(l) as { event?: string; traceId?: string; wasShortlisted?: boolean });
    const callMiss = events.find((e) => e.event === 'call_miss');
    assert.equal(callMiss, undefined);
    const call = events.find((e) => e.event === 'call');
    assert.ok(call);
    assert.equal(call!.traceId, 'trace-a');
    assert.equal(call!.wasShortlisted, true);
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('static retrieve audit reports totalSchemaTokens from catalog descriptions', async () => {
  const prevAudit = process.env.QM_AUDIT;
  const prevFile = process.env.QM_AUDIT_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'qm-audit-'));
  const auditFile = join(dir, 'audit.jsonl');
  process.env.QM_AUDIT = '1';
  process.env.QM_AUDIT_FILE = auditFile;
  initAudit('static-tokens');
  const server = createServer({
    tools: [
      { name: 'github.create_issue', description: 'Open a new issue in a repository' },
      { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
    ],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'qm-audit-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    await client.callTool({ name: 'retrieve_tools', arguments: { query: 'file a bug' } });
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n');
    const retrieve = JSON.parse(lines.find((l) => (JSON.parse(l) as { event?: string }).event === 'retrieve') ?? '{}') as {
      totalSchemaTokens: number;
    };
    assert.ok(retrieve.totalSchemaTokens > 0);
  } finally {
    await client.close();
    if (prevAudit === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prevAudit;
    if (prevFile === undefined) delete process.env.QM_AUDIT_FILE;
    else process.env.QM_AUDIT_FILE = prevFile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('static retrieve audit honors configured pricing and token estimate method', async () => {
  const prevAudit = process.env.QM_AUDIT;
  const prevFile = process.env.QM_AUDIT_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'qm-audit-pricing-'));
  const auditFile = join(dir, 'audit.jsonl');
  process.env.QM_AUDIT = '1';
  process.env.QM_AUDIT_FILE = auditFile;
  initAudit('static-pricing');
  const server = createServer({
    tools: [
      { name: 'github.create_issue', description: 'Open a new issue in a repository' },
      { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
    ],
    pricing: { tokenEstimateMethod: 'words*1.3', costPer1kTokensUsd: 0.01 },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'qm-audit-pricing-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    await client.callTool({ name: 'retrieve_tools', arguments: { query: 'unmatched query' } });
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n');
    const retrieve = JSON.parse(lines.find((l) => (JSON.parse(l) as { event?: string }).event === 'retrieve') ?? '{}') as {
      tokenEstimateMethod: string;
      estimatedTokenSavings: number;
      estimatedCostSavingsUsd: number;
    };
    assert.equal(retrieve.tokenEstimateMethod, 'words*1.3');
    assert.equal(retrieve.estimatedCostSavingsUsd, Math.round((retrieve.estimatedTokenSavings / 1000) * 0.01 * 1_000_000) / 1_000_000);
  } finally {
    await client.close();
    if (prevAudit === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prevAudit;
    if (prevFile === undefined) delete process.env.QM_AUDIT_FILE;
    else process.env.QM_AUDIT_FILE = prevFile;
    rmSync(dir, { recursive: true, force: true });
  }
});
