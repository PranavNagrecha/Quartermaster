import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildToolIndex, closeIndex, forwardCall } from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');

async function echoIndex() {
  return buildToolIndex({
    servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }],
  });
}

test('forwardCall rejects invalid arguments before downstream', async () => {
  const index = await echoIndex();
  try {
    const res = await forwardCall(index, 'echo.create_issue', {});
    assert.equal(res.isError, true);
    assert.match(res.content[0]?.text ?? '', /invalid arguments/);
  } finally {
    await closeIndex(index);
  }
});

test('forwardCall accepts valid arguments', async () => {
  const index = await echoIndex();
  try {
    const res = await forwardCall(index, 'echo.create_issue', { title: 'ok' });
    assert.ok(!res.isError);
  } finally {
    await closeIndex(index);
  }
});
