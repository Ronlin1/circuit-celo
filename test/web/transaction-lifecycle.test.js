import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordSubmittedTransaction,
  reconcileTransaction,
  pollTransactionStatus
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
