import { getPublicStatus, evaluatePublicTreasuryRequest, getJudgeResults, getTraceHealth } from '../../src/celo/api.js';
import { buildIdentityRpcRequest, identityEvidenceFromRpc } from '../../src/celo/agent-trust.js';
import { createActivityStore, createMemoryActivityStore } from '../../src/celo/activity-store.js';
import { getActivity, getActivityMetrics, recordSubmittedTransaction, sanitizeActivity } from '../../src/celo/metrics.js';
import { reconcileTransactionStatus } from '../../src/celo/receipts.js';
import { CELO_MAINNET } from '../../src/celo/config.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function runtimeEnv() {
  return {
    CIRCUIT_EXECUTION_MODE: Netlify.env.get('CIRCUIT_EXECUTION_MODE') || 'PREPARE',
    // A deployed Netlify function must use durable authorization state by default.
    // Local `netlify dev` can explicitly set CIRCUIT_ACTIVITY_STORE=memory.
    CIRCUIT_ACTIVITY_STORE: Netlify.env.get('CIRCUIT_ACTIVITY_STORE') || 'supabase',
    SUPABASE_URL: Netlify.env.get('SUPABASE_URL') || undefined,
    SUPABASE_SECRET_KEY: Netlify.env.get('SUPABASE_SECRET_KEY') || undefined,
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined,
    CELO_RPC_URL: Netlify.env.get('CELO_RPC_URL') || CELO_MAINNET.rpcUrl,
    USAT_TOKEN_ADDRESS: Netlify.env.get('USAT_TOKEN_ADDRESS') || undefined,
    CNGN_TOKEN_ADDRESS: Netlify.env.get('CNGN_TOKEN_ADDRESS') || undefined,
    X402_FACILITATOR_URL: Netlify.env.get('X402_FACILITATOR_URL') || CELO_MAINNET.x402FacilitatorUrl
  };
}

function authorizationStateError(cause: unknown) {
  const error: any = new Error('Authorization state unavailable');
  error.code = 'AUTHORIZATION_STATE_UNAVAILABLE';
  error.cause = cause;
  return error;
}

function activityStoreFor(env: ReturnType<typeof runtimeEnv>) {
  try {
    if (env.CIRCUIT_ACTIVITY_STORE === 'memory') return createMemoryActivityStore();
    return createActivityStore(env);
  } catch (error) {
    throw authorizationStateError(error);
  }
}

async function body(request: Request) {
  try { return await request.json(); } catch { return {}; }
}

async function lookupIdentity(agentId: string, env: ReturnType<typeof runtimeEnv>) {
  const response = await fetch(env.CELO_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildIdentityRpcRequest(agentId))
  });
  const payload: any = await response.json();
  if (!response.ok || payload.error || !payload.result) {
    return {
      registered: false,
      agentId: String(agentId),
      owner: null,
      standard: 'ERC-8004',
      error: payload.error?.message || `RPC ${response.status}`
    };
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

export default async (request: Request) => {
  const url = new URL(request.url);
  const env = runtimeEnv();

  try {
    if (request.method === 'GET' && url.pathname === '/api/status') return json(getPublicStatus(env));
    if (request.method === 'GET' && url.pathname === '/api/judge') return json(getJudgeResults());
    if (request.method === 'GET' && url.pathname === '/api/traces') return json(getTraceHealth());

    if (request.method === 'GET' && url.pathname === '/api/activity') {
      const sessionId = url.searchParams.get('sessionId') || '';
      const limit = url.searchParams.get('limit') || 50;
      const items = await getActivity({ store: activityStoreFor(env), sessionId, limit });
      return json({ items });
    }

    if (request.method === 'GET' && url.pathname === '/api/metrics') {
      const sessionId = url.searchParams.get('sessionId') || '';
      const metrics = await getActivityMetrics({ store: activityStoreFor(env), sessionId });
      return json(metrics);
    }

    if (request.method === 'POST' && url.pathname === '/api/identity') {
      const input: any = await body(request);
      if (input.agentId == null || input.agentId === '') return json({ error: 'agentId is required' }, 400);
      return json(await lookupIdentity(String(input.agentId), env));
    }

    if (request.method === 'POST' && (url.pathname === '/api/evaluate' || url.pathname === '/api/x402-authorize')) {
      const input: any = await body(request);
      const intent = url.pathname === '/api/x402-authorize' ? { ...(input.intent || {}), kind: 'X402' } : input.intent;
      const agentIdentity = input.agentId != null && input.agentId !== '' ? await lookupIdentity(String(input.agentId), env) : null;
      const result = await evaluatePublicTreasuryRequest({
        intent,
        agentIdentity,
        env,
        activityStore: activityStoreFor(env)
      });
      return json(result);
    }

    if (request.method === 'POST' && url.pathname === '/api/transaction-submitted') {
      const input: any = await body(request);
      const saved = await recordSubmittedTransaction({
        store: activityStoreFor(env),
        sessionId: input.sessionId,
        traceId: input.traceId,
        txHash: input.txHash,
        walletAddress: input.walletAddress
      });
      return json(sanitizeActivity(saved));
    }

    if (request.method === 'POST' && url.pathname === '/api/transaction-status') {
      const input: any = await body(request);
      const result = await reconcileTransactionStatus({
        store: activityStoreFor(env),
        sessionId: input.sessionId,
        traceId: input.traceId,
        rpcUrl: env.CELO_RPC_URL
      });
      return json({
        traceId: result.traceId,
        txHash: result.txHash,
        txStatus: result.txStatus,
        blockNumber: result.blockNumber,
        activity: sanitizeActivity(result.activity)
      });
    }

    return json({ error: 'Not found', routes: publicRoutes() }, 404);
  } catch (error: any) {
    if (error?.code === 'AUTHORIZATION_STATE_UNAVAILABLE') {
      return json({
        error: 'Authorization state unavailable',
        code: 'AUTHORIZATION_STATE_UNAVAILABLE'
      }, 503);
    }
    if (error?.message === 'TRACE_NOT_FOUND') {
      return json({ error: 'Trace not found', code: 'TRACE_NOT_FOUND' }, 404);
    }
    const message = error?.message || 'Unexpected CIRCUIT error';
    if (/Celo RPC|upstream|HTTP 5\d\d/i.test(message)) {
      return json({ error: message, code: 'CELO_RPC_UNAVAILABLE' }, 502);
    }
    return json({ error: message }, 400);
  }
};

export const config = { path: ['/api/*'] };
