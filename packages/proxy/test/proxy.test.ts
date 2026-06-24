import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStaticRouter, createServer, retrieveTools } from '../src/index.ts';

const CONFIG = {
  tools: [
    { name: 'github.create_issue', description: 'Open a new issue in a repository' },
    { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
    { name: 'calendar.create_event', description: 'Add an event to the calendar' },
  ],
  synonyms: { bug: ['issue'] },
};

test('buildStaticRouter fails loud on an empty manifest', () => {
  assert.throws(() => buildStaticRouter({ tools: [] }), /no tools to index/);
});

test('retrieveTools returns a confidence-annotated shortlist with descriptions', () => {
  const router = buildStaticRouter(CONFIG);
  const res = retrieveTools(router, 'file a bug', 5);
  assert.ok(['none', 'low', 'high'].includes(res.confidence));
  assert.equal(typeof res.guidance, 'string');
  assert.ok(res.candidates.length > 0);
  assert.equal(res.candidates[0]?.tool, 'github.create_issue');
  assert.equal(res.candidates[0]?.description, 'Open a new issue in a repository');
});

test('retrieveTools reports none when nothing matches', () => {
  const router = buildStaticRouter(CONFIG);
  assert.equal(retrieveTools(router, 'zzzqqq unrelated nonsense', 5).confidence, 'none');
});

test('createServer builds without throwing for a valid config', () => {
  assert.doesNotThrow(() => createServer(CONFIG));
});
