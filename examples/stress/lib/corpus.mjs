import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

/** @returns {{ tools: object[]; cases?: object[] }} */
export function loadBenchFixture(name) {
  const path = join(REPO, 'bench', 'cases', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Deterministic synthetic corpus (same seed logic as bench/generate.mjs, inlined minimal). */
export function generateTools(count) {
  const domains = ['github', 'slack', 'jira', 'salesforce', 'aws', 'gcp', 'k8s', 'db', 'crm', 'hr'];
  const verbs = ['create', 'list', 'get', 'update', 'delete', 'search', 'sync', 'export', 'import', 'run'];
  const nouns = ['issue', 'ticket', 'user', 'record', 'file', 'bucket', 'cluster', 'report', 'message', 'event'];
  const tools = [];
  for (let i = 0; i < count; i++) {
    const d = domains[i % domains.length];
    const v = verbs[(i * 3) % verbs.length];
    const n = nouns[(i * 7) % nouns.length];
    const name = `${d}.${v}_${n}_${i}`;
    tools.push({
      name,
      description: `${v.replace(/_/g, ' ')} a ${n.replace(/_/g, ' ')} in ${d}`,
      category: d,
    });
  }
  return tools;
}

export const STRESS_QUERIES = [
  'list files in the project folder',
  'remember that the user likes vim',
  'echo hello world',
  'show git status',
  'read a config file',
  'search for issues about login',
  'create a new ticket for billing',
  'export customer data to csv',
  'sync records from salesforce',
  'delete old log files',
  'what changed in the repo',
  'send a reminder to the team',
  'find open pull requests',
  'update the deployment config',
  'run the nightly backup job',
];
