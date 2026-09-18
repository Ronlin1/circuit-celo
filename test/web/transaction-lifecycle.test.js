import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSubmittedTransaction,
  reconcileTransaction,
  pollTransactionStatus,
  submitPreparedTransaction
} from '../../public/js/treasury.js';

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
}

const SESSION = 'browser-session-1';
const TRACE = 'trace-live-1';
const WALLET = '0x1234567890123456789012345678901234567890';
const HASH = `0x${'a'.repeat(64)}`;
const PREPARED = {
  to: '0x0000000000000000000000000000000000000001',
  data: '0xa9059cbb' + '0'.repeat(128),
  asset: 'USDC'
};

test('wallet hash is persisted as SUBMITTED before any receipt confirmation', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return response({
      traceId: TRACE,
      txHash: HASH,
      txStatus: 'SUBMITTED',
      walletAddress: WALLET
    });
  };

  const saved = await recordSubmittedTransaction({
    sessionId: SESSION,
    traceId: TRACE,
    txHash: HASH,
    walletAddress: WALLET,
    fetchImpl
  });

  assert.equal(saved.txStatus, 'SUBMITTED');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/transaction-submitted');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    sessionId: SESSION,
    traceId: TRACE,
    txHash: HASH,
    walletAddress: WALLET
  });
});

test('guarded browser submit calls wallet first, then persists SUBMITTED with the authorization trace', async () => {
  const order = [];
  const provider = {
    async request(payload) {
      order.push({ type: 'wallet', payload });
      assert.equal(payload.method, 'eth_sendTransaction');
      assert.deepEqual(payload.params, [{ from: WALLET, to: PREPARED.to, data: PREPARED.data, value: '0x0' }]);
      return HASH;
    }
  };
  const fetchImpl = async (url, options) => {
    order.push({ type: 'api', url: String(url), options });
    return response({ traceId: TRACE, txHash: HASH, txStatus: 'SUBMITTED', walletAddress: WALLET });
  };

  const result = await submitPreparedTransaction({
    decision: { action: 'ALLOW' },
    prepared: PREPARED,
    provider,
    walletAddress: WALLET,
    sessionId: SESSION,
    traceId: TRACE,
    fetchImpl
  });

  assert.equal(result.txHash, HASH);
  assert.equal(result.activity.txStatus, 'SUBMITTED');
  assert.deepEqual(order.map((entry) => entry.type), ['wallet', 'api']);
  assert.equal(order[1].url, '/api/transaction-submitted');
});

test('guarded browser submit never invokes wallet or API for a non-ALLOW verdict', async () => {
  let walletCalled = false;
  let apiCalled = false;
  const provider = { async request() { walletCalled = true; return HASH; } };
  const fetchImpl = async () => { apiCalled = true; return response({}); };

  await assert.rejects(
    () => submitPreparedTransaction({
      decision: { action: 'REVIEW' },
      prepared: PREPARED,
      provider,
      walletAddress: WALLET,
      sessionId: SESSION,
      traceId: TRACE,
      fetchImpl
    }),
    /ALLOW/i
  );
  assert.equal(walletCalled, false);
  assert.equal(apiCalled, false);
});

test('receipt reconciliation is a separate request and returns server-authoritative status', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ traceId: TRACE, txHash: HASH, txStatus: 'CONFIRMED', blockNumber: 12345 });
  };

  const result = await reconcileTransaction({ sessionId: SESSION, traceId: TRACE, fetchImpl });
  assert.equal(result.txStatus, 'CONFIRMED');
  assert.equal(result.blockNumber, 12345);
  assert.equal(calls[0].url, '/api/transaction-status');
  assert.deepEqual(JSON.parse(calls[0].options.body), { sessionId: SESSION, traceId: TRACE });
});

test('bounded polling stops on CONFIRMED and never confirms from the wallet hash alone', async () => {
  const statuses = ['SUBMITTED', 'SUBMITTED', 'CONFIRMED'];
  const sleeps = [];
  let call = 0;
  const fetchImpl = async () => {
    const txStatus = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return response({ traceId: TRACE, txHash: HASH, txStatus, blockNumber: txStatus === 'CONFIRMED' ? 54321 : null });
  };

  const result = await pollTransactionStatus({
    sessionId: SESSION,
    traceId: TRACE,
    maxAttempts: 5,
    delayMs: 10,
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); }
  });

  assert.equal(result.txStatus, 'CONFIRMED');
  assert.equal(result.attempts, 3);
  assert.equal(call, 3);
  assert.deepEqual(sleeps, [10, 10]);
});

test('bounded polling leaves a missing receipt as SUBMITTED rather than inventing success', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return response({ traceId: TRACE, txHash: HASH, txStatus: 'SUBMITTED', blockNumber: null });
  };

  const result = await pollTransactionStatus({
    sessionId: SESSION,
    traceId: TRACE,
    maxAttempts: 3,
    delayMs: 0,
    fetchImpl,
    sleep: async () => {}
  });

  assert.equal(result.txStatus, 'SUBMITTED');
  assert.equal(result.attempts, 3);
  assert.equal(call, 3);
});

test('submission helper rejects malformed hashes and wallet addresses before calling the API', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return response({}); };

  await assert.rejects(
    () => recordSubmittedTransaction({ sessionId: SESSION, traceId: TRACE, txHash: '0x1234', walletAddress: WALLET, fetchImpl }),
    /transaction hash/i
  );
  await assert.rejects(
    () => recordSubmittedTransaction({ sessionId: SESSION, traceId: TRACE, txHash: HASH, walletAddress: 'not-a-wallet', fetchImpl }),
    /wallet address/i
  );
  assert.equal(called, false);
});
