import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../../api/index.js';

const apiSource = readFileSync(new URL('../../api/index.js', import.meta.url), 'utf8');

function responseHarness() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    state,
    setHeader(name, value) { state.headers[name.toLowerCase()] = value; return this; },
    status(code) { state.statusCode = code; return this; },
    json(value) { state.body = value; return this; }
  };
}

function saveEnvironment() {
  return {
    mode: process.env.CIRCUIT_ACTIVITY_STORE,
    url: process.env.SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV
  };
}

function restoreEnvironment(previous) {
  if (previous.mode == null) delete process.env.CIRCUIT_ACTIVITY_STORE; else process.env.CIRCUIT_ACTIVITY_STORE = previous.mode;
  if (previous.url == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
  if (previous.secretKey == null) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.secretKey;
  if (previous.key == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  if (previous.vercelEnv == null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous.vercelEnv;
  if (previous.nodeEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
}

function evaluationRequest(intentId, sessionId) {
  return {
    method: 'POST',
    query: { route: 'evaluate' },
    body: {
      intent: {
        chainId: 42220,
        kind: 'TRANSFER',
        asset: 'USAT',
        recipient: '0x1111111111111111111111111111111111111111',
        requestedUsd: 1,
        amountBaseUnits: '1000000',
        intentId,
        sessionId
      }
    }
  };
}

test('Vercel adapter forwards the modern Supabase secret key into the server-only runtime environment', () => {
  assert.match(apiSource, /SUPABASE_SECRET_KEY:\s*process\.env\.SUPABASE_SECRET_KEY\s*\|\|\s*undefined/);
});

test('production durable-state misconfiguration fails closed with stable 503 code', async () => {
  const previous = saveEnvironment();
  process.env.CIRCUIT_ACTIVITY_STORE = 'supabase';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const res = responseHarness();
    await handler(evaluationRequest('must-fail-closed', 'durable-state-down'), res);

    assert.equal(res.state.statusCode, 503);
    assert.equal(res.state.body?.code, 'AUTHORIZATION_STATE_UNAVAILABLE');
    assert.equal(res.state.body?.prepared, undefined);
  } finally {
    restoreEnvironment(previous);
  }
});

test('Vercel production defaults to durable state and never silently falls back to memory', async () => {
  const previous = saveEnvironment();
  delete process.env.CIRCUIT_ACTIVITY_STORE;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.VERCEL_ENV = 'production';

  try {
    const res = responseHarness();
    await handler(evaluationRequest('production-must-be-durable', 'production-no-memory-fallback'), res);

    assert.equal(res.state.statusCode, 503);
    assert.equal(res.state.body?.code, 'AUTHORIZATION_STATE_UNAVAILABLE');
    assert.equal(res.state.body?.prepared, undefined);
  } finally {
    restoreEnvironment(previous);
  }
});
