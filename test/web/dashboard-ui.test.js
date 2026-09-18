import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDashboard, renderDashboardModel, paintDashboard } from '../../public/js/dashboard.js';
import { loadBalances } from '../../public/js/treasury.js';

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
}

function makeNode() {
  const attributes = new Map();
  return {
    textContent: '',
    innerHTML: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; }
  };
}

test('dashboard loads real session-scoped metrics and activity without sample data', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('/api/metrics')) {
      return jsonResponse({
        counts: { ALLOW: 2, BLOCK: 1, REVIEW: 1, PAUSE: 0 },
        intentsEvaluated: 4,
        totalAuthorizedUsd: 12.5,
        protectedOrReviewedUsd: 30,
        x402AuthorizedUsd: 1.5,
        submittedTransactions: 1,
        confirmedTransactions: 1
      });
    }
    if (String(url).startsWith('/api/activity')) {
      return jsonResponse([
        {
          traceId: 'trace-1', timestamp: '2026-09-18T05:00:00.000Z', intentId: 'intent-1',
          kind: 'TRANSFER', asset: 'USDC', requestedUsd: 5, decision: 'ALLOW', reasonCodes: [],
          recipient: '0x1111…1111', tokenContract: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
          txHash: `0x${'a'.repeat(64)}`, txStatus: 'CONFIRMED', blockNumber: 123,
          previousHash: null, currentHash: 'hash-1'
        }
      ]);
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const data = await loadDashboard({ sessionId: 'session-live', fetchImpl });
  assert.equal(data.metrics.intentsEvaluated, 4);
  assert.equal(data.activity.length, 1);
  assert.ok(calls.some((url) => url.includes('/api/metrics?sessionId=session-live')));
  assert.ok(calls.some((url) => url.includes('/api/activity?sessionId=session-live')));

  const model = renderDashboardModel({
    metrics: data.metrics,
    activity: data.activity,
    mandate: { maxDailySpendUsd: 100, maxPaymentUsd: 20, maxX402Usd: 2 }
  });
  assert.equal(model.kpis.intents, '4');
  assert.equal(model.kpis.authorized, '$12.50');
  assert.equal(model.kpis.protected, '$30.00');
  assert.equal(model.kpis.confirmed, '1');
  assert.equal(model.kpis.remaining, '$87.50');
  assert.match(model.activityHtml, /CONFIRMED/);
  assert.match(model.activityHtml, /celoscan\.io\/tx\/0x[a]+/i);
  assert.match(model.activityHtml, /USDC/);
});

test('empty dashboard is explicit and never fabricates sample activity', () => {
  const model = renderDashboardModel({
    metrics: {
      counts: { ALLOW: 0, BLOCK: 0, REVIEW: 0, PAUSE: 0 },
      intentsEvaluated: 0,
      totalAuthorizedUsd: 0,
      protectedOrReviewedUsd: 0,
      confirmedTransactions: 0
    },
    activity: [],
    mandate: { maxDailySpendUsd: 100, maxPaymentUsd: 20, maxX402Usd: 2 }
  });

  assert.equal(model.empty, true);
  assert.match(model.activityHtml, /No activity yet/i);
  assert.doesNotMatch(model.activityHtml, /sample|demo transaction|example payment/i);
  assert.equal(model.decisionDistribution.total, 0);
  assert.equal(model.mandateUtilization.percent, 0);
});

test('decision distribution and mandate utilization are derived only from persisted metrics', () => {
  const model = renderDashboardModel({
    metrics: {
      counts: { ALLOW: 4, BLOCK: 2, REVIEW: 1, PAUSE: 1 },
      intentsEvaluated: 8,
      totalAuthorizedUsd: 75,
      protectedOrReviewedUsd: 26,
      confirmedTransactions: 2
    },
    activity: [],
    mandate: { maxDailySpendUsd: 100, maxPaymentUsd: 20, maxX402Usd: 2 }
  });

  assert.deepEqual(model.decisionDistribution, { ALLOW: 4, BLOCK: 2, REVIEW: 1, PAUSE: 1, total: 8 });
  assert.equal(model.mandateUtilization.percent, 75);
  assert.equal(model.mandateUtilization.label, '$75.00 of $100.00 authorized');
});

