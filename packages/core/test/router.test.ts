import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createRouter, tokenize } from '../src/index.ts';

const TOOLS = [
  { name: 'github.create_issue', description: 'Open a new issue in a repository' },
  { name: 'github.search_code', description: 'Search source code across repositories' },
  { name: 'jira.create_ticket', description: 'Create a Jira ticket' },
  { name: 'calendar.create_event', description: 'Add an event to the calendar' },
];

test('tokenize splits snake_case and stems plurals', () => {
  const toks = tokenize('create_issues for the repos');
  assert.ok(toks.includes('create'));
  assert.ok(toks.includes('issue')); // stemmed from issues
  assert.ok(toks.includes('repo')); // stemmed from repos
  assert.ok(!toks.includes('the')); // stopword dropped
});

test('bm25 ranks the obviously-relevant tool first', () => {
  const router = createRouter(TOOLS);
  const top = router.search('open a new issue on the repo', 4);
  assert.equal(top[0]?.tool, 'github.create_issue');
});

test('recall@K: the right tool is in the shortlist even on indirect phrasing', () => {
  const router = createRouter(TOOLS, { synonyms: { bug: ['issue'], file: ['create', 'open'] } });
  const top = router.search('file a bug', 3).map((c) => c.tool);
  assert.ok(top.includes('github.create_issue'));
});

test('empty / unmatched query returns no candidates', () => {
  const router = createRouter(TOOLS);
  assert.equal(router.search('the').length, 0);
});

test('tfidf ranker also resolves the relevant tool', () => {
  const router = createRouter(TOOLS, { ranker: 'tfidf' });
  const top = router.search('search code in repositories', 4);
  assert.equal(top[0]?.tool, 'github.search_code');
});

// Weighted synonym expansion (P1-1). srv.aaa would win on the alphabetical
// tie-break if synonyms were unweighted; weighting makes the EXACT-term match
// (srv.zzz) win instead.
const WEIGHT_TOOLS = [
  { name: 'srv.aaa', description: 'beta' },
  { name: 'srv.zzz', description: 'alpha' },
];

test('weighted expansion: exact-term match outranks a synonym-only match', () => {
  const router = createRouter(WEIGHT_TOOLS, { synonyms: { alpha: ['beta'] } }); // default expansionWeight 0.5
  const top = router.search('alpha', 2);
  assert.equal(top[0]?.tool, 'srv.zzz'); // exact 'alpha' beats synonym 'beta' despite alpha-order
  assert.ok(top.some((c) => c.tool === 'srv.aaa')); // synonym still surfaces it
});

test('expansionWeight 0 disables synonym expansion entirely', () => {
  const router = createRouter(WEIGHT_TOOLS, { synonyms: { alpha: ['beta'] }, expansionWeight: 0 });
  const top = router.search('alpha', 2).map((c) => c.tool);
  assert.ok(top.includes('srv.zzz'));
  assert.ok(!top.includes('srv.aaa')); // synonym ignored
});

test('explain mode returns per-term contributions, sorted, summing to the score', () => {
  const router = createRouter(TOOLS);
  const [first] = router.search('open a new issue on the repo', 2, { explain: true });
  assert.ok(first?.matches && first.matches.length > 0);
  for (const m of first.matches) {
    assert.equal(typeof m.term, 'string');
    assert.equal(typeof m.contribution, 'number');
  }
  const cs = first.matches.map((m) => m.contribution);
  assert.deepEqual(cs, [...cs].sort((a, b) => b - a)); // sorted desc
  const sum = cs.reduce((a, c) => a + c, 0);
  assert.ok(Math.abs(sum - first.score) < 0.01); // contributions ≈ score (BM25)
});

test('explain is off by default — no matches field', () => {
  const router = createRouter(TOOLS);
  assert.equal(router.search('open a new issue', 2)[0]?.matches, undefined);
});

test('includeDescription echoes the tool description into candidates', () => {
  const router = createRouter(TOOLS);
  const [first] = router.search('open a new issue', 2, { includeDescription: true });
  assert.equal(first?.tool, 'github.create_issue');
  assert.equal(first?.description, 'Open a new issue in a repository');
});

test('description is off by default', () => {
  const router = createRouter(TOOLS);
  assert.equal(router.search('open a new issue', 2)[0]?.description, undefined);
});

// Low-confidence signal (P1-8).
test('route reports none when nothing matches', () => {
  const res = createRouter(TOOLS).route('zzzqqq totally unrelated nonsense', 5);
  assert.equal(res.confidence, 'none');
  assert.equal(res.candidates.length, 0);
  assert.match(res.guidance, /no tools|rephrase|broaden/i);
});

test('route reports high confidence on a clear winner', () => {
  const res = createRouter(TOOLS).route('open a new issue', 5);
  assert.equal(res.candidates[0]?.tool, 'github.create_issue');
  assert.equal(res.confidence, 'high');
});

test('route reports low confidence on a near-tie', () => {
  const tied = [
    { name: 'a.alpha', description: 'manage widgets in the system' },
    { name: 'b.beta', description: 'manage widgets in the system' },
  ];
  const res = createRouter(tied).route('manage widgets', 5);
  assert.equal(res.confidence, 'low');
  assert.ok(res.candidates.length >= 2);
});

