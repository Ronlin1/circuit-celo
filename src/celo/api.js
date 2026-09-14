import { randomUUID } from 'node:crypto';
import { ASSETS, CELO_MAINNET, ERC8004, getConfiguredAssets } from './config.js';
import { evaluateTreasuryIntent } from './treasury-policy.js';
import { authorizeAndPrepare } from './execution.js';
import { JUDGE_MANDATE, runJudgeScenarios } from './judge-scenarios.js';
import { PUBLIC_MANDATE } from './public-mandate.js';
import { createActivityStore } from './activity-store.js';
import { buildTreasuryTrace, createTreasuryRecorder } from './trace.js';

const recorder = createTreasuryRecorder();

function decisionAndPreparation({ intent, context = {}, mandate = PUBLIC_MANDATE, env = process.env }) {
  const decision = evaluateTreasuryIntent({ mandate, intent, context });
  let prepared = null;
  if (decision.action === 'ALLOW' && intent?.amountBaseUnits != null && intent?.recipient) {
    prepared = authorizeAndPrepare({ decision, intent, config: getConfiguredAssets(env) });
  }
  return { decision, prepared };
}

function activityStatus(decision, prepared) {
  if (prepared) return 'PREPARED';
  if (decision.action === 'BLOCK') return 'BLOCKED';
  if (decision.action === 'REVIEW') return 'REVIEW';
  if (decision.action === 'PAUSE') return 'PAUSED';
  return 'EVALUATED';
}

function authorizationStateError(cause) {
  const error = new Error('Authorization state unavailable');
  error.code = 'AUTHORIZATION_STATE_UNAVAILABLE';
  error.cause = cause;
  return error;
}

function duplicateDecision(intent, context, agentIdentity) {
  const recentIntentIds = Array.from(new Set([...(context?.recentIntentIds || []), intent?.intentId].filter(Boolean)));
  return decisionAndPreparation({
    intent,
    context: { ...context, recentIntentIds, agentIdentity },
    mandate: PUBLIC_MANDATE
  });
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
    stateModel: env.CIRCUIT_ACTIVITY_STORE === 'supabase'
      ? 'durable session-scoped replay, budget, and trace evidence'
      : 'session-scoped development replay and budget evidence',
    controlCore: { module: 'circuit-core', revision: 'fed101ed4675dab240c322eb2318e5ce8564fe65' },
    verdictPrecedence: ['PAUSE', 'BLOCK', 'REVIEW', 'RESIZE', 'ALLOW']
  });
}

export function evaluateTreasuryRequest({ intent, context = {}, mandate = PUBLIC_MANDATE, env = process.env }) {
  const { decision, prepared } = decisionAndPreparation({ intent, context, mandate, env });
  const trace = recorder.record({
    traceId: randomUUID(),
    timestamp: new Date().toISOString(),
    intent: { ...intent, amountBaseUnits: intent?.amountBaseUnits == null ? undefined : String(intent.amountBaseUnits) },
    decision: { action: decision.action, reasonCodes: decision.reasonCodes },
    prepared: prepared ? { chainId: prepared.chainId, to: prepared.to, asset: prepared.asset, recipient: prepared.recipient, amountBaseUnits: prepared.amountBaseUnits } : null
  });
  return Object.freeze({ decision, prepared, trace: { traceId: trace.traceId, previousHash: trace.previousHash, currentHash: trace.currentHash } });
}

export async function evaluatePublicTreasuryRequest({ intent, agentIdentity = null, env = process.env, activityStore = null }) {
  let store;
  try {
    store = activityStore || createActivityStore(env);
  } catch (error) {
    throw authorizationStateError(error);
  }

  const sessionId = String(intent?.sessionId || 'public-anonymous');
  const today = new Date().toISOString().slice(0, 10);
  let durableContext;
  try {
    durableContext = await store.getContext({ sessionId, today });
  } catch (error) {
    throw authorizationStateError(error);
  }

  const context = Object.freeze({
    dailySpendUsd: Number(durableContext?.dailySpendUsd ?? 0),
    recentIntentIds: Array.isArray(durableContext?.recentIntentIds) ? durableContext.recentIntentIds : [],
    agentIdentity
  });

  const { decision, prepared } = decisionAndPreparation({ intent, context, mandate: PUBLIC_MANDATE, env });

  if (decision.action === 'PAUSE' && decision.reasonCodes.includes('DUPLICATE_INTENT')) {
    return Object.freeze({ decision, prepared: null, trace: null });
  }

  const traceId = randomUUID();
  const timestamp = new Date().toISOString();
  const trace = buildTreasuryTrace({
    traceId,
    timestamp,
    intent: { ...intent, sessionId, amountBaseUnits: intent?.amountBaseUnits == null ? undefined : String(intent.amountBaseUnits) },
    decision: { action: decision.action, reasonCodes: decision.reasonCodes },
    prepared: prepared ? { chainId: prepared.chainId, to: prepared.to, asset: prepared.asset, recipient: prepared.recipient, amountBaseUnits: prepared.amountBaseUnits } : null
  }, durableContext?.previousHash ?? null);

  const record = {
    traceId,
    timestamp,
    sessionId,
    intentId: intent?.intentId,
    walletAddress: null,
    agentId: agentIdentity?.agentId ?? null,
    kind: intent?.kind || 'TRANSFER',
    asset: intent?.asset,
    requestedUsd: Number(intent?.requestedUsd) || 0,
    amountBaseUnits: intent?.amountBaseUnits == null ? null : String(intent.amountBaseUnits),
    decision: decision.action,
    reasonCodes: decision.reasonCodes,
    recipient: intent?.recipient ?? null,
    tokenContract: prepared?.to ?? null,
    txHash: null,
    txStatus: activityStatus(decision, prepared),
    blockNumber: null,
    previousHash: trace.previousHash,
    currentHash: trace.currentHash,
    attributionTag: prepared?.attributionTag ?? null,
    attributionVersion: prepared?.attributionVersion ?? null
  };

  try {
    await store.appendEvaluation(record);
  } catch (error) {
    if (error?.message === 'DUPLICATE_INTENT') {
      const duplicate = duplicateDecision(intent, context, agentIdentity);
      return Object.freeze({ decision: duplicate.decision, prepared: null, trace: null });
    }
    throw authorizationStateError(error);
  }

  return Object.freeze({
    decision,
    prepared,
    trace: { traceId: trace.traceId, previousHash: trace.previousHash, currentHash: trace.currentHash }
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
