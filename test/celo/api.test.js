import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicStatus, evaluateTreasuryRequest } from '../../src/celo/api.js';

test('public status exposes Celo primitives without secrets', () => {
  const status = getPublicStatus({ CIRCUIT_EXECUTION_MODE: 'PREPARE' });
  assert.equal(status.network.chainId, 42220);
  assert.equal(status.executionMode, 'PREPARE');
  assert.equal(status.x402.facilitatorUrl, 'https://api.x402.celo.org');
  assert.equal(JSON.stringify(status).includes('privateKey'), false);
});

test('API prepares a transaction only for an ALLOW verdict', () => {
  const response = evaluateTreasuryRequest({
    intent: { chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: '0x1111111111111111111111111111111111111111', requestedUsd: 5, amountBaseUnits: '5000000', intentId: 'api-1' },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(response.decision.action, 'ALLOW');
  assert.equal(response.prepared.executionMode, 'PREPARE');
});
