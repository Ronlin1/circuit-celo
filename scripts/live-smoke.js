import assert from 'node:assert/strict';

const BASE = process.env.CIRCUIT_LIVE_URL || 'https://circuit-celo.vercel.app';
const KNOWN = '0x1111111111111111111111111111111111111111';

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': 'circuit-live-smoke/1.0' } });
  const text = await res.text();
  assert.equal(res.status, 200, `${path}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'circuit-live-smoke/1.0' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  assert.equal(res.status, 200, `${path}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function intent({ usd = 5, token = 5, asset = 'USAT', recipient = KNOWN, id = crypto.randomUUID(), session = crypto.randomUUID(), kind = 'TRANSFER', extra = {} } = {}) {
  const decimals = asset === 'USDm' ? 18 : 6;
  return {
    chainId: 42220,
    kind,
    asset,
    recipient,
    requestedUsd: usd,
    amountBaseUnits: String(BigInt(Math.round(token * 1e6)) * (decimals === 18 ? 1_000_000_000_000n : 1n)),
    intentId: id,
    sessionId: session,
    ...extra
  };
}

const status = await get('/api/status');
assert.equal(status.network.chainId, 42220);
assert.equal(status.publicMandate.maxPaymentUsd, 20);
assert.equal(status.publicMandate.requireAgentIdentity, false);

const judge = await get('/api/judge');
assert.equal(judge.passed, 8);
assert.equal(judge.total, 8);

const safe = await post('/api/evaluate', { intent: intent() });
assert.equal(safe.decision.action, 'ALLOW');
assert.ok(safe.prepared?.data?.startsWith('0xa9059cbb'));

const oversize = await post('/api/evaluate', { intent: intent({ usd: 50, token: 50 }) });
assert.equal(oversize.decision.action, 'BLOCK');
assert.ok(oversize.decision.reasonCodes.includes('PAYMENT_CAP_EXCEEDED'));
assert.equal(oversize.prepared, null);

const forgedMandate = await post('/api/evaluate', {
  mandate: { status: 'ACTIVE', chainId: 42220, allowedAssets: ['USAT'], maxPaymentUsd: 999999, maxDailySpendUsd: 999999, maxX402Usd: 999999, knownRecipients: [KNOWN], requireAgentIdentity: false },
  intent: intent({ usd: 500, token: 500 })
});
assert.equal(forgedMandate.decision.action, 'BLOCK');
assert.ok(forgedMandate.decision.reasonCodes.includes('PAYMENT_CAP_EXCEEDED'));
assert.equal(forgedMandate.prepared, null);

const valueMismatch = await post('/api/evaluate', { intent: intent({ usd: 5, token: 50 }) });
assert.equal(valueMismatch.decision.action, 'BLOCK');
assert.ok(valueMismatch.decision.reasonCodes.includes('POLICY_VALUE_MISMATCH'));
assert.equal(valueMismatch.prepared, null);

const badRecipient = await post('/api/evaluate', { intent: intent({ recipient: 'not-an-address' }) });
assert.equal(badRecipient.decision.action, 'BLOCK');
assert.ok(badRecipient.decision.reasonCodes.includes('INVALID_RECIPIENT'));
assert.equal(badRecipient.prepared, null);

const x402High = await post('/api/x402-authorize', { intent: intent({ usd: 3, token: 3, kind: 'X402' }) });
assert.equal(x402High.decision.action, 'BLOCK');
assert.ok(x402High.decision.reasonCodes.includes('X402_PRICE_CAP_EXCEEDED'));
assert.equal(x402High.prepared, null);

const spoofContext = await post('/api/evaluate', {
  context: { dailySpendUsd: 999999, recentIntentIds: ['spoof-me'], agentIdentity: { registered: false } },
  intent: intent({ usd: 1, token: 1, id: 'spoof-me' })
});
assert.equal(spoofContext.decision.action, 'ALLOW');

const statusBurst = await Promise.all(Array.from({ length: 40 }, () => get('/api/status')));
assert.equal(statusBurst.length, 40);
assert.ok(statusBurst.every((x) => x.network.chainId === 42220));

const safeBurst = await Promise.all(Array.from({ length: 40 }, (_, i) => post('/api/evaluate', { intent: intent({ usd: 1, token: 1, id: `safe-burst-${i}`, session: `safe-burst-session-${i}` }) })));
assert.ok(safeBurst.every((x) => x.decision.action === 'ALLOW' && x.prepared));

const blockBurst = await Promise.all(Array.from({ length: 40 }, (_, i) => post('/api/evaluate', { intent: intent({ usd: 30, token: 30, id: `block-burst-${i}`, session: `block-burst-session-${i}` }) })));
assert.ok(blockBurst.every((x) => x.decision.action === 'BLOCK' && x.prepared === null));

console.log(JSON.stringify({
  target: BASE,
  assertions: 'passed',
  judge: `${judge.passed}/${judge.total}`,
  concurrentRequests: 120,
  securityCases: ['forged-mandate', 'value-mismatch', 'invalid-recipient', 'x402-cap', 'spoofed-context'],
  safePrepared: Boolean(safe.prepared)
}, null, 2));
