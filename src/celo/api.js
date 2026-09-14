import { randomUUID } from 'node:crypto';
import { ASSETS, CELO_MAINNET, ERC8004, getConfiguredAssets } from './config.js';
import { evaluateTreasuryIntent } from './treasury-policy.js';
import { authorizeAndPrepare } from './execution.js';
import { JUDGE_MANDATE, runJudgeScenarios } from './judge-scenarios.js';
import { PUBLIC_MANDATE } from './public-mandate.js';
import { createTreasuryRecorder } from './trace.js';

const recorder = createTreasuryRecorder();

function recorderContext(agentIdentity = null, sessionId = null) {
  const events = recorder.list();
  const today = new Date().toISOString().slice(0, 10);
  const scoped = sessionId ? events.filter((entry) => entry.intent?.sessionId === sessionId) : [];
  const dailySpendUsd = scoped
    .filter((entry) => String(entry.timestamp || '').startsWith(today) && entry.decision?.action === 'ALLOW')
    .reduce((sum, entry) => sum + (Number(entry.intent?.requestedUsd) || 0), 0);
  const recentIntentIds = scoped
    .slice(-200)
    .map((entry) => entry.intent?.intentId)
    .filter(Boolean);
  return Object.freeze({ dailySpendUsd, recentIntentIds, agentIdentity });
}

export function getPublicStatus(env = process.env) {
  const mode = ['SIMULATION', 'PREPARE', 'LIVE'].includes(env.CIRCUIT_EXECUTION_MODE) ? env.CIRCUIT_EXECUTION_MODE : 'PREPARE';
  return Object.freeze({
    name: 'CIRCUIT Treasury',
    thesis: 'Give your agent a budget — not unlimited trust.',
    network: { name: 'Celo Mainnet', chainId: CELO_MAINNET.chainId, caip2: CELO_MAINNET.caip2, rpcUrl: env.CELO_RPC_URL || CELO_MAINNET.rpcUrl, explorerUrl: CELO_MAINNET.explorerUrl },
    executionMode: mode,
    erc8004: { ...ERC8004, publicMode: 'optional-verification' },
    x402: { facilitatorUrl: env.X402_FACILITATOR_URL || CELO_MAINNET.x402FacilitatorUrl, network: CELO_MAINNET.caip2, model: 'policy-gated exact payment' },
    assets: Object.fromEntries(Object.entries(ASSETS).map(([key, value]) => [key, { ...value }])),
    publicMandate: {
      maxPaymentUsd: PUBLIC_MANDATE.maxPaymentUsd,
      maxDailySpendUsd: PUBLIC_MANDATE.maxDailySpendUsd,
      maxX402Usd: PUBLIC_MANDATE.maxX402Usd,
      unknownRecipientReviewUsd: PUBLIC_MANDATE.unknownRecipientReviewUsd,
      assetUnitCaps: PUBLIC_MANDATE.assetUnitCaps,
      requireAgentIdentity: PUBLIC_MANDATE.requireAgentIdentity
    },
    stateModel: 'session-scoped server-side replay and budget evidence',
    controlCore: { module: 'circuit-core', revision: 'fed101ed4675dab240c322eb2318e5ce8564fe65' },
    verdictPrecedence: ['PAUSE', 'BLOCK', 'REVIEW', 'RESIZE', 'ALLOW']
  });
}

export function evaluateTreasuryRequest({ intent, context = {}, mandate = PUBLIC_MANDATE, env = process.env }) {
  const decision = evaluateTreasuryIntent({ mandate, intent, context });
  let prepared = null;
  if (decision.action === 'ALLOW' && intent?.amountBaseUnits != null && intent?.recipient) {
    prepared = authorizeAndPrepare({ decision, intent, config: getConfiguredAssets(env) });
  }
  const trace = recorder.record({
    traceId: randomUUID(),
    timestamp: new Date().toISOString(),
    intent: { ...intent, amountBaseUnits: intent?.amountBaseUnits == null ? undefined : String(intent.amountBaseUnits) },
    decision: { action: decision.action, reasonCodes: decision.reasonCodes },
    prepared: prepared ? { chainId: prepared.chainId, to: prepared.to, asset: prepared.asset, recipient: prepared.recipient, amountBaseUnits: prepared.amountBaseUnits } : null
  });
  return Object.freeze({ decision, prepared, trace: { traceId: trace.traceId, previousHash: trace.previousHash, currentHash: trace.currentHash } });
}

export function evaluatePublicTreasuryRequest({ intent, agentIdentity = null, env = process.env }) {
  return evaluateTreasuryRequest({
    intent,
    context: recorderContext(agentIdentity, intent?.sessionId || null),
    mandate: PUBLIC_MANDATE,
    env
  });
}

export function getJudgeResults() {
  const results = runJudgeScenarios();
  return Object.freeze({ total: results.length, passed: results.filter((entry) => entry.passed).length, results });
}

export function getTraceHealth() {
  const events = recorder.list();
  return Object.freeze({ count: events.length, chain: recorder.verify(), events });
}

export { JUDGE_MANDATE, PUBLIC_MANDATE };