test('paint boundary writes KPIs, decision visual, utilization and persisted activity into the Control Center nodes', () => {
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, makeNode());
    return nodes.get(selector);
  };
  const model = renderDashboardModel({
    metrics: {
      counts: { ALLOW: 2, BLOCK: 1, REVIEW: 1, PAUSE: 0 },
      intentsEvaluated: 4,
      totalAuthorizedUsd: 12.5,
      protectedOrReviewedUsd: 30,
      confirmedTransactions: 1
    },
    activity: [{
      traceId: 'trace-1', timestamp: '2026-09-18T05:00:00.000Z', kind: 'TRANSFER', asset: 'USDC',
      requestedUsd: 5, decision: 'ALLOW', reasonCodes: [], txStatus: 'CONFIRMED', txHash: `0x${'b'.repeat(64)}`
    }],
    mandate: { maxDailySpendUsd: 100, maxPaymentUsd: 20, maxX402Usd: 2 }
  });

  paintDashboard(model, get);
  assert.equal(get('#dashboardIntents').textContent, '4');
  assert.equal(get('#dashboardAuthorized').textContent, '$12.50');
  assert.equal(get('#dashboardProtected').textContent, '$30.00');
  assert.equal(get('#dashboardConfirmed').textContent, '1');
  assert.equal(get('#dashboardRemaining').textContent, '$87.50');
  assert.match(get('#dashboardDecision').innerHTML, /ALLOW/);
  assert.match(get('#dashboardDecision').innerHTML, />2</);
  assert.equal(get('#dashboardMandateLabel').textContent, '$12.50 of $100.00 authorized');
  assert.match(get('#dashboardMandateBar').getAttribute('style'), /12\.5%/);
  assert.match(get('#dashboardActivity').innerHTML, /CONFIRMED/);
});

test('balance loader reads CELO and every configured ERC-20 with balanceOf', async () => {
  const address = '0x1234567890123456789012345678901234567890';
  const calls = [];
  const provider = {
    async request(payload) {
      calls.push(payload);
      if (payload.method === 'eth_getBalance') return '0xde0b6b3a7640000'; // 1 CELO
      if (payload.method === 'eth_call') {
        const to = payload.params[0].to.toLowerCase();
        if (to === '0x0000000000000000000000000000000000000001') return '0x4c4b40'; // 5 USDC, 6d
        if (to === '0x0000000000000000000000000000000000000002') throw new Error('rpc unavailable');
      }
      throw new Error(`unexpected method ${payload.method}`);
    }
  };
  const status = {
    assets: {
      USDC: { address: '0x0000000000000000000000000000000000000001', decimals: 6 },
      USAT: { address: '0x0000000000000000000000000000000000000002', decimals: 6 }
    }
  };

  const balances = await loadBalances(provider, address, status);
  assert.equal(balances.CELO.display, '1');
  assert.equal(balances.USDC.display, '5');
  assert.equal(balances.USAT.display, 'Unavailable');
  assert.ok(calls.some((call) => call.method === 'eth_getBalance'));
  assert.equal(calls.filter((call) => call.method === 'eth_call').length, 2);
  const balanceCall = calls.find((call) => call.method === 'eth_call');
  assert.match(balanceCall.params[0].data, /^0x70a08231[0-9a-f]{64}$/i);
});

test('balance loader refuses to invent zero when wallet or token reads fail', async () => {
  const provider = { async request() { throw new Error('offline'); } };
  const status = { assets: { USDC: { address: '0x0000000000000000000000000000000000000001', decimals: 6 } } };
  const balances = await loadBalances(provider, '0x1234567890123456789012345678901234567890', status);
  assert.equal(balances.CELO.display, 'Unavailable');
  assert.equal(balances.USDC.display, 'Unavailable');
});
