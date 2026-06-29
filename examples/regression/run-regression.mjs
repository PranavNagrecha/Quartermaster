#!/usr/bin/env node
/**
 * Regression harness — runs smoke + stress twice, eval suites, compares stability.
 *
 *   pnpm regression           # full: 2× smoke (pack) + 2× stress + eval
 *   pnpm regression:ci        # CI: 2× quick smoke/stress + eval gates
 *   pnpm regression:local     # dev bins, 2 rounds
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { writeBlindManifestConfig, writeDevWorkbenchConfig } from '../smoke/build-real-config.mjs';
import { runAuditLoopCheck } from './lib/audit-loop.mjs';
import { compareRounds } from './lib/compare.mjs';
import { parseEvalRecallAt8 } from './lib/parse-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const CLI = join(REPO, 'packages', 'proxy', 'bin', 'quartermaster.js');
const BLIND_FIXTURE = join(REPO, 'bench', 'cases', 'real-mcp-blind.json');
const DEV_CASES = join(HERE, 'eval-cases-dev-workbench.jsonl');
const BLIND_CASES = join(HERE, 'eval-cases-blind-manifest.jsonl');
const RESULTS_DIR = join(HERE, 'results');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const ci = flags.has('--ci');
const local = flags.has('--local');
const ROUNDS = 2;

function runNode(script, extraArgs = []) {
  const r = spawnSync(process.execPath, [script, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: ci ? 300_000 : 600_000,
  });
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: (r.stdout ?? '') + (r.stderr ?? ''),
  };
}

function runEval(configPath, casesPath, minR8 = 0.5) {
  const r = spawnSync(
    process.execPath,
    [CLI, 'eval', '--ci', `--min-r8`, String(minR8), '--config', configPath, '--cases', casesPath],
    { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
  );
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return {
    ok: r.status === 0,
    recallAt8: parseEvalRecallAt8(out),
    output: out,
  };
}

function filterCases(path, includeGit) {
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  return includeGit ? lines : lines.filter((l) => !l.includes('"git.'));
}

async function runRound(round, workDir) {
  const roundDir = join(workDir, `round-${round}`);
  mkdirSync(roundDir, { recursive: true });

  const smokeArgs = ['--metrics-out', join(roundDir, 'smoke.json')];
  if (local) smokeArgs.unshift('--local');

  const stressArgs = ['--metrics-out', join(roundDir, 'stress.json')];
  if (ci) stressArgs.unshift('--ci');

  console.log(`\n=== Round ${round}/${ROUNDS} ===\n`);

  const smoke = runNode(join(REPO, 'examples/smoke/run-smoke.mjs'), smokeArgs);
  console.log(smoke.stdout);
  assert.ok(smoke.ok, `round ${round} smoke failed`);

  const stress = runNode(join(REPO, 'examples/stress/run-stress.mjs'), stressArgs);
  console.log(stress.stdout);
  assert.ok(stress.ok, `round ${round} stress failed`);

  const { configPath, includeGit, synonymsFile } = writeDevWorkbenchConfig(roundDir, { repoRoot: REPO });
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(cfg.synonymsFile, './business-to-dev.json', 'dev config uses starter synonymsFile');
  assert.ok(readFileSync(synonymsFile, 'utf8').includes('"bug"'), 'starter synonyms copied');
  const devCasesPath = join(roundDir, 'dev-cases.jsonl');
  writeFileSync(devCasesPath, filterCases(DEV_CASES, includeGit).join('\n') + '\n');

  const blind = JSON.parse(readFileSync(BLIND_FIXTURE, 'utf8'));
  const blindConfig = writeBlindManifestConfig(roundDir, blind.tools);

  const devEval = runEval(configPath, devCasesPath, 0.5);
  assert.ok(devEval.ok, `round ${round} dev workbench eval failed\n${devEval.output}`);
  console.log(`  dev workbench eval R@8: ${((devEval.recallAt8 ?? 0) * 100).toFixed(1)}%`);

  const blindEval = runEval(blindConfig, BLIND_CASES, 0.45);
  assert.ok(blindEval.ok, `round ${round} blind manifest eval failed\n${blindEval.output}`);
  console.log(`  blind manifest eval R@8: ${((blindEval.recallAt8 ?? 0) * 100).toFixed(1)}%`);

  const smokeMetrics = JSON.parse(readFileSync(join(roundDir, 'smoke.json'), 'utf8'));
  const stressMetrics = JSON.parse(readFileSync(join(roundDir, 'stress.json'), 'utf8'));

  return {
    passed: true,
    smoke: smokeMetrics,
    stress: stressMetrics,
    devEval: { recallAt8: devEval.recallAt8 },
    blindEval: { recallAt8: blindEval.recallAt8 },
  };
}

async function main() {
  const started = performance.now();
  const workDir = mkdtempSync(join(tmpdir(), 'qm-regression-'));
  mkdirSync(RESULTS_DIR, { recursive: true });

  console.log(`quartermaster regression (${ci ? 'ci' : local ? 'local' : 'full'}, ${ROUNDS} rounds)`);

  const auditLoop = runAuditLoopCheck(REPO);
  console.log(`audit-loop: ok (${auditLoop.draftCaseCount} draft cases from sample audit)\n`);

  const rounds = [];
  for (let r = 1; r <= ROUNDS; r++) {
    rounds.push(await runRound(r, workDir));
  }

  const comparison = compareRounds(rounds[0], rounds[1]);
  console.log('\n=== Round 1 vs Round 2 (stability) ===');
  for (const line of comparison.lines) console.log(line);

  const report = {
    ts: new Date().toISOString(),
    mode: ci ? 'ci' : local ? 'local' : 'full',
    rounds: ROUNDS,
    durationMs: Math.round(performance.now() - started),
    auditLoop,
    round1: rounds[0],
    round2: rounds[1],
    comparison: { ok: comparison.ok, issues: comparison.issues },
  };

  const outPath = join(RESULTS_DIR, 'latest.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nWrote ${outPath}`);

  rmSync(workDir, { recursive: true, force: true });

  if (!comparison.ok) {
    console.error('\nRegression stability check failed:');
    for (const i of comparison.issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  console.log('\nregression: all rounds passed, metrics stable');
}

main().catch((err) => {
  console.error('regression aborted:', err);
  process.exit(1);
});
