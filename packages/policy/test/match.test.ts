import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluatePolicy } from '../dist/evaluate.js';
import { matchesGlob, ruleMatches } from '../dist/match.js';
import type { PolicyContext } from '../dist/types.js';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  toolName: 'github.create_issue',
  bareName: 'create_issue',
  serverId: 'github',
  agentId: 'unknown',
  environment: 'default',
  ...over,
});

test('matchesGlob supports * wildcard', () => {
  assert.ok(matchesGlob('github.read_file', 'github.read_*'));
  assert.ok(!matchesGlob('github.write_file', 'github.read_*'));
});

test('ruleMatches by serverId and toolPattern', () => {
  assert.ok(ruleMatches({ effect: 'deny', serverId: 'github' }, ctx()));
  assert.ok(!ruleMatches({ effect: 'deny', serverId: 'slack' }, ctx()));
  assert.ok(ruleMatches({ effect: 'deny', toolPattern: 'github.*' }, ctx()));
  assert.ok(ruleMatches({ effect: 'allow', agentId: 'ci-bot' }, ctx({ agentId: 'ci-bot' })));
});

test('default allow when no policy', () => {
  const d = evaluatePolicy(undefined, ctx());
  assert.equal(d.allowed, true);
  assert.equal(d.shadow, false);
});

test('default deny mode blocks unmatched tools', () => {
  const d = evaluatePolicy({ defaultMode: 'deny' }, ctx());
  assert.equal(d.allowed, false);
});

test('deny rule beats allow rule', () => {
  const d = evaluatePolicy(
    {
      rules: [
        { effect: 'allow', serverId: 'github' },
        { effect: 'deny', tool: 'github.create_issue' },
      ],
    },
    ctx(),
  );
  assert.equal(d.allowed, false);
  assert.equal(d.matchedRule?.effect, 'deny');
});

test('allow rule permits when no deny matches', () => {
  const d = evaluatePolicy(
    {
      defaultMode: 'deny',
      rules: [{ effect: 'allow', toolPattern: 'github.*' }],
    },
    ctx(),
  );
  assert.equal(d.allowed, true);
});

test('shell preset denies exec tools', () => {
  const d = evaluatePolicy({ presets: ['shell'] }, ctx({ toolName: 'local.bash_exec', bareName: 'bash_exec' }));
  assert.equal(d.allowed, false);
  assert.equal(d.matchedPreset, 'shell');
});

test('shadow mode still reports deny but allowed flag is false', () => {
  const d = evaluatePolicy(
    { mode: 'shadow', rules: [{ effect: 'deny', serverId: 'github' }] },
    ctx(),
  );
  assert.equal(d.allowed, false);
  assert.equal(d.shadow, true);
});
