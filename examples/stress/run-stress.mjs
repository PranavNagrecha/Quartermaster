#!/usr/bin/env node
/**
 * Quartermaster stress test — ranker scale, MCP federation load, concurrency, chaos.
 *
 *   node examples/stress/run-stress.mjs           # full stress
 *   node examples/stress/run-stress.mjs --quick    # reduced counts (dev)
 *   node examples/stress/run-stress.mjs --ci      # CI-sized gates
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createRouter } from '../../packages/core/dist/index.js';
import { writeRealServersConfig } from '../smoke/build-real-config.mjs';
import { generateTools, loadBenchFixture, STRESS_QUERIES } from './lib/corpus.mjs';
import { callNamespaced, connectMcp, retrieveTools } from './lib/mcp.mjs';
import { assertMax, formatStats, summarize } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PROXY_BIN = join(REPO, 'packages', 'proxy', 'bin', 'quartermaster-mcp.js');
const ECHO = join(REPO, 'packages', 'proxy', 'test', 'fixtures', 'echo-mcp-server.mjs');
const FLAKY = join(REPO, 'packages', 'proxy', 'test', 'fixtures', 'flaky-mcp-server.mjs');

const flags = new Set(process.argv.slice(2));
const quick = flags.has('--quick');
const ci = flags.has('--ci');

const SCALE = {
  rankerOps: quick ? 200 : ci ? 500 : 2000,
  mcpRetrieves: quick ? 30 : ci ? 60 : 150,
  mcpConcurrent: quick ? 10 : ci ? 15 : 30,
  mcpCalls: quick ? 15 : ci ? 30 : 60,
  chaosCalls: quick ? 20 : ci ? 40 : 80,
  staticTools: quick ? 200 : ci ? 500 : 1000,
};

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function stressRankerInProcess() {
  const fixtures = [
    { label: 'heritage-171', tools: loadBenchFixture('heritage-sfi').tools, queries: STRESS_QUERIES },
    { label: 'synthetic-500', tools: generateTools(500), queries: null },
    { label: 'synthetic-1000', tools: generateTools(1000), queries: null },
  ];

  for (const fixture of fixtures) {
    const { label, tools } = fixture;
    const router = createRouter(tools, { synonyms: { bug: ['issue'], file: ['read'] } });
    const latencies = [];
    let errors = 0;
    const queries = fixture.queries ?? tools.slice(0, 40).map((t) => `${t.description ?? t.name}`);

    const t0 = performance.now();
    for (let i = 0; i < SCALE.rankerOps; i++) {
      const q = queries[i % queries.length];
      const start = performance.now();
      try {
        router.route(q, 8);
      } catch {
        errors++;
      }
      latencies.push(performance.now() - start);
    }
    const elapsed = performance.now() - t0;
    const stats = summarize(latencies);
    const opsPerSec = Math.round((SCALE.rankerOps / elapsed) * 1000);
    const errRate = errors / SCALE.rankerOps;

    const p99Limit = tools.length <= 200 ? 30 : tools.length <= 500 ? 80 : 150;
    try {
      assert.ok(errRate < 0.01, `error rate ${(errRate * 100).toFixed(1)}%`);
      assertMax(stats.p99, p99Limit, `${label} ranker p99`);
      record(
        `ranker/${label}`,
        true,
        `${opsPerSec} ops/s, ${formatStats('latency', stats)}, errors=${errors}`,
      );
    } catch (e) {
      record(`ranker/${label}`, false, e.message);
      throw e;
    }
  }
}

function writeStaticConfig(dir, toolCount) {
  const tools = generateTools(toolCount);
  const path = join(dir, 'static-large.json');
  writeFileSync(path, JSON.stringify({ tools, synonyms: { bug: ['issue'] }, k: 8 }, null, 2));
  return path;
}

function writeChaosConfig(dir) {
  const path = join(dir, 'chaos.json');
  writeFileSync(
    path,
    JSON.stringify(
      {
        servers: [
          { id: 'echo', command: process.execPath, args: [ECHO] },
          {
            id: 'flaky',
            command: process.execPath,
            args: [FLAKY],
            circuitBreaker: { failureThreshold: 3, resetMs: 2000 },
            maxConcurrency: 2,
          },
        ],
        k: 8,
      },
      null,
      2,
    ),
  );
  return path;
}

async function hammerRetrieves(client, count, concurrent) {
  const latencies = [];
  let errors = 0;
  const queries = STRESS_QUERIES;

  for (let batch = 0; batch < count; batch += concurrent) {
    const size = Math.min(concurrent, count - batch);
    const jobs = Array.from({ length: size }, async (_, j) => {
      const q = queries[(batch + j) % queries.length];
      const start = performance.now();
      try {
        const payload = await retrieveTools(client, q);
        if (!payload.candidates) errors++;
        latencies.push(performance.now() - start);
      } catch {
        errors++;
      }
    });
    await Promise.all(jobs);
  }

  return { stats: summarize(latencies), errors, total: count };
}

async function stressStaticMcp() {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-stress-static-'));
  try {
    const config = writeStaticConfig(workDir, SCALE.staticTools);
    const { client, close } = await connectMcp({
      command: process.execPath,
      args: [PROXY_BIN, '--config', config],
    });
    try {
      const { stats, errors, total } = await hammerRetrieves(client, SCALE.mcpRetrieves, SCALE.mcpConcurrent);
      const errRate = errors / total;
      const p99Limit = SCALE.staticTools <= 200 ? 500 : SCALE.staticTools <= 500 ? 1500 : 3000;
      assert.ok(errRate < 0.02, `error rate ${(errRate * 100).toFixed(1)}%`);
      assertMax(stats.p99, p99Limit, `static-${SCALE.staticTools} mcp p99`);
      record(
        `mcp/static-${SCALE.staticTools}`,
        true,
        `${formatStats('retrieve', stats)}, errors=${errors}/${total}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function stressRealFederation() {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-stress-real-'));
  try {
    const { configPath, fsRoot, serverIds } = writeRealServersConfig(workDir, { repoRoot: REPO });
    const { client, close } = await connectMcp({
      command: process.execPath,
      args: [PROXY_BIN, '--config', configPath],
    });
    try {
      const retrieve = await hammerRetrieves(client, SCALE.mcpRetrieves, SCALE.mcpConcurrent);
      assert.ok(retrieve.errors / retrieve.total < 0.02);
      assertMax(retrieve.stats.p99, 5000, 'real federation retrieve p99');

      const callLatencies = [];
      let callErrors = 0;
      for (let i = 0; i < SCALE.mcpCalls; i++) {
        const start = performance.now();
        try {
          const res = await callNamespaced(client, 'filesystem.list_directory', { path: fsRoot });
          if (res.isError) callErrors++;
          callLatencies.push(performance.now() - start);
        } catch {
          callErrors++;
        }
      }
      const callStats = summarize(callLatencies);
      assert.ok(callErrors / SCALE.mcpCalls < 0.02);

      const servers = await client.callTool({ name: 'list_servers', arguments: {} });
      const payload = JSON.parse(servers.content?.[0]?.text ?? '{}');
      assert.equal(payload.degraded, false, 'not degraded under load');

      record(
        `mcp/real-federation`,
        true,
        `servers=[${serverIds.join(',')}] ${formatStats('retrieve', retrieve.stats)}, ` +
          `${formatStats('call', callStats)}, callErrors=${callErrors}`,
      );
    } finally {
      await close();
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function stressChaosFederation() {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-stress-chaos-'));
  try {
    const config = writeChaosConfig(workDir);
    const { client, close } = await connectMcp({
      command: process.execPath,
      args: [PROXY_BIN, '--config', config],
    });
    try {
      let ok = 0;
      let err = 0;
      let crashes = 0;
      for (let i = 0; i < SCALE.chaosCalls; i++) {
        try {
          const target = i % 3 === 0 ? 'flaky.create_issue' : 'echo.create_issue';
          const res = await callNamespaced(client, target, { title: `stress-${i}` });
          if (res.isError) err++;
          else ok++;
        } catch {
          crashes++;
        }
      }
      assert.equal(crashes, 0, 'proxy session must not crash');
      assert.ok(ok > 0, 'some calls should succeed through chaos');

      const servers = await client.callTool({ name: 'list_servers', arguments: {} });
      const payload = JSON.parse(servers.content?.[0]?.text ?? '{}');
      assert.ok(payload.servers.length >= 1, 'at least one server up');

      record(`mcp/chaos`, true, `ok=${ok} err=${err} crashes=${crashes} degraded=${payload.degraded}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function stressMemoryStability() {
  const tools = generateTools(1000);
  const router = createRouter(tools);
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;

  for (let i = 0; i < 1000; i++) {
    router.route(STRESS_QUERIES[i % STRESS_QUERIES.length], 8);
  }

  if (global.gc) global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const deltaMb = (heapAfter - heapBefore) / 1024 / 1024;

  const limit = 80;
  try {
    assert.ok(deltaMb < limit, `heap grew ${deltaMb.toFixed(1)}MB`);
    record('ranker/memory-stability', true, `heap delta ${deltaMb.toFixed(1)}MB after 1000 routes`);
  } catch (e) {
    record('ranker/memory-stability', false, e.message);
    if (!quick) throw e;
  }
}

async function main() {
  const mode = quick ? 'quick' : ci ? 'ci' : 'full';
  console.log(`quartermaster stress test (${mode})\n`);

  await stressRankerInProcess();
  await stressStaticMcp();
  await stressRealFederation();
  await stressChaosFederation();
  await stressMemoryStability();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} passed ---`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nstress test aborted:', err);
  process.exit(1);
});
