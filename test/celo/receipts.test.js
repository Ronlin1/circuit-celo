import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupCeloReceipt } from '../../src/celo/receipts.js';

const TX = `0x${'a'.repeat(64)}`;

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

test('receipt lookup validates a 32-byte transaction hash before RPC', async () => {
  let called = false;
  await assert.rejects(
    () => lookupCeloReceipt({
      txHash: '0xBAD',
      rpcUrl: 'https://forno.celo.org',
      fetchImpl: async () => { called = true; return response({}); }
    }),
    /transaction hash/i
  );
  assert.equal(called, false);
});

test('missing receipt remains SUBMITTED', async () => {
  const result = await lookupCeloReceipt({
    txHash: TX,
    rpcUrl: 'https://forno.celo.org',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.method, 'eth_getTransactionReceipt');
      assert.deepEqual(body.params, [TX]);
      return response({ jsonrpc: '2.0', id: 1, result: null });
    }
  });
  assert.deepEqual(result, { txHash: TX, txStatus: 'SUBMITTED', blockNumber: null });
});

test('successful Celo receipt maps to CONFIRMED with decimal block number', async () => {
  const result = await lookupCeloReceipt({
    txHash: TX,
    rpcUrl: 'https://forno.celo.org',
    fetchImpl: async () => response({ jsonrpc: '2.0', id: 1, result: { status: '0x1', blockNumber: '0x3039' } })
  });
  assert.deepEqual(result, { txHash: TX, txStatus: 'CONFIRMED', blockNumber: 12345 });
});

test('reverted Celo receipt maps to FAILED', async () => {
  const result = await lookupCeloReceipt({
    txHash: TX,
    rpcUrl: 'https://forno.celo.org',
    fetchImpl: async () => response({ jsonrpc: '2.0', id: 1, result: { status: '0x0', blockNumber: '0x10' } })
  });
  assert.deepEqual(result, { txHash: TX, txStatus: 'FAILED', blockNumber: 16 });
});

test('RPC transport or JSON-RPC errors are explicit and do not invent confirmation', async () => {
  await assert.rejects(
    () => lookupCeloReceipt({
      txHash: TX,
      rpcUrl: 'https://forno.celo.org',
      fetchImpl: async () => response({ error: { message: 'upstream unavailable' } })
    }),
    /upstream unavailable/
  );
});
