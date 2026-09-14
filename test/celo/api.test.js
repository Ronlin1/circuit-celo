import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPublicStatus,
  evaluateTreasuryRequest,
  evaluatePublicTreasuryRequest
} from '../../src/celo/api.js';
import { createMemoryActivityStore } from '../../src/celo/activity-store.js';

const KNOWN = '0x1111111111111111111111111111111111111111';

function durableRecord(overrides = {}) {
  return {
    traceId: 'persisted-1',
    timestamp: '2026-09-14T09:00:00.000Z',
    sessionId: 'durable-session',
    intentId: 'persisted-intent-1',
    walletAddress: null,
    agentId: null,
    kind: 'TRANSFER',
    asset: 'USAT',
    requestedUsd: 20,
    amountBaseUnits: '20000000',
    decision: 'ALLOW',
    reasonCodes: [],
    recipient: KNOWN,
    tokenContract: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
    txHash: null,
    txStatus: 'PREPARED',
    blockNumber: null,
    previousHash: null,
    currentHash: 'persisted-hash-1',
    attributionTag: null,
    attributionVersion: null,
    ...overrides
  };
}

test('public status exposes Celo primitives without secrets', () => {
  const status = getPublicStatus({ CIRCUIT_EXECUTION_MODE: 'PREPARE' });
  assert.equal(status.network.chainId, 42220);
  assert.equal(status.executionMode, 'PREPARE');
  assert.equal(status.x402.facilitatorUrl, 'https://api.x402.celo.org');
  assert.equal(JSON.stringify(status).includes('privateKey'), false);
});

test('API prepares a transaction only for an ALLOW verdict', () => {
  const response = evaluateTreasuryRequest({
    intent: { chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN, requestedUsd: 5, amountBaseUnits: '5000000', intentId: 'api-1' },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(response.decision.action, 'ALLOW');
  assert.equal(response.prepared.executionMode, 'PREPARE');
});

test('public evaluator pauses an intent already present in the authoritative store', async () => {
  const store = createMemoryActivityStore();
  await store.appendEvaluation(durableRecord({ intentId: 'duplicate-durable', traceId: 'duplicate-trace' }));

  const response = await evaluatePublicTreasuryRequest({
    intent: {
      chainId: 42220,
      kind: 'TRANSFER',
      asset: 'USAT',
      recipient: KNOWN,
      requestedUsd: 5,
      amountBaseUnits: '5000000',
      intentId: 'duplicate-durable',
      sessionId: 'durable-session'
    },
    activityStore: store,
    env: { CIRCUIT_ACTIVITY_STORE: 'memory' }
  });

  assert.equal(response.decision.action, 'PAUSE');
  assert.ok(response.decision.reasonCodes.includes('DUPLICATE_INTENT'));
  assert.equal(response.prepared, null);
});

test('daily budget evidence survives a fresh evaluator when the same durable store is used', async () => {
  const store = createMemoryActivityStore();
  for (let index = 0; index < 5; index += 1) {
    await store.appendEvaluation(durableRecord({
      traceId: `budget-trace-${index}`,
      intentId: `budget-intent-${index}`,
      timestamp: `2026-09-14T0${index + 1}:00:00.000Z`,
      previousHash: index === 0 ? null : `budget-hash-${index - 1}`,
      currentHash: `budget-hash-${index}`
    }));
  }

  const response = await evaluatePublicTreasuryRequest({
    intent: {
      chainId: 42220,
      kind: 'TRANSFER',
      asset: 'USAT',
      recipient: KNOWN,
      requestedUsd: 1,
      amountBaseUnits: '1000000',
      intentId: 'budget-overflow',
      sessionId: 'durable-session'
    },
    activityStore: store,
    env: { CIRCUIT_ACTIVITY_STORE: 'memory' }
  });

  assert.equal(response.decision.action, 'BLOCK');
  assert.ok(response.decision.reasonCodes.includes('DAILY_BUDGET_EXCEEDED'));
  assert.equal(response.prepared, null);
});

test('authoritative state read failure never degrades to ALLOW', async () => {
  const activityStore = {
    async getContext() { throw new Error('database unavailable'); }
  };

  await assert.rejects(
    () => evaluatePublicTreasuryRequest({
      intent: {
        chainId: 42220,
        kind: 'TRANSFER',
        asset: 'USAT',
        recipient: KNOWN,
        requestedUsd: 1,
        amountBaseUnits: '1000000',
        intentId: 'state-down',
        sessionId: 'state-down-session'
      },
      activityStore,
      env: { CIRCUIT_ACTIVITY_STORE: 'supabase' }
    }),
    (error) => error?.code === 'AUTHORIZATION_STATE_UNAVAILABLE'
  );
});