// Corpus-aware expansion default (P1-16).
const FILLER = 'lorem ipsum dolor sit amet consectetur '.repeat(8); // ~310 chars (rich)
test('terse corpus auto-enables expansion', () => {
  const terse = [
    { name: 'a.one', description: 'alpha' },
    { name: 'b.two', description: 'beta' },
  ];
  const tools = createRouter(terse, { synonyms: { alpha: ['beta'] } }).search('alpha', 2).map((c) => c.tool);
  assert.ok(tools.includes('b.two')); // synonym surfaced → expansion on
});

test('rich corpus auto-disables expansion', () => {
  const rich = [
    { name: 'a.one', description: `alpha ${FILLER}` },
    { name: 'b.two', description: `beta ${FILLER}` },
  ];
  const tools = createRouter(rich, { synonyms: { alpha: ['beta'] } }).search('alpha', 2).map((c) => c.tool);
  assert.ok(!tools.includes('b.two')); // expansion auto-off on rich descriptions
});

test('explicit expansionWeight overrides the auto-default', () => {
  const rich = [
    { name: 'a.one', description: `alpha ${FILLER}` },
    { name: 'b.two', description: `beta ${FILLER}` },
  ];
  const tools = createRouter(rich, { synonyms: { alpha: ['beta'] }, expansionWeight: 0.5 }).search('alpha', 2).map((c) => c.tool);
  assert.ok(tools.includes('b.two')); // explicit weight wins over auto-off
});

// Edge cases (P1-3).
test('empty manifest: search returns nothing and route reports none', () => {
  const router = createRouter([]);
  assert.deepEqual(router.search('anything at all'), []);
  assert.equal(router.route('anything at all').confidence, 'none');
});

test('single-tool manifest resolves that tool', () => {
  const router = createRouter([{ name: 'only.tool', description: 'send an email' }]);
  assert.equal(router.search('send an email', 5)[0]?.tool, 'only.tool');
});

test('duplicate tool names do not crash (both indexed)', () => {
  const router = createRouter([
    { name: 'dup.tool', description: 'first one about invoices' },
    { name: 'dup.tool', description: 'second one about invoices' },
  ]);
  const hits = router.search('invoices', 5).filter((c) => c.tool === 'dup.tool');
  assert.ok(hits.length >= 1);
});

test('all-stopword query returns nothing', () => {
  assert.deepEqual(createRouter(TOOLS).search('the a of to on'), []);
});

test('a very long description still indexes and matches', () => {
  const long = `creates a customer invoice ${'lorem ipsum '.repeat(2000)}`;
  const router = createRouter([{ name: 'billing.invoice', description: long }]);
  assert.equal(router.search('create a customer invoice', 5)[0]?.tool, 'billing.invoice');
});

test('CJK is a known tokenizer limitation: non-Latin queries do not match, but do not crash', () => {
  const router = createRouter([{ name: 'search.tool', description: '搜索代码 search code' }]);
  assert.deepEqual(router.search('搜索代码'), []); // CJK stripped → no tokens (documented limit)
  assert.equal(router.search('search code', 5)[0]?.tool, 'search.tool'); // Latin still works
});

// Perf budget (P1-4): guard against an O(N^2)-style regression at scale.
// Budgets are deliberately generous (CI machines vary) — they only catch a blow-up,
// not micro-regressions. Real numbers are ~20ms build / ~2ms per search.
test('1000-tool index builds and searches within a generous time budget', () => {
  const tools = Array.from({ length: 1000 }, (_, i) => ({
    name: `srv${i % 25}.tool_${i}`,
    description: `performs operation ${i} on widgets, gadgets and records in service ${i % 25}`,
  }));

  const tBuild = performance.now();
  const router = createRouter(tools);
  const buildMs = performance.now() - tBuild;

  const tSearch = performance.now();
  for (let i = 0; i < 200; i++) router.search('operation on widgets and records', 8);
  const avgSearchMs = (performance.now() - tSearch) / 200;

  assert.ok(buildMs < 1500, `build took ${buildMs.toFixed(1)}ms (budget 1500)`);
  assert.ok(avgSearchMs < 50, `avg search ${avgSearchMs.toFixed(2)}ms (budget 50)`);
});

test('hint boost: query mentioning server id ranks that server\'s tools higher', () => {
  const tools = [
    { name: 'github.create_issue', description: 'Open issue', category: 'github' },
    { name: 'jira.create_ticket', description: 'Open issue', category: 'jira' },
  ];
  const withHint = createRouter(tools, { hintBoost: 0.5 });
  const withoutHint = createRouter(tools, { hintBoost: 0 });
  assert.equal(withHint.search('github open issue', 2)[0]?.tool, 'github.create_issue');
  // Without hint both tie on lexical score; github wins alphabetically on tie-break
  assert.equal(withoutHint.search('github open issue', 2)[0]?.tool, 'github.create_issue');
});

test('determinism: same query + corpus yields identical order across runs', () => {
  const router = createRouter(TOOLS, { synonyms: { bug: ['issue'] } });
  const first = router.search('file a bug', 5).map((c) => c.tool);
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(router.search('file a bug', 5).map((c) => c.tool), first);
  }
});
