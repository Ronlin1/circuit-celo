import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/index.js';

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const WALLET = '0x3333333333333333333333333333333333333333';
const TX = `0x${'a'.repeat(64)}`;

function responseHarness() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    state,
    setHeader(name, value) { state.headers[name.toLowerCase()] = value; return this; },
    status(code) { state.statusCode = code; return this; },
    json(value) { state.body = value; return this; }
  };
}

async function call(method, route, { query = {}, body } = {}) {
  const res = responseHarness();
  await handler({ method, query: { route, ...query }, body }, res);
  return res.state;
}

async function createAllow(sessionId, intentId) {
  const result = await call('POST', 'evaluate', {
    body: {
      intent: {
        chainId: 42220,
        kind: 'TRANSFER',
        asset: 'USAT',
        recipient: RECIPIENT,
        requestedUsd: 5,
        amountBaseUnits: '5000000',
        intentId,
        sessionId
      }
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.decision.action, 'ALLOW');
  return result.body;
}

test('GET /api/activity requires a session id', async () => {
  const result = await call('GET', 'activity');
  assert.equal(result.statusCode, 400);
  assert.match(result.body?.error || '', /sessionId is required/i);
});

test('evaluate -> activity history uses one shared local store and returns privacy-safe rows', async () => {
  const sessionId = 'route-history-session';
  const evaluated = await createAllow(sessionId, 'route-history-intent');

  const result = await call('GET', 'activity', { query: { sessionId, limit: '10' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.items[0].traceId, evaluated.trace.traceId);
  assert.equal(result.body.items[0].sessionId, undefined);
  assert.equal(result.body.items[0].recipient, '0x1111…1111');
  assert.equal(result.body.items[0].txStatus, 'PREPARED');
});

test('GET /api/metrics reports durable session-scoped dashboard totals', async () => {
  const sessionId = 'route-metrics-session';
  await createAllow(sessionId, 'route-metrics-allow');
  await call('POST', 'evaluate', {
    body: {
      intent: {
        chainId: 42220,
        kind: 'TRANSFER',
        asset: 'USAT',
        recipient: RECIPIENT,
        requestedUsd: 50,
        amountBaseUnits: '50000000',
        intentId: 'route-metrics-block',
        sessionId
      }
    }
  });

  const result = await call('GET', 'metrics', { query: { sessionId } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.intentsEvaluated, 2);
  assert.equal(result.body.counts.ALLOW, 1);
  assert.equal(result.body.counts.BLOCK, 1);
  assert.equal(result.body.totalAuthorizedUsd, 5);
  assert.equal(result.body.protectedOrReviewedUsd, 50);
});

test('submitted transaction lifecycle is session scoped and receipt reconciliation reaches CONFIRMED', async () => {
  const sessionId = 'route-tx-session';
  const evaluated = await createAllow(sessionId, 'route-tx-intent');

  const wrongSession = await call('POST', 'transaction-submitted', {
    body: { sessionId: 'someone-else', traceId: evaluated.trace.traceId, txHash: TX, walletAddress: WALLET }
  });
  assert.equal(wrongSession.statusCode, 404);

  const submitted = await call('POST', 'transaction-submitted', {
    body: { sessionId, traceId: evaluated.trace.traceId, txHash: TX, walletAddress: WALLET }
  });
  assert.equal(submitted.statusCode, 200);
  assert.equal(submitted.body.txStatus, 'SUBMITTED');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const rpc = JSON.parse(options.body);
    assert.equal(rpc.method, 'eth_getTransactionReceipt');
    assert.deepEqual(rpc.params, [TX]);
    return {
      ok: true,
      status: 200,
      async json() {
        return { jsonrpc: '2.0', id: 1, result: { status: '0x1', blockNumber: '0x3039' } };
      }
    };
  };

  try {
    const confirmed = await call('POST', 'transaction-status', {
      body: { sessionId, traceId: evaluated.trace.traceId }
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.body.txStatus, 'CONFIRMED');
    assert.equal(confirmed.body.blockNumber, 12345);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const history = await call('GET', 'activity', { query: { sessionId } });
  assert.equal(history.body.items[0].txStatus, 'CONFIRMED');
  assert.equal(history.body.items[0].txHash, TX);
});
