import { getPublicStatus, evaluateTreasuryRequest, getJudgeResults, getTraceHealth } from '../../src/celo/api.js';
import { buildIdentityRpcRequest, identityEvidenceFromRpc } from '../../src/celo/agent-trust.js';
import { CELO_MAINNET } from '../../src/celo/config.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
});

async function body(request: Request) {
  try { return await request.json(); } catch { return {}; }
}

async function lookupIdentity(agentId: string) {
  const rpcUrl = process.env.CELO_RPC_URL || CELO_MAINNET.rpcUrl;
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildIdentityRpcRequest(agentId)) });
  const payload: any = await response.json();
  if (!response.ok || payload.error || !payload.result) return { registered: false, agentId: String(agentId), owner: null, standard: 'ERC-8004', error: payload.error?.message || `RPC ${response.status}` };
  return identityEvidenceFromRpc({ agentId, result: payload.result });
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' } });
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') return json(getPublicStatus(process.env));
    if (request.method === 'GET' && url.pathname === '/api/judge') return json(getJudgeResults());
    if (request.method === 'GET' && url.pathname === '/api/traces') return json(getTraceHealth());
    if (request.method === 'POST' && url.pathname === '/api/identity') {
      const input: any = await body(request);
      if (input.agentId == null || input.agentId === '') return json({ error: 'agentId is required' }, 400);
      return json(await lookupIdentity(String(input.agentId)));
    }
    if (request.method === 'POST' && (url.pathname === '/api/evaluate' || url.pathname === '/api/x402-authorize')) {
      const input: any = await body(request);
      const context = { ...(input.context || {}) };
      if (!context.agentIdentity && input.agentId != null && input.agentId !== '') context.agentIdentity = await lookupIdentity(String(input.agentId));
      const intent = url.pathname === '/api/x402-authorize' ? { ...(input.intent || {}), kind: 'X402' } : input.intent;
      return json(evaluateTreasuryRequest({ ...input, intent, context, env: process.env }));
    }
    return json({ error: 'Not found', routes: ['GET /api/status','GET /api/judge','GET /api/traces','POST /api/identity','POST /api/evaluate','POST /api/x402-authorize'] }, 404);
  } catch (error: any) {
    return json({ error: error?.message || 'Unexpected CIRCUIT error' }, 400);
  }
};

export const config = { path: ['/api/*'] };
