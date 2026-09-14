import { getPublicStatus, evaluateTreasuryRequest, getJudgeResults, getTraceHealth } from '../src/celo/api.js';
import { buildIdentityRpcRequest, identityEvidenceFromRpc } from '../src/celo/agent-trust.js';
import { CELO_MAINNET } from '../src/celo/config.js';

function runtimeEnv() {
  return {
    CIRCUIT_EXECUTION_MODE: process.env.CIRCUIT_EXECUTION_MODE || 'PREPARE',
    CELO_RPC_URL: process.env.CELO_RPC_URL || CELO_MAINNET.rpcUrl,
    USAT_TOKEN_ADDRESS: process.env.USAT_TOKEN_ADDRESS || undefined,
    CNGN_TOKEN_ADDRESS: process.env.CNGN_TOKEN_ADDRESS || undefined,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL || CELO_MAINNET.x402FacilitatorUrl
  };
}

function routeOf(request) {
  const raw = request?.query?.route;
  if (Array.isArray(raw)) return raw.join('/');
  return String(raw || '').replace(/^\/+|\/+$/g, '');
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

export default async function handler(request, response) {
  response.setHeader?.('Cache-Control', 'no-store');
  const route = routeOf(request);
  const env = runtimeEnv();

  try {
    if (request.method === 'GET' && route === 'status') return response.status(200).json(getPublicStatus(env));
    if (request.method === 'GET' && route === 'judge') return response.status(200).json(getJudgeResults());
    if (request.method === 'GET' && route === 'traces') return response.status(200).json(getTraceHealth());

    if (request.method === 'POST' && route === 'identity') {
      const input = parsedBody(request);
      if (input.agentId == null || input.agentId === '') return response.status(400).json({ error: 'agentId is required' });
      return response.status(200).json(await lookupIdentity(String(input.agentId), env));
    }

    if (request.method === 'POST' && (route === 'evaluate' || route === 'x402-authorize')) {
      const input = parsedBody(request);
      const context = { ...(input.context || {}) };
      if (!context.agentIdentity && input.agentId != null && input.agentId !== '') context.agentIdentity = await lookupIdentity(String(input.agentId), env);
      const intent = route === 'x402-authorize' ? { ...(input.intent || {}), kind: 'X402' } : input.intent;
      return response.status(200).json(evaluateTreasuryRequest({ ...input, intent, context, env }));
    }

    return response.status(404).json({ error: 'Not found', routes: ['GET /api/status','GET /api/judge','GET /api/traces','POST /api/identity','POST /api/evaluate','POST /api/x402-authorize'] });
  } catch (error) {
    return response.status(400).json({ error: error?.message || 'Unexpected CIRCUIT error' });
  }
}
