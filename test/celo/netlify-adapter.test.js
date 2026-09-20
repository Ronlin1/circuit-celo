import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const env = new Map([
  ['CIRCUIT_ACTIVITY_STORE', 'memory'],
  ['CIRCUIT_EXECUTION_MODE', 'PREPARE'],
  ['CELO_RPC_URL', 'https://forno.celo.org']
]);

globalThis.Netlify = {
  env: {
    get(name) { return env.get(name); }
  }
};

const { default: handler } = await import('../../netlify/functions/circuit.mts');

function safeIntent(overrides = {}) {
  return {
    chainId: 42220,
    kind: 'TRANSFER',
    asset: 'USAT',
    recipient: '0x1111111111111111111111111111111111111111',
    requestedUsd: 1,
    amountBaseUnits: '1000000',
    intentId: `netlify-${Date.now()}-${Math.random()}`,
    sessionId: 'netlify-adapter-session',
    ...overrides
  };
}

test('Netlify adapter serves status and Judge Mode', async () => {
  const status = await handler(new Request('https://example.net/api/status'));
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.chainId, 42220);

  const judge = await handler(new Request('https://example.net/api/judge'));
  assert.equal(judge.status, 200);
  const judgeBody = await judge.json();
  assert.equal(judgeBody.summary?.passed, 8);
  assert.equal(judgeBody.summary?.total, 8);
});

test('Netlify adapter persists evaluate -> activity -> metrics through one store', async () => {
  const intent = safeIntent();
  const evaluation = await handler(new Request('https://example.net/api/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent })
  }));
  assert.equal(evaluation.status, 200);
  const result = await evaluation.json();
  assert.equal(result.decision?.verdict, 'ALLOW');
  assert.ok(result.trace?.traceId);

  const activity = await handler(new Request(`https://example.net/api/activity?sessionId=${encodeURIComponent(intent.sessionId)}`));
  assert.equal(activity.status, 200);
  const activityBody = await activity.json();
  assert.ok(Array.isArray(activityBody.items));
  assert.ok(activityBody.items.some((item) => item.traceId === result.trace.traceId));

  const metrics = await handler(new Request(`https://example.net/api/metrics?sessionId=${encodeURIComponent(intent.sessionId)}`));
  assert.equal(metrics.status, 200);
  const metricsBody = await metrics.json();
  assert.ok(metricsBody.counts.ALLOW >= 1);
});

test('Netlify adapter source wires durable state, modern secret key and transaction lifecycle routes', async () => {
  const source = await readFile(new URL('../../netlify/functions/circuit.mts', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /createActivityStore/);
  assert.match(source, /\/api\/activity/);
  assert.match(source, /\/api\/metrics/);
  assert.match(source, /\/api\/transaction-submitted/);
  assert.match(source, /\/api\/transaction-status/);
});
