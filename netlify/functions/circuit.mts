import { getPublicStatus, evaluatePublicTreasuryRequest, getJudgeResults, getTraceHealth } from '../../src/celo/api.js';
import { buildIdentityRpcRequest, identityEvidenceFromRpc } from '../../src/celo/agent-trust.js';
import { CELO_MAINNET } from '../../src/celo/config.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function runtimeEnv() {
  return {
    CIRCUIT_EXECUTION_MODE: Netlify.env.get('CIRCUIT_EXECUTION_MODE') || 'PREPARE',
    CELO_RPC_URL: Netlify.env.get('CELO_RPC_URL') || CELO_MAINNET.rpcUrl,
    USAT_TOKEN_ADDRESS: Netlify.env.get('USAT_TOKEN_ADDRESS') || undefined,
    CNGN_TOKEN_ADDRESS: Netlify.env.get('CNGN_TOKEN_ADDRESS') || undefined,
    X402_FACILITATOR_URL: Netlify.env.get('X402_FACILITATOR_URL') || CELO_MAINNET.x402FacilitatorUrl
  };
}

async function body(request: Request) {
  try { return await request.json(); } catch { return {}; }
}

async function lookupIdentity(agentId: string, env: ReturnType<typeof runtimeEnv>) {
  const response = await fetch(env.CELO_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildIdentityRpcRequest(agentId)) });
  const payload: any = await response.json();
  if (!response.ok || payload.error || !payload.result) return { registered: false, agentId: String(agentId), owner: null, standard: 'ERC-8004', error: payload.error?.message || `RPC ${response.status}` };
  return identityEvidenceFromRpc({ agentId, result: payload.result });
}

export default async (request: Request) => {
  const url = new URL(request.url);
  const env = runtimeEnv();
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') return json(getPublicStatus(env));
    if (request.method === 'GET' && url.pathname === '/api/judge') return json(getJudgeResults());
    if (request.method === 'GET' && url.pathname === '/api/traces') return json(getTraceHealth());
    if (request.method === 'POST' && url.pathname === '/api/identity') {
      const input: any = await body(request);
      if (input.agentId == null || input.agentId === '') return json({ error: 'agentId is required' }, 400);
      return json(await lookupIdentity(String(input.agentId), env));
    }
    if (request.method === 'POST' && (url.pathname === '/api/evaluate' || url.pathname === '/api/x402-authorize')) {
      const input: any = await body(request);
      const intent = url.pathname === '/api/x402-authorize' ? { ...(input.intent || {}), kind: 'X402' } : input.intent;
      const agentIdentity = input.agentId != null && input.agentId !== '' ? await lookupIdentity(String(input.agentId), env) : null;
      return json(evaluatePublicTreasuryRequest({ intent, agentIdentity, env }));
    }
    return json({ error: 'Not found', routes: ['GET /api/status','GET /api/judge','GET /api/traces','POST /api/identity','POST /api/evaluate','POST /api/x402-authorize'] }, 404);
  } catch (error: any) {
    return json({ error: error?.message || 'Unexpected CIRCUIT error' }, 400);
  }
};

export const config = { path: ['/api/*'] };
