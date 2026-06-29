import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildToolIndex, forwardCall, refreshToolIndex, retrySkippedServers } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');
const FLAKY_FIXTURE = join(HERE, 'fixtures', 'flaky-mcp-server.mjs');
const HANG_FIXTURE = join(HERE, 'fixtures', 'hang-mcp-server.mjs');
const DELAYED_FIXTURE = join(HERE, 'fixtures', 'delayed-start-mcp-server.mjs');
const HTTP_FIXTURE = join(HERE, 'fixtures', 'http-echo-server.mjs');

const children: ChildProcess[] = [];

async function closeIndexClients(index: { clients: Map<unknown, { close?: () => Promise<void> }> }): Promise<void> {
  for (const client of index.clients.values()) {
    if (typeof client.close === 'function') await client.close().catch(() => {});
  }
}

async function startHttpFixture(): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn(process.execPath, [HTTP_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for QM_HTTP_PORT')), 10_000);
    proc.stderr?.on('data', (chunk: Buffer) => {
      const m = /QM_HTTP_PORT=(\d+)/.exec(chunk.toString());
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  return { url: `http://127.0.0.1:${port}/mcp`, proc };
}

// Real spawn: federate one fake downstream MCP server over stdio. Built once.
let index;
async function getIndex() {
  index ??= await buildToolIndex({ servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }] });
  return index;
}

after(async () => {
  if (index) await closeIndexClients(index);
  for (const proc of children) {
    proc.kill();
  }
});

test('buildToolIndex spawns the downstream and aggregates namespaced tools + schemas', async () => {
  const idx = await getIndex();
  assert.equal(idx.toolToServer.get('echo.create_issue'), 'echo');
  assert.ok(idx.schemas.has('echo.create_issue'));
  const names = idx.router.search('issue', 8).map((c) => c.tool);
  assert.ok(names.includes('echo.create_issue'));
});

test('the router ranks the right downstream tool for a natural-language query', async () => {
  const idx = await getIndex();
  assert.equal(idx.router.route('open a new issue', 5).candidates[0]?.tool, 'echo.create_issue');
});

test('forwardCall executes the tool on the downstream and returns its content', async () => {
  const idx = await getIndex();
  const res = await forwardCall(idx, 'echo.create_issue', { title: 'hello' });
  assert.ok(!res.isError);
  assert.match(res.content[0]?.text ?? '', /^echo:create_issue:/);
  assert.match(res.content[0]?.text ?? '', /hello/);
});

test('forwardCall on an unknown tool returns an isError result (no crash)', async () => {
  const idx = await getIndex();
  const res = await forwardCall(idx, 'echo.does_not_exist', {});
  assert.equal(res.isError, true);
});

test('refreshToolIndex re-polls tools/list without re-spawning', async () => {
  const idx = await getIndex();
  const report = await refreshToolIndex(idx, { servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }] });
  assert.equal(report.errors.length, 0);
  assert.ok(idx.router.search('issue', 8).some((c) => c.tool === 'echo.create_issue'));
});

// P2-15: a downstream that fails to start is skipped, not fatal.
test('a broken downstream is skipped; the proxy runs degraded on the rest', { timeout: 20000 }, async () => {
  const idx = await buildToolIndex({
    servers: [
      { id: 'echo', command: process.execPath, args: [FIXTURE] },
      { id: 'broken', command: 'quartermaster-no-such-command-xyz', args: [] },
    ],
  });
  try {
    assert.equal(idx.toolToServer.get('echo.create_issue'), 'echo'); // working server is present
    assert.equal(idx.clients.has('broken'), false); // broken one skipped
    assert.equal(idx.skippedServers.length, 1);
    assert.equal(idx.skippedServers[0]?.id, 'broken');
  } finally {
    await closeIndexClients(idx);
  }
});

test('refresh carries forward tools when one server tools/list fails', { timeout: 20000 }, async () => {
  const idx = await buildToolIndex({
    servers: [
      { id: 'echo', command: process.execPath, args: [FIXTURE] },
      {
        id: 'flaky',
        command: process.execPath,
        args: [FLAKY_FIXTURE],
        env: { QM_FLAKY_AFTER: '1' },
      },
    ],
  });
  try {
    assert.ok(idx.toolToServer.has('flaky.create_issue'));
    const report = await refreshToolIndex(idx, {
      servers: [
        { id: 'echo', command: process.execPath, args: [FIXTURE] },
        { id: 'flaky', command: process.execPath, args: [FLAKY_FIXTURE], env: { QM_FLAKY_AFTER: '1' } },
      ],
    });
    assert.ok(report.errors.some((e) => e.startsWith('flaky:')));
    assert.equal(idx.toolToServer.get('flaky.create_issue'), 'flaky');
    assert.equal(idx.toolToServer.get('echo.create_issue'), 'echo');
    const res = await forwardCall(idx, 'flaky.create_issue', { title: 'x' }, { callTimeoutMs: 5000 });
    assert.ok(!res.isError);
  } finally {
    await closeIndexClients(idx);
  }
});

test('retrySkippedServers connects a server that was unavailable at boot', { timeout: 20000 }, async () => {
  const delayedBoot = { id: 'delayed', command: process.execPath, args: [DELAYED_FIXTURE] };
  const delayedReady = { ...delayedBoot, env: { QM_DELAYED_READY: '1' } };
  const servers = [{ id: 'echo', command: process.execPath, args: [FIXTURE] }, delayedBoot];
  const idx = await buildToolIndex({ servers });
  try {
    assert.equal(idx.skippedServers.length, 1);
    assert.equal(idx.skippedServers[0]?.id, 'delayed');
    assert.equal(idx.clients.has('delayed'), false);
    assert.ok(idx.toolToServer.has('echo.create_issue'));
    const retry = await retrySkippedServers(idx, { servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }, delayedReady] });
    assert.deepEqual(retry.connected, ['delayed']);
    assert.equal(idx.skippedServers.length, 0);
    assert.ok(idx.toolToServer.has('delayed.ping'));
    const res = await forwardCall(idx, 'delayed.ping', {}, { callTimeoutMs: 5000 });
    assert.ok(!res.isError);
    assert.match(res.content[0]?.text ?? '', /delayed:pong/);
  } finally {
    await closeIndexClients(idx);
  }
});

test('forwardCall times out on a hanging downstream', { timeout: 10000 }, async () => {
  const idx = await buildToolIndex({
    servers: [{ id: 'hang', command: process.execPath, args: [HANG_FIXTURE] }],
    callTimeoutMs: 100,
  });
  try {
    const res = await forwardCall(idx, 'hang.slow_tool', {}, { callTimeoutMs: 100 });
    assert.equal(res.isError, true);
    assert.match(res.content[0]?.text ?? '', /timed out/);
  } finally {
    await closeIndexClients(idx);
  }
});

test('buildToolIndex connects to an HTTP downstream', { timeout: 20000 }, async () => {
  const { url } = await startHttpFixture();
  const idx = await buildToolIndex({
    servers: [{ id: 'http', transport: 'http', url }],
  });
  try {
    assert.equal(idx.toolToServer.get('http.create_issue'), 'http');
    const res = await forwardCall(idx, 'http.create_issue', { title: 'hi' }, { callTimeoutMs: 10_000 });
    assert.ok(!res.isError);
    assert.match(res.content[0]?.text ?? '', /http:create_issue/);
  } finally {
    await closeIndexClients(idx);
  }
});
