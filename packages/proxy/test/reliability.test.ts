import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CircuitBreaker, Semaphore } from '../dist/index.js';

test('CircuitBreaker opens after failure threshold', () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetMs: 60_000 });
  cb.recordFailure();
  assert.equal(cb.isOpen(), false);
  cb.recordFailure();
  assert.equal(cb.isOpen(), true);
  cb.recordSuccess();
  assert.equal(cb.isOpen(), false);
});

test('Semaphore limits concurrency', async () => {
  const sem = new Semaphore(1);
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    await sem.acquire();
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active -= 1;
    sem.release();
  };
  await Promise.all([task(), task()]);
  assert.equal(maxActive, 1);
});
