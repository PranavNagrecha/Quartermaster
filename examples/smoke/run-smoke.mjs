#!/usr/bin/env node
/**
 * Full product smoke — federates real public MCP servers (filesystem, memory,
 * everything, optional git via uvx). No API keys. Also validates npm pack path.
 *
 *   node examples/smoke/run-smoke.mjs           # CI: pack + install to temp dir
 *   node examples/smoke/run-smoke.mjs --npx     # consumer: npx quartermaster-mcp from npm
 *   node examples/smoke/run-smoke.mjs --local   # dev: repo bins (no pack)
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRealServersConfig } from './build-real-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PROXY_PKG = join(REPO, 'packages', 'proxy');
const REAL_CASES = join(HERE, 'eval-cases-real-servers.jsonl');

const flags = new Set(process.argv.slice(2));
const useNpx = flags.has('--npx');
const useLocal = flags.has('--local');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}):\n${r.stderr || r.stdout}`);
  }
  return ((r.stdout ?? '') + (r.stderr ?? '')).trim();
}

function filterEvalCases(includeGit) {
  const src = readFileSync(REAL_CASES, 'utf8').trim().split('\n');
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
  const workDir = mkdtempSync(join(tmpdir(), 'qm-smoke-'));
  const { configPath, fsRoot, serverIds, includeGit } = writeRealServersConfig(workDir, { repoRoot: REPO });
  const casesPath = join(workDir, 'eval-cases.jsonl');
  writeFileSync(casesPath, filterEvalCases(includeGit));
  const auditPath = join(workDir, 'audit.jsonl');

  try {
    const bins = resolveBins(workDir);
    console.log(`run-smoke: mode=${bins.mode}, servers=[${serverIds.join(', ')}]`);

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
    console.log(`  doctor (${serverIds.length} real downstreams): ok`);

    const evalOut = cliRun(
      bins,
      ['eval', '--ci', '--min-r8', '0.5', '--config', configPath, '--cases', casesPath],
      { timeout: 180_000 },
    );
    assert.match(evalOut, /recall@8|R@8/i);
    console.log('  eval (real servers): ok');

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
    console.log('  mcp-smoke (real federation): ok');

    execFileSync(process.execPath, [join(HERE, 'audit-cli-smoke.mjs'), auditPath, configPath], {
      stdio: 'inherit',
      env: { ...process.env, QM_SMOKE_CLI: bins.cli, QM_SMOKE_CLI_ARGS: JSON.stringify(bins.cliArgs) },
    });
    console.log('  audit-cli loop: ok');

    console.log('\nrun-smoke: all checks passed against real MCP servers');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
