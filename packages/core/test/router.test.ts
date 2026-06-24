import assert from 'node:assert/strict';
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
