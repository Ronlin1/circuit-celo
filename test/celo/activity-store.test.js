import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryActivityStore } from '../../src/celo/activity-store.js';

const day = '2026-09-14';

function record(overrides = {}) {
  return {
    traceId: 'trace-1',
    timestamp: `${day}T09:00:00.000Z`,
    sessionId: 'session-a',
    intentId: 'intent-1',
    walletAddress: null,
    agentId: null,
    kind: 'TRANSFER',
    asset: 'USDC',
    requestedUsd: 5,
    amountBaseUnits: '5000000',
    decision: 'ALLOW',
    reasonCodes: [],
    recipient: '0x1111111111111111111111111111111111111111',
    tokenContract: '0x2222222222222222222222222222222222222222',
    txHash: null,
    txStatus: 'PREPARED',
    blockNumber: null,
    previousHash: null,
    currentHash: 'hash-1',
    attributionTag: null,
    attributionVersion: null,
    ...overrides
  };
}

test('context counts only ALLOW spend and scopes recent intent IDs by session', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());
  await store.appendEvaluation(record({ traceId: 'trace-2', intentId: 'intent-2', decision: 'BLOCK', requestedUsd: 50, currentHash: 'hash-2' }));
  await store.appendEvaluation(record({ traceId: 'trace-3', sessionId: 'session-b', intentId: 'intent-3', requestedUsd: 7, currentHash: 'hash-3' }));

  const context = await store.getContext({ sessionId: 'session-a', today: day });
  assert.equal(context.dailySpendUsd, 5);
  assert.deepEqual(context.recentIntentIds, ['intent-1', 'intent-2']);
  assert.equal(context.previousHash, 'hash-2');
});

test('transaction lifecycle updates preserve the original activity record', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());

  await store.recordSubmitted({
    traceId: 'trace-1',
    txHash: `0x${'a'.repeat(64)}`,
    walletAddress: '0x3333333333333333333333333333333333333333'
  });
  await store.recordStatus({ traceId: 'trace-1', txStatus: 'CONFIRMED', blockNumber: 12345 });

  const item = await store.getByTraceId('trace-1');
  assert.equal(item.intentId, 'intent-1');
  assert.equal(item.decision, 'ALLOW');
  assert.equal(item.txStatus, 'CONFIRMED');
  assert.equal(item.blockNumber, 12345);
  assert.equal(item.walletAddress, '0x3333333333333333333333333333333333333333');
});

test('metrics aggregate verdicts and value without treating blocked value as authorized', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());
  await store.appendEvaluation(record({ traceId: 'trace-2', intentId: 'intent-2', decision: 'BLOCK', requestedUsd: 50, currentHash: 'hash-2' }));
  await store.appendEvaluation(record({ traceId: 'trace-3', intentId: 'intent-3', decision: 'REVIEW', requestedUsd: 15, currentHash: 'hash-3' }));
  await store.appendEvaluation(record({ traceId: 'trace-4', intentId: 'intent-4', decision: 'PAUSE', requestedUsd: 5, kind: 'X402', currentHash: 'hash-4' }));
  await store.appendEvaluation(record({ traceId: 'trace-5', intentId: 'intent-5', decision: 'ALLOW', requestedUsd: 1.5, kind: 'X402', currentHash: 'hash-5' }));

  const metrics = await store.getMetrics({ sessionId: 'session-a' });
  assert.deepEqual(metrics.counts, { ALLOW: 2, BLOCK: 1, REVIEW: 1, PAUSE: 1 });
  assert.equal(metrics.totalAuthorizedUsd, 6.5);
  assert.equal(metrics.protectedOrReviewedUsd, 70);
  assert.equal(metrics.x402AuthorizedUsd, 1.5);
});

test('list is newest-first, session scoped, and clamps limits to 200', async () => {
  const store = createMemoryActivityStore();
  await Promise.all(Array.from({ length: 205 }, (_, index) => store.appendEvaluation(record({
    traceId: `trace-${index}`,
    intentId: `intent-${index}`,
    timestamp: `${day}T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
    currentHash: `hash-${index}`
  }))));
  await store.appendEvaluation(record({ traceId: 'other', sessionId: 'session-b', intentId: 'other', currentHash: 'other-hash' }));

  const items = await store.list({ sessionId: 'session-a', limit: 999 });
  assert.equal(items.length, 200);
  assert.ok(items.every((item) => item.sessionId === 'session-a'));
});
