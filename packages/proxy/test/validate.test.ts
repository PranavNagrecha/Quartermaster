import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateToolArguments } from '../dist/index.js';

const index = {} as Parameters<typeof validateToolArguments>[0];

test('validateToolArguments passes when schema requires present fields', () => {
  const schema = {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  };
  const ok = validateToolArguments(index, 't.tool', { title: 'x' }, schema);
  assert.equal(ok.ok, true);
});

test('validateToolArguments fails on missing required field', () => {
  const schema = {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  };
  const bad = validateToolArguments(index, 't.tool', {}, schema);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.length > 0);
});

test('validateToolArguments skips empty schema', () => {
  const r = validateToolArguments(index, 't.tool', {}, {});
  assert.equal(r.ok, true);
});
