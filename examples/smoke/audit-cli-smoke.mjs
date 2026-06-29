#!/usr/bin/env node
/**
 * Validates report, savings, inspect, eval --from-audit, and dashboard on audit traffic.
 *
 *   node examples/smoke/audit-cli-smoke.mjs <audit.jsonl> <config.json>
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const auditPath = process.argv[2];
const configPath = process.argv[3];

if (!auditPath || !configPath) {
  console.error('usage: audit-cli-smoke.mjs <audit.jsonl> <config.json>');
  process.exit(1);
}

const cli = process.env.QM_SMOKE_CLI ?? process.execPath;
const cliArgs = process.env.QM_SMOKE_CLI_ARGS
  ? JSON.parse(process.env.QM_SMOKE_CLI_ARGS)
  : [join(HERE, '..', '..', 'packages', 'proxy', 'bin', 'quartermaster.js')];

function run(args, opts = {}) {
  const r = spawnSync(cli, [...cliArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
}

function fetchOk(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`GET ${url} → ${res.statusCode}`));
        else resolve(body);
      });
    }).on('error', reject);
  });
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-audit-cli-'));
  const reportHtml = join(workDir, 'report.html');
  const draftCases = join(workDir, 'draft-cases.jsonl');

  try {
    run(['report', '--audit', auditPath, '--out', reportHtml]);
    const html = readFileSync(reportHtml, 'utf8');
    assert.match(html, /<html/i);
    console.log('  report: ok');

    const savings = run(['savings', '--audit', auditPath, '--json']);
    const savingsJson = JSON.parse(savings);
    assert.ok(Object.keys(savingsJson).length > 0);
    console.log('  savings: ok');

    const inspect = run(['inspect', '--config', configPath, '--audit', auditPath]);
    assert.ok(inspect.length > 0);
    console.log('  inspect: ok');

    run(['eval', '--from-audit', auditPath, '--draft-cases', draftCases, '--config', configPath]);
    const drafted = readFileSync(draftCases, 'utf8').trim();
    assert.ok(drafted.length > 0, 'draft cases written');
    console.log('  eval --from-audit: ok');

    const dash = spawn(cli, [...cliArgs, 'dashboard', '--audit', auditPath, '--port', '3848'], {
      detached: true,
      stdio: 'ignore',
    });
    dash.unref();
    await new Promise((r) => setTimeout(r, 800));
    const page = await fetchOk('http://127.0.0.1:3848/');
    assert.match(page, /<html/i);
    console.log('  dashboard: ok');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('audit-cli-smoke failed:', err);
  process.exit(1);
});
