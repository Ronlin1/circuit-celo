import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryActivityStore } from '../../src/celo/activity-store.js';
import {
  getActivity,
  getActivityMetrics,
  recordSubmittedTransaction
} from '../../src/celo/metrics.js';

const SESSION = 'activity-session';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const WALLET = '0x3333333333333333333333333333333333333333';
const TX = `0x${'a'.repeat(64)}`;

function record(overrides = {}) {
  return {
    traceId: 'trace-1',
    timestamp: '2026-09-14T09:00:00.000Z',
    sessionId: SESSION,
    intentId: 'intent-1',
    walletAddress: null,
    agentId: null,
    kind: 'TRANSFER',
    asset: 'USDC',
    requestedUsd: 5,
    amountBaseUnits: '5000000',
    decision: 'ALLOW',
    reasonCodes: [],
    recipient: RECIPIENT,
    tokenContract: '0x2222222222222222222222222222222222222222',
    txHash: null,
    txStatus: 'PREPARED',
    blockNumber: null,
    previousHash: 'GENESIS',
    currentHash: 'hash-1',
    attributionTag: null,
    attributionVersion: null,
    ...overrides
  };
}

test('activity history requires a session and returns masked session-safe rows', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());

  await assert.rejects(() => getActivity({ store, sessionId: '' }), /sessionId is required/);
  const items = await getActivity({ store, sessionId: SESSION, limit: 999 });
  assert.equal(items.length, 1);
  assert.equal(items[0].traceId, 'trace-1');
  assert.equal(items[0].sessionId, undefined);
  assert.equal(items[0].recipient, '0x1111…1111');
  assert.equal(items[0].txStatus, 'PREPARED');
});

test('activity metrics expose real verdict/value totals only for the requested session', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());
  await store.appendEvaluation(record({ traceId: 'trace-2', intentId: 'intent-2', decision: 'BLOCK', requestedUsd: 50, txStatus: 'BLOCKED', currentHash: 'hash-2' }));
  await store.appendEvaluation(record({ traceId: 'trace-other', sessionId: 'other-session', intentId: 'other', requestedUsd: 99, currentHash: 'other-hash' }));

  const metrics = await getActivityMetrics({ store, sessionId: SESSION });
  assert.deepEqual(metrics.counts, { ALLOW: 1, BLOCK: 1, REVIEW: 0, PAUSE: 0 });
  assert.equal(metrics.totalAuthorizedUsd, 5);
  assert.equal(metrics.protectedOrReviewedUsd, 50);
  assert.equal(metrics.intentsEvaluated, 2);
});

test('submitted transaction recording validates tx hash, wallet, and ALLOW trace state', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record());

  await assert.rejects(
    () => recordSubmittedTransaction({ store, sessionId: SESSION, traceId: 'trace-1', txHash: '0xBAD', walletAddress: WALLET }),
    /transaction hash/i
  );
  await assert.rejects(
    () => recordSubmittedTransaction({ store, sessionId: SESSION, traceId: 'trace-1', txHash: TX, walletAddress: 'bad-wallet' }),
    /wallet address/i
  );

  const saved = await recordSubmittedTransaction({ store, sessionId: SESSION, traceId: 'trace-1', txHash: TX, walletAddress: WALLET });
  assert.equal(saved.txStatus, 'SUBMITTED');
  assert.equal(saved.txHash, TX);
  assert.equal(saved.walletAddress, WALLET);
});

test('non-ALLOW trace cannot be marked as submitted', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(record({ decision: 'BLOCK', txStatus: 'BLOCKED' }));

  await assert.rejects(
    () => recordSubmittedTransaction({ store, sessionId: SESSION, traceId: 'trace-1', txHash: TX, walletAddress: WALLET }),
    /trace is not executable/i
  );
});
