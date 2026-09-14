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

test('Vercel adapter serves CIRCUIT public status', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { route: 'status' }, body: null }, res);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.name, 'CIRCUIT Treasury');
  assert.equal(res.state.body.network.chainId, 42220);
});

test('Vercel adapter serves 8/8 Judge Mode', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { route: 'judge' }, body: null }, res);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.total, 8);
  assert.equal(res.state.body.passed, 8);
});

test('Vercel adapter prepares only an allowed transaction', async () => {
  const res = responseHarness();
  await handler({
    method: 'POST',
    query: { route: 'evaluate' },
    body: {
      intent: { chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: '0x1111111111111111111111111111111111111111', requestedUsd: 5, amountBaseUnits: '5000000', intentId: 'vercel-1' },
      context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
    }
  }, res);
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.body.decision.action, 'ALLOW');
  assert.equal(res.state.body.prepared.executionMode, 'PREPARE');
});
