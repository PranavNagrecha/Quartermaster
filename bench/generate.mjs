// Deterministic synthetic fixture generator for the Quartermaster bench.
//
// Produces realistic, federated tool manifests at several scales plus a labeled
// gold query set, into bench/cases/synthetic-<N>.json. Deterministic (seeded
// LCG, no Math.random) so the benchmark inputs are stable across runs.
//
// HONESTY: gold queries are written in colloquial language that deliberately
// AVOIDS the words in the tool description (e.g. "open a bug" → create_issue,
// whose description says "Create a new issue"). This stresses the lexical/
// vocabulary gap rather than flattering the ranker. The synonyms map shipped in
// each fixture is a GENERAL business→dev map, not per-query cherry-picking.
//
// Usage:  node bench/generate.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');

/** Seeded LCG → deterministic [0,1). */
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
function shuffle(rnd, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DOMAINS = [
  { p: 'github', nouns: ['issue', 'pull_request', 'repository', 'branch', 'commit', 'release', 'workflow', 'gist'] },
  { p: 'gitlab', nouns: ['merge_request', 'pipeline', 'runner', 'snippet', 'milestone'] },
  { p: 'slack', nouns: ['message', 'channel', 'reminder', 'file', 'reaction', 'thread'] },
  { p: 'jira', nouns: ['ticket', 'sprint', 'board', 'epic', 'worklog'] },
  { p: 'linear', nouns: ['issue', 'project', 'cycle', 'team'] },
  { p: 'calendar', nouns: ['event', 'reminder', 'invite', 'availability'] },
  { p: 'drive', nouns: ['file', 'folder', 'permission', 'revision'] },
  { p: 'notion', nouns: ['page', 'database', 'block', 'comment'] },
  { p: 'stripe', nouns: ['charge', 'refund', 'customer', 'invoice', 'subscription', 'payout'] },
  { p: 'shopify', nouns: ['order', 'product', 'inventory_item', 'discount', 'fulfillment'] },
  { p: 'aws', nouns: ['instance', 'bucket', 'function', 'queue', 'log_group', 'role'] },
  { p: 'gcp', nouns: ['vm', 'bucket', 'function', 'topic', 'dataset'] },
  { p: 'k8s', nouns: ['pod', 'deployment', 'service', 'namespace', 'secret', 'configmap'] },
  { p: 'postgres', nouns: ['table', 'row', 'index', 'schema'] },
  { p: 'mongodb', nouns: ['collection', 'document', 'index'] },
  { p: 'redis', nouns: ['key', 'stream', 'set'] },
  { p: 'datadog', nouns: ['monitor', 'dashboard', 'metric', 'log'] },
  { p: 'sentry', nouns: ['error', 'release', 'project'] },
  { p: 'pagerduty', nouns: ['incident', 'schedule', 'service'] },
  { p: 'hubspot', nouns: ['contact', 'deal', 'company', 'ticket'] },
  { p: 'zendesk', nouns: ['ticket', 'user', 'organization', 'macro'] },
  { p: 'twilio', nouns: ['sms', 'call', 'number'] },
];

const VERBS = [
  { v: 'create', tpl: (n) => `Create a new ${n}` },
  { v: 'list', tpl: (n) => `List ${n}s` },
  { v: 'get', tpl: (n) => `Get a single ${n} by id` },
  { v: 'update', tpl: (n) => `Update an existing ${n}` },
  { v: 'delete', tpl: (n) => `Delete a ${n}` },
  { v: 'search', tpl: (n) => `Search ${n}s matching a query` },
  { v: 'archive', tpl: (n) => `Archive a ${n}` },
  { v: 'assign', tpl: (n) => `Assign a ${n} to a user` },
  { v: 'export', tpl: (n) => `Export ${n}s to a file` },
  { v: 'comment', tpl: (n) => `Add a comment to a ${n}` },
];

function buildAllTools() {
  const tools = [];
  for (const d of DOMAINS)
    for (const n of d.nouns)
      for (const vb of VERBS)
        tools.push({
          name: `${d.p}.${vb.v}_${n}`,
          description: `${vb.tpl(n.replace(/_/g, ' '))} in ${d.p}.`,
          category: d.p,
        });
  return tools;
}

// Colloquial paraphrases — intentionally lexically distant from the descriptions.
const VERB_PARA = {
  create: ['make', 'open', 'start', 'add', 'set up', 'file', 'log'],
  list: ['show me all', 'what are my', 'see every'],
  get: ['look up', 'fetch', 'pull up', 'find the'],
  update: ['change', 'edit', 'rename', 'modify'],
  delete: ['remove', 'drop', 'get rid of'],
  search: ['find', 'look for', 'hunt for'],
  archive: ['shelve', 'put away', 'close out'],
  assign: ['hand off', 'give', 'route'],
  export: ['dump', 'download', 'back up'],
  comment: ['leave a note on', 'reply to', 'annotate'],
};
const NOUN_PARA = {
  issue: ['bug', 'ticket', 'problem'], pull_request: ['PR', 'merge request', 'code review'],
  merge_request: ['MR', 'PR'], repository: ['repo', 'codebase'], message: ['dm', 'note', 'chat'],
  charge: ['payment'], refund: ['money back'], customer: ['client', 'account'], invoice: ['bill'],
  instance: ['server', 'box'], vm: ['server', 'box'], bucket: ['object store', 'blob storage'],
  function: ['lambda', 'serverless function'], pod: ['container'], deployment: ['rollout'],
  table: ['relation'], event: ['meeting', 'appointment'], file: ['document', 'attachment'],
  ticket: ['case', 'issue'], incident: ['outage', 'page'], error: ['exception', 'crash'],
  contact: ['lead', 'person'], deal: ['opportunity'], order: ['purchase'], sms: ['text message'],
  monitor: ['alert'], pipeline: ['build', 'CI run'],
};
const DOMAIN_PARA = {
  github: ['the repo', 'github', ''], gitlab: ['gitlab', ''], slack: ['slack', 'chat', ''],
  jira: ['jira', ''], stripe: ['stripe', 'billing', ''], aws: ['aws', 'the cloud', ''],
  k8s: ['the cluster', 'kubernetes', ''], calendar: ['my calendar', ''], drive: ['drive', ''],
};

// General business→dev synonym overlay (NOT per-query — honest expansion).
const SYNONYMS = {
  bug: ['issue', 'ticket', 'problem', 'defect'], ticket: ['issue', 'case'], pr: ['pull', 'request', 'review'],
  mr: ['merge', 'request'], repo: ['repository', 'codebase'], dm: ['message', 'direct', 'chat'],
  note: ['message', 'comment'], chat: ['message'], payment: ['charge', 'invoice'], bill: ['invoice'],
  client: ['customer', 'account'], lead: ['contact'], opportunity: ['deal'], purchase: ['order'],
  server: ['instance', 'vm', 'host'], box: ['instance', 'server', 'vm'], lambda: ['function', 'serverless'],
  container: ['pod'], rollout: ['deployment', 'deploy'], deploy: ['deployment'], meeting: ['event', 'appointment', 'invite'],
  appointment: ['event'], document: ['file', 'doc'], attachment: ['file'], outage: ['incident'], page: ['incident'],
  exception: ['error'], crash: ['error'], alert: ['monitor'], build: ['pipeline'], text: ['sms'],
  make: ['create', 'new', 'add'], open: ['create', 'new'], start: ['create'], file: ['create', 'log'],
  log: ['create'], remove: ['delete'], drop: ['delete'], change: ['update', 'edit', 'modify'],
  edit: ['update', 'modify'], rename: ['update'], find: ['search', 'get', 'lookup'], lookup: ['get', 'find', 'search'],
  fetch: ['get'], dump: ['export'], download: ['export'], shelve: ['archive'], route: ['assign'], give: ['assign'],
};

function makeQuery(rnd, tool) {
  const [, rest] = tool.name.split('.');
  const us = rest.indexOf('_');
  const verb = rest.slice(0, us);
  const noun = rest.slice(us + 1);
  const vp = pick(rnd, VERB_PARA[verb] ?? [verb]);
  const np = pick(rnd, NOUN_PARA[noun] ?? [noun.replace(/_/g, ' ')]);
  const dp = pick(rnd, DOMAIN_PARA[tool.category] ?? ['']);
  return `${vp} a ${np}${dp ? ' in ' + dp : ''}`.replace(/\s+/g, ' ').trim();
}

function generate(n) {
  const rnd = lcg(0xc0ffee ^ n);
  const all = shuffle(rnd, buildAllTools());
  const tools = all.slice(0, n);
  const qCount = Math.min(40, Math.floor(n / 3) || tools.length);
  const sampled = shuffle(lcg(0xbeef ^ n), tools).slice(0, qCount);
  const cases = sampled.map((t) => ({ query: makeQuery(lcg(t.name.length ^ n), t), expectedTool: t.name }));
  return { name: `synthetic-${n}`, synonyms: SYNONYMS, tools, cases };
}

mkdirSync(CASES, { recursive: true });
for (const n of [50, 200, 500, 1000]) {
  const fixture = generate(n);
  const file = join(CASES, `synthetic-${n}.json`);
  writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${file}  (${fixture.tools.length} tools, ${fixture.cases.length} cases)`);
}
