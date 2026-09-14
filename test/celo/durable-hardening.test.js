import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/index.js';

function responseHarness() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    state,
    setHeader(name, value) { state.headers[name.toLowerCase()] = value; return this; },
    status(code) { state.statusCode = code; return this; },
    json(value) { state.body = value; return this; }
  };
}

test('production durable-state misconfiguration fails closed with stable 503 code', async () => {
  const previous = {
    mode: process.env.CIRCUIT_ACTIVITY_STORE,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY
  };

  process.env.CIRCUIT_ACTIVITY_STORE = 'supabase';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const res = responseHarness();
    await handler({
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
          intentId: 'must-fail-closed',
          sessionId: 'durable-state-down'
        }
      }
    }, res);

    assert.equal(res.state.statusCode, 503);
    assert.equal(res.state.body?.code, 'AUTHORIZATION_STATE_UNAVAILABLE');
    assert.equal(res.state.body?.prepared, undefined);
  } finally {
    if (previous.mode == null) delete process.env.CIRCUIT_ACTIVITY_STORE; else process.env.CIRCUIT_ACTIVITY_STORE = previous.mode;
    if (previous.url == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
