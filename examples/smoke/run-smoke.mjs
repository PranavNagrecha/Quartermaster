#!/usr/bin/env node
/**
 * Dev workbench smoke — federates real public MCP servers (filesystem, memory,
 * everything, sequential-thinking, git). No API keys.
 *
 *   node examples/smoke/run-smoke.mjs              # CI: npm pack consumer path
 *   node examples/smoke/run-smoke.mjs --local      # dev bins
 *   node examples/smoke/run-smoke.mjs --metrics-out /tmp/smoke.json
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { writeDevWorkbenchConfig } from './build-real-config.mjs';
import { parseEvalRecallAt8 } from '../regression/lib/parse-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PROXY_PKG = join(REPO, 'packages', 'proxy');
const DEV_CASES = join(REPO, 'examples', 'regression', 'eval-cases-dev-workbench.jsonl');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const useNpx = flags.has('--npx');
const useLocal = flags.has('--local');

function argvValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
}

const metricsOut = argvValue('--metrics-out');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stderr || r.stdout}`);
  }
  return ((r.stdout ?? '') + (r.stderr ?? '')).trim();
}

function filterEvalCases(includeGit) {
  const src = readFileSync(DEV_CASES, 'utf8').trim().split('\n').filter(Boolean);
  const lines = includeGit ? src : src.filter((l) => !l.includes('"git.'));
  return lines.join('\n') + '\n';
}

function installPackedPackage(workDir) {
  mkdirSync(join(workDir, 'pack'), { recursive: true });
  run('npm', ['pack', '--pack-destination', join(workDir, 'pack')], { cwd: PROXY_PKG });
  const tgz = run('bash', ['-c', `ls ${join(workDir, 'pack')}/quartermaster-mcp-*.tgz | head -1`]);
  const installDir = join(workDir, 'installed');
  mkdirSync(installDir, { recursive: true });
  run('npm', ['install', '--omit=dev', tgz], { cwd: installDir });
  return {
    mcpBin: join(installDir, 'node_modules', '.bin', 'quartermaster-mcp'),
    cliBin: join(installDir, 'node_modules', '.bin', 'quartermaster'),
  };
}

function resolveBins(workDir) {
  if (useNpx) {
    return {
      mode: 'npx',
      mcp: 'npx',
      mcpArgs: ['-y', 'quartermaster-mcp'],
      cli: 'npx',
      cliArgs: ['-p', 'quartermaster-mcp', 'quartermaster'],
    };
  }
  if (useLocal) {
    return {
      mode: 'local',
      mcp: process.execPath,
      mcpArgs: [join(PROXY_PKG, 'bin', 'quartermaster-mcp.js')],
      cli: process.execPath,
      cliArgs: [join(PROXY_PKG, 'bin', 'quartermaster.js')],
    };
  }
  const bins = installPackedPackage(workDir);
  return {
    mode: 'pack',
    mcp: process.execPath,
    mcpArgs: [bins.mcpBin],
    cli: process.execPath,
    cliArgs: [bins.cliBin],
  };
}

function cliRun(bins, args, opts = {}) {
  return run(bins.cli, [...bins.cliArgs, ...args], opts);
}

async function main() {
  const started = performance.now();
  const workDir = mkdtempSync(join(tmpdir(), 'qm-smoke-'));
  const { configPath, fsRoot, serverIds, includeGit } = writeDevWorkbenchConfig(workDir, { repoRoot: REPO });
  const casesPath = join(workDir, 'eval-cases.jsonl');
  writeFileSync(casesPath, filterEvalCases(includeGit));
  const auditPath = join(workDir, 'audit.jsonl');
  let evalOut = '';
  let passed = false;

  try {
    const bins = resolveBins(workDir);
    console.log(`run-smoke: mode=${bins.mode}, dev-workbench=[${serverIds.join(', ')}]`);

    const version = run(bins.mcp, [...bins.mcpArgs, '--version']);
    assert.ok(version.length > 0, 'version printed');
    console.log(`  version: ${version}`);

    run(bins.mcp, [...bins.mcpArgs, '--validate', '--config', configPath]);
    console.log('  validate: ok');

    const doctor = cliRun(bins, ['doctor', '--config', configPath], { timeout: 180_000 });
    assert.match(doctor, /connected/i);
    for (const id of serverIds) {
      assert.match(doctor, new RegExp(id, 'i'), `doctor sees ${id}`);
    }
    console.log(`  doctor (${serverIds.length} downstreams): ok`);

    evalOut = cliRun(
      bins,
      ['eval', '--ci', '--min-r8', '0.5', '--config', configPath, '--cases', casesPath],
      { timeout: 180_000 },
    );
    assert.match(evalOut, /recall@8|R@8/i);
    console.log('  eval (dev workbench): ok');

    process.env.QM_SMOKE_COMMAND = bins.mcp;
    process.env.QM_SMOKE_ARGS = JSON.stringify(bins.mcpArgs);
    process.env.QM_SMOKE_MODE = 'real';
    process.env.QM_REAL_CONFIG = configPath;
    process.env.QM_REAL_SERVER_IDS = JSON.stringify(serverIds);
    process.env.QM_FILESYSTEM_ROOT = fsRoot;
    process.env.QM_AUDIT_FILE = auditPath;
    execFileSync(process.execPath, [join(HERE, 'mcp-smoke.mjs')], {
      stdio: 'inherit',
      env: process.env,
      timeout: 180_000,
    });
    console.log('  mcp-smoke (dev workbench): ok');

    execFileSync(process.execPath, [join(HERE, 'audit-cli-smoke.mjs'), auditPath, configPath], {
      stdio: 'inherit',
      env: { ...process.env, QM_SMOKE_CLI: bins.cli, QM_SMOKE_CLI_ARGS: JSON.stringify(bins.cliArgs) },
    });
    console.log('  audit-cli loop: ok');

    passed = true;
    console.log('\nrun-smoke: all checks passed (dev workbench)');
  } finally {
    const metrics = {
      suite: 'smoke',
      passed,
      durationMs: Math.round(performance.now() - started),
      servers: serverIds,
      recallAt8: parseEvalRecallAt8(evalOut),
    };
    if (metricsOut) writeFileSync(metricsOut, JSON.stringify(metrics, null, 2) + '\n');
    rmSync(workDir, { recursive: true, force: true });
    if (!passed) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
