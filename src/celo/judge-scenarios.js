import { evaluateTreasuryIntent } from './treasury-policy.js';

const KNOWN = '0x1111111111111111111111111111111111111111';
const UNKNOWN = '0x2222222222222222222222222222222222222222';

export const JUDGE_MANDATE = Object.freeze({
  status: 'ACTIVE',
  chainId: 42220,
  allowedAssets: Object.freeze(['USAT', 'cNGN', 'USDC', 'USDT', 'USDm']),
  maxPaymentUsd: 20,
  maxDailySpendUsd: 100,
  maxX402Usd: 2,
  unknownRecipientReviewUsd: 10,
  knownRecipients: Object.freeze([KNOWN]),
  requireAgentIdentity: true
});

const identity = Object.freeze({ registered: true, agentId: '42', standard: 'ERC-8004' });
const baseContext = Object.freeze({ dailySpendUsd: 0, agentIdentity: identity, recentIntentIds: Object.freeze([]) });
const intent = (overrides = {}) => ({ chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN, requestedUsd: 5, intentId: 'judge-safe', ...overrides });

export const JUDGE_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'safe-payment', title: 'Safe USA₮ payment', expected: 'ALLOW', intent: intent() }),
  Object.freeze({ id: 'oversize', title: 'Oversize payment', expected: 'BLOCK', intent: intent({ requestedUsd: 50, intentId: 'judge-oversize' }) }),
  Object.freeze({ id: 'duplicate', title: 'Duplicate retry', expected: 'PAUSE', intent: intent({ intentId: 'judge-duplicate' }), context: { ...baseContext, recentIntentIds: ['judge-duplicate'] } }),
  Object.freeze({ id: 'unknown-recipient', title: 'Unknown recipient above threshold', expected: 'REVIEW', intent: intent({ recipient: UNKNOWN, requestedUsd: 15, intentId: 'judge-review' }) }),
  Object.freeze({ id: 'x402-safe', title: 'x402 API purchase within cap', expected: 'ALLOW', intent: intent({ kind: 'X402', requestedUsd: 0.1, intentId: 'judge-x402-safe' }) }),
  Object.freeze({ id: 'x402-expensive', title: 'x402 price exceeds cap', expected: 'BLOCK', intent: intent({ kind: 'X402', requestedUsd: 3, intentId: 'judge-x402-expensive' }) }),
  Object.freeze({ id: 'unregistered-agent', title: 'Missing ERC-8004 identity', expected: 'BLOCK', intent: intent({ intentId: 'judge-no-identity' }), context: { ...baseContext, agentIdentity: null } }),
  Object.freeze({ id: 'prompt-injection', title: 'Prompt injection tries to rewrite budget', expected: 'BLOCK', intent: intent({ intentId: 'judge-injection', policyOverrideRequested: true }) })
]);

export function runJudgeScenarios() {
  return JUDGE_SCENARIOS.map((scenario) => {
    const decision = evaluateTreasuryIntent({ mandate: JUDGE_MANDATE, intent: scenario.intent, context: scenario.context ?? baseContext });
    return Object.freeze({ id: scenario.id, title: scenario.title, expected: scenario.expected, actual: decision.action, reasonCodes: decision.reasonCodes, passed: decision.action === scenario.expected });
  });
}
