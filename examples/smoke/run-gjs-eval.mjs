#!/usr/bin/env node
/**
 * Optional eval against examples/github-jira-slack — requires GITHUB_TOKEN and SLACK_TOKEN.
 * Skips with exit 0 when tokens are unset.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const config = join(REPO, 'examples', 'github-jira-slack', 'quartermaster.json');
const cases = join(HERE, 'eval-cases-github-slack.jsonl');
const cli = process.execPath;
const cliArgs = [join(REPO, 'packages', 'proxy', 'bin', 'quartermaster.js')];

if (!process.env.GITHUB_TOKEN || !process.env.SLACK_TOKEN) {
  console.log('run-gjs-eval: skipped (set GITHUB_TOKEN and SLACK_TOKEN to run)');
  process.exit(0);
}

function run(args) {
  const r = spawnSync(cli, [...cliArgs, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }
  return (r.stdout ?? '').trim();
}

console.log('run-gjs-eval: doctor');
run(['doctor', '--config', config]);
console.log('run-gjs-eval: eval --ci');
run(['eval', '--ci', '--min-r8', '0.5', '--config', config, '--cases', cases]);
console.log('run-gjs-eval: passed');
