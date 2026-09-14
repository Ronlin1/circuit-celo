import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTreasuryIntent } from '../../src/celo/treasury-policy.js';

const mandate = {
  status: 'ACTIVE', chainId: 42220, allowedAssets: ['USAT','cNGN','USDC','USDT','USDm'],
  maxPaymentUsd: 20, maxDailySpendUsd: 100, maxX402Usd: 2,
  unknownRecipientReviewUsd: 10, knownRecipients: ['0x1111111111111111111111111111111111111111'],
  requireAgentIdentity: true
};
const base = { chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: '0x1111111111111111111111111111111111111111', requestedUsd: 5, intentId: 'safe-1' };
const context = { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '8004:42' }, recentIntentIds: [] };

test('allows safe Celo stablecoin intent', () => assert.equal(evaluateTreasuryIntent({ mandate, intent: base, context }).action, 'ALLOW'));
test('blocks oversize payment', () => {
  const decision = evaluateTreasuryIntent({ mandate, intent: { ...base, requestedUsd: 50 }, context });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('PAYMENT_CAP_EXCEEDED'));
});
test('reviews unknown recipient over threshold', () => {
  const decision = evaluateTreasuryIntent({ mandate, intent: { ...base, recipient: '0x2222222222222222222222222222222222222222', requestedUsd: 15 }, context });
  assert.equal(decision.action, 'REVIEW');
  assert.ok(decision.reasonCodes.includes('UNKNOWN_RECIPIENT_REVIEW'));
});
test('blocks x402 above mandate cap', () => {
  const decision = evaluateTreasuryIntent({ mandate, intent: { ...base, kind: 'X402', requestedUsd: 3 }, context });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('X402_PRICE_CAP_EXCEEDED'));
});
test('blocks when ERC-8004 identity is required but absent', () => {
  const decision = evaluateTreasuryIntent({ mandate, intent: base, context: { ...context, agentIdentity: null } });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('AGENT_IDENTITY_REQUIRED'));
});
test('pauses semantic duplicate before money can move twice', () => {
  const decision = evaluateTreasuryIntent({ mandate, intent: base, context: { ...context, recentIntentIds: ['safe-1'] } });
  assert.equal(decision.action, 'PAUSE');
  assert.ok(decision.reasonCodes.includes('DUPLICATE_INTENT'));
});
