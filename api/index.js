import { getPublicStatus, evaluatePublicTreasuryRequest, getJudgeResults, getTraceHealth } from '../src/celo/api.js';
import { buildIdentityRpcRequest, identityEvidenceFromRpc } from '../src/celo/agent-trust.js';
import { createActivityStore, createMemoryActivityStore } from '../src/celo/activity-store.js';
import { getActivity, getActivityMetrics, recordSubmittedTransaction, sanitizeActivity } from '../src/celo/metrics.js';
import { reconcileTransactionStatus } from '../src/celo/receipts.js';
import { CELO_MAINNET } from '../src/celo/config.js';

const developmentMemoryStore = createMemoryActivityStore();

function runtimeEnv() {
  return {
    CIRCUIT_EXECUTION_MODE: process.env.CIRCUIT_EXECUTION_MODE || 'PREPARE',
    CIRCUIT_ACTIVITY_STORE: process.env.CIRCUIT_ACTIVITY_STORE || 'memory',
    SUPABASE_URL: process.env.SUPABASE_URL || undefined,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    CELO_RPC_URL: process.env.CELO_RPC_URL || CELO_MAINNET.rpcUrl,
    USAT_TOKEN_ADDRESS: process.env.USAT_TOKEN_ADDRESS || undefined,
    CNGN_TOKEN_ADDRESS: process.env.CNGN_TOKEN_ADDRESS || undefined,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL || CELO_MAINNET.x402FacilitatorUrl
  };
}

function authorizationStateError(cause) {
  const error = new Error('Authorization state unavailable');
  error.code = 'AUTHORIZATION_STATE_UNAVAILABLE';
  error.cause = cause;
  return error;
}

function activityStoreFor(env) {
  if (env.CIRCUIT_ACTIVITY_STORE !== 'supabase') return developmentMemoryStore;
  try {
    return createActivityStore(env);
  } catch (error) {
    throw authorizationStateError(error);
  }
}

function routeOf(request) {
  const raw = request?.query?.route;
  if (Array.isArray(raw)) return raw.join('/');
  return String(raw || '').replace(/^\/+|\/+$/g, '');
}

function queryValue(request, name) {
  const raw = request?.query?.[name];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw == null ? '' : String(raw);
}

function parsedBody(request) {
  if (request?.body == null) return {};
  if (typeof request.body === 'string') {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

async function lookupIdentity(agentId, env) {
  const response = await fetch(env.CELO_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildIdentityRpcRequest(agentId))
  });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.result) {
    return { registered: false, agentId: String(agentId), owner: null, standard: 'ERC-8004', error: payload.error?.message || `RPC ${response.status}` };
  }
  return identityEvidenceFromRpc({ agentId, result: payload.result });
}

function publicRoutes() {
  return [
    'GET /api/status',
    'GET /api/judge',
    'GET /api/traces',
    'GET /api/activity?sessionId=...',
    'GET /api/metrics?sessionId=...',
    'POST /api/identity',
    'POST /api/evaluate',
    'POST /api/x402-authorize',
    'POST /api/transaction-submitted',
    'POST /api/transaction-status'
  ];
}

export default async function handler(request, response) {
  response.setHeader?.('Cache-Control', 'no-store');
  const route = routeOf(request);
  const env = runtimeEnv();

  try {
    if (request.method === 'GET' && route === 'status') return response.status(200).json(getPublicStatus(env));
    if (request.method === 'GET' && route === 'judge') return response.status(200).json(getJudgeResults());
    if (request.method === 'GET' && route === 'traces') return response.status(200).json(getTraceHealth());

    if (request.method === 'GET' && route === 'activity') {
      const sessionId = queryValue(request, 'sessionId');
      const limit = queryValue(request, 'limit') || 50;
      const items = await getActivity({ store: activityStoreFor(env), sessionId, limit });
      return response.status(200).json({ items });
    }

    if (request.method === 'GET' && route === 'metrics') {
      const sessionId = queryValue(request, 'sessionId');
      const metrics = await getActivityMetrics({ store: activityStoreFor(env), sessionId });
      return response.status(200).json(metrics);
    }

    if (request.method === 'POST' && route === 'identity') {
      const input = parsedBody(request);
      if (input.agentId == null || input.agentId === '') return response.status(400).json({ error: 'agentId is required' });
      return response.status(200).json(await lookupIdentity(String(input.agentId), env));
    }

    if (request.method === 'POST' && (route === 'evaluate' || route === 'x402-authorize')) {
      const input = parsedBody(request);
      const intent = route === 'x402-authorize' ? { ...(input.intent || {}), kind: 'X402' } : input.intent;
      const agentIdentity = input.agentId != null && input.agentId !== '' ? await lookupIdentity(String(input.agentId), env) : null;
      const activityStore = activityStoreFor(env);
      const result = await evaluatePublicTreasuryRequest({ intent, agentIdentity, env, activityStore });
      return response.status(200).json(result);
    }

    if (request.method === 'POST' && route === 'transaction-submitted') {
      const input = parsedBody(request);
      const saved = await recordSubmittedTransaction({
        store: activityStoreFor(env),
        sessionId: input.sessionId,
        traceId: input.traceId,
        txHash: input.txHash,
        walletAddress: input.walletAddress
      });
      return response.status(200).json(sanitizeActivity(saved));
    }

    if (request.method === 'POST' && route === 'transaction-status') {
      const input = parsedBody(request);
      const result = await reconcileTransactionStatus({
        store: activityStoreFor(env),
        sessionId: input.sessionId,
        traceId: input.traceId,
        rpcUrl: env.CELO_RPC_URL
      });
      return response.status(200).json({
        traceId: result.traceId,
        txHash: result.txHash,
        txStatus: result.txStatus,
        blockNumber: result.blockNumber,
        activity: sanitizeActivity(result.activity)
      });
    }

    return response.status(404).json({ error: 'Not found', routes: publicRoutes() });
  } catch (error) {
    if (error?.code === 'AUTHORIZATION_STATE_UNAVAILABLE') {
      return response.status(503).json({
        error: 'Authorization state unavailable',
        code: 'AUTHORIZATION_STATE_UNAVAILABLE'
      });
    }
    if (error?.message === 'TRACE_NOT_FOUND') {
      return response.status(404).json({ error: 'Trace not found', code: 'TRACE_NOT_FOUND' });
    }
    const message = error?.message || 'Unexpected CIRCUIT error';
    if (/Celo RPC|upstream|HTTP 5\d\d/i.test(message)) {
      return response.status(502).json({ error: message, code: 'CELO_RPC_UNAVAILABLE' });
    }
    return response.status(400).json({ error: message });
  }
}
