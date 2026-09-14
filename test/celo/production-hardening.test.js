import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/index.js';
import { evaluateTreasuryIntent } from '../../src/celo/treasury-policy.js';
import { JUDGE_MANDATE } from '../../src/celo/judge-scenarios.js';

const KNOWN = '0x1111111111111111111111111111111111111111';

function responseHarness() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    state,
    setHeader(name, value) { state.headers[name.toLowerCase()] = value; return this; },
    status(code) { state.statusCode = code; return this; },
    json(value) { state.body = value; return this; }
  };
}

async function vercelEvaluate(body) {
  const res = responseHarness();
  await handler({ method: 'POST', query: { route: 'evaluate' }, body }, res);
  return res.state;
}

test('public API ignores a caller-supplied relaxed mandate', async () => {
  const result = await vercelEvaluate({
    mandate: {
      status: 'ACTIVE', chainId: 42220, allowedAssets: ['USAT'], maxPaymentUsd: 999999,
      maxDailySpendUsd: 999999, maxX402Usd: 999999, unknownRecipientReviewUsd: 999999,
      knownRecipients: [KNOWN], requireAgentIdentity: false
    },
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN,
      requestedUsd: 500, amountBaseUnits: '500000000', intentId: 'attacker-relaxes-policy'
    },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.decision.action, 'BLOCK');
  assert.ok(result.body.decision.reasonCodes.includes('PAYMENT_CAP_EXCEEDED'));
  assert.equal(result.body.prepared, null);
});

test('public happy path allows a safe USAT transfer without requiring an Agent ID', async () => {
  const result = await vercelEvaluate({
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN,
      requestedUsd: 5, amountBaseUnits: '5000000', intentId: 'public-safe', sessionId: 'safe-session'
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.decision.action, 'ALLOW');
  assert.equal(result.body.prepared.asset, 'USAT');
});

test('caller cannot force a block or reset state using supplied context fields', async () => {
  const result = await vercelEvaluate({
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN,
      requestedUsd: 1, amountBaseUnits: '1000000', intentId: 'context-spoof', sessionId: 'context-spoof-session'
    },
    context: { dailySpendUsd: 999999, recentIntentIds: ['context-spoof'], agentIdentity: { registered: false } }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.decision.action, 'ALLOW');
});

test('USD stablecoin amount cannot exceed the declared policy value', () => {
  const decision = evaluateTreasuryIntent({
    mandate: JUDGE_MANDATE,
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN,
      requestedUsd: 5, amountBaseUnits: '50000000', intentId: 'understated-value'
    },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('POLICY_VALUE_MISMATCH'));
});

test('cNGN transfer cannot exceed the asset-specific unit cap by understating USD value', () => {
  const decision = evaluateTreasuryIntent({
    mandate: JUDGE_MANDATE,
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'cNGN', recipient: KNOWN,
      requestedUsd: 1, amountBaseUnits: '50000000000', intentId: 'cngn-cap'
    },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('TOKEN_AMOUNT_CAP_EXCEEDED'));
});

test('invalid recipient is a policy BLOCK rather than a preparation exception', () => {
  const decision = evaluateTreasuryIntent({
    mandate: JUDGE_MANDATE,
    intent: {
      chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: 'not-an-address',
      requestedUsd: 5, amountBaseUnits: '5000000', intentId: 'bad-recipient'
    },
    context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
  });
  assert.equal(decision.action, 'BLOCK');
  assert.ok(decision.reasonCodes.includes('INVALID_RECIPIENT'));
});

test('hard matrix: no non-ALLOW verdict ever receives executable preparation', async () => {
  const values = [-10, -1, 0, 0.01, 1, 5, 10, 19.99, 20, 20.01, 50, 500];
  let checked = 0;
  for (const requestedUsd of values) {
    for (const tokenUnits of values.filter((v) => v > 0)) {
      const result = await vercelEvaluate({
        intent: {
          chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: KNOWN,
          requestedUsd, amountBaseUnits: String(BigInt(Math.round(tokenUnits * 1_000_000))),
          intentId: `matrix-${requestedUsd}-${tokenUnits}`
        },
        context: { dailySpendUsd: 0, agentIdentity: { registered: true, agentId: '42' }, recentIntentIds: [] }
      });
      if (result.body?.decision?.action !== 'ALLOW') assert.equal(result.body.prepared, null);
      checked += 1;
    }
  }
  assert.ok(checked >= 100);
});

test('deterministic policy survives 5000 hostile randomized intents without throwing', () => {
  let seed = 0xC1AC017;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const assets = ['USAT', 'USDC', 'USDT', 'USDm', 'cNGN', 'BAD'];
  for (let i = 0; i < 5000; i += 1) {
    const usd = (rnd() - 0.15) * 120;
    const asset = assets[Math.floor(rnd() * assets.length)];
    const amount = BigInt(Math.max(1, Math.floor(rnd() * 100_000_000)));
    const decision = evaluateTreasuryIntent({
      mandate: JUDGE_MANDATE,
      intent: {
        chainId: rnd() > 0.05 ? 42220 : 1,
        kind: rnd() > 0.2 ? 'TRANSFER' : 'X402',
        asset,
        recipient: rnd() > 0.05 ? KNOWN : '0xBAD',
        requestedUsd: usd,
        amountBaseUnits: amount.toString(),
        intentId: `fuzz-${i}`,
        policyOverrideRequested: rnd() < 0.02
      },
      context: {
        dailySpendUsd: rnd() * 120,
        agentIdentity: rnd() > 0.05 ? { registered: true, agentId: String(i + 1) } : null,
        recentIntentIds: rnd() < 0.02 ? [`fuzz-${i}`] : []
      }
    });
    assert.ok(['ALLOW', 'BLOCK', 'PAUSE', 'REVIEW', 'RESIZE'].includes(decision.action));
  }
});
