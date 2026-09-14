import { isEvmAddress } from './config.js';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function requireSession(sessionId) {
  const value = String(sessionId ?? '').trim();
  if (!value) throw new TypeError('sessionId is required');
  return value;
}

function requireTraceId(traceId) {
  const value = String(traceId ?? '').trim();
  if (!value) throw new TypeError('traceId is required');
  return value;
}

function requireTxHash(txHash) {
  const value = String(txHash ?? '');
  if (!TX_HASH.test(value)) throw new TypeError('transaction hash must be 0x followed by 64 hex characters');
  return value;
}

function requireWalletAddress(walletAddress) {
  const value = String(walletAddress ?? '');
  if (!isEvmAddress(value)) throw new TypeError('wallet address must be a valid 20-byte EVM address');
  return value;
}

export function maskAddress(address) {
  const value = String(address ?? '');
  if (!isEvmAddress(value)) return value || null;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function sanitizeActivity(item) {
  return Object.freeze({
    traceId: item.traceId,
    timestamp: item.timestamp,
    intentId: item.intentId,
    walletAddress: maskAddress(item.walletAddress),
    agentId: item.agentId ?? null,
    kind: item.kind,
    asset: item.asset,
    requestedUsd: Number(item.requestedUsd) || 0,
    amountBaseUnits: item.amountBaseUnits ?? null,
    decision: item.decision,
    reasonCodes: Array.isArray(item.reasonCodes) ? [...item.reasonCodes] : [],
    recipient: maskAddress(item.recipient),
    tokenContract: item.tokenContract ?? null,
    txHash: item.txHash ?? null,
    txStatus: item.txStatus,
    blockNumber: item.blockNumber ?? null,
    previousHash: item.previousHash ?? null,
    currentHash: item.currentHash ?? null,
    attributionTag: item.attributionTag ?? null,
    attributionVersion: item.attributionVersion ?? null
  });
}

export async function getActivity({ store, sessionId, limit = 50 }) {
  if (!store?.list) throw new TypeError('activity store is required');
  const session = requireSession(sessionId);
  const items = await store.list({ sessionId: session, limit });
  return items.map(sanitizeActivity);
}

export async function getActivityMetrics({ store, sessionId }) {
  if (!store?.getMetrics) throw new TypeError('activity store is required');
  const session = requireSession(sessionId);
  const metrics = await store.getMetrics({ sessionId: session });
  const counts = metrics.counts || { ALLOW: 0, BLOCK: 0, REVIEW: 0, PAUSE: 0 };
  return Object.freeze({
    ...metrics,
    counts,
    intentsEvaluated: Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
  });
}

export async function recordSubmittedTransaction({ store, sessionId, traceId, txHash, walletAddress }) {
  if (!store?.getByTraceId || !store?.recordSubmitted) throw new TypeError('activity store is required');
  const session = requireSession(sessionId);
  const trace = requireTraceId(traceId);
  const hash = requireTxHash(txHash);
  const wallet = requireWalletAddress(walletAddress);
  const item = await store.getByTraceId(trace, { sessionId: session });
  if (!item) throw new Error('TRACE_NOT_FOUND');
  if (item.decision !== 'ALLOW' || item.txStatus !== 'PREPARED') throw new Error('Trace is not executable');
  return store.recordSubmitted({ traceId: trace, txHash: hash, walletAddress: wallet, sessionId: session });
}

export { requireTxHash };
