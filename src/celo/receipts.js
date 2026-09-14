import { CELO_MAINNET } from './config.js';
import { requireTxHash } from './metrics.js';

function blockNumberFromHex(value) {
  if (value == null) return null;
  const parsed = Number.parseInt(String(value), 16);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function lookupCeloReceipt({ txHash, rpcUrl = CELO_MAINNET.rpcUrl, fetchImpl = fetch }) {
  const hash = requireTxHash(txHash);
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] })
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Celo RPC returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(payload?.error?.message || `Celo RPC HTTP ${response.status}`);
  if (payload?.error) throw new Error(payload.error.message || 'Celo RPC error');
  if (!payload?.result) return Object.freeze({ txHash: hash, txStatus: 'SUBMITTED', blockNumber: null });

  const txStatus = payload.result.status === '0x1' ? 'CONFIRMED' : 'FAILED';
  return Object.freeze({
    txHash: hash,
    txStatus,
    blockNumber: blockNumberFromHex(payload.result.blockNumber)
  });
}

export async function reconcileTransactionStatus({ store, sessionId, traceId, rpcUrl = CELO_MAINNET.rpcUrl, fetchImpl = fetch }) {
  if (!store?.getByTraceId || !store?.recordStatus) throw new TypeError('activity store is required');
  const session = String(sessionId ?? '').trim();
  if (!session) throw new TypeError('sessionId is required');
  const trace = String(traceId ?? '').trim();
  if (!trace) throw new TypeError('traceId is required');

  const item = await store.getByTraceId(trace, { sessionId: session });
  if (!item) throw new Error('TRACE_NOT_FOUND');
  if (!item.txHash) throw new Error('Transaction has not been submitted');

  const receipt = await lookupCeloReceipt({ txHash: item.txHash, rpcUrl, fetchImpl });
  const saved = await store.recordStatus({
    traceId: trace,
    txStatus: receipt.txStatus,
    blockNumber: receipt.blockNumber,
    sessionId: session
  });
  return Object.freeze({ ...receipt, traceId: trace, activity: saved });
}
