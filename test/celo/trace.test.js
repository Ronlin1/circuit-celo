import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreasuryRecorder, buildTreasuryTrace, verifyTreasuryTraceChain } from '../../src/celo/trace.js';

test('reuses CIRCUIT hash-linked Flight Recorder for Celo decisions', () => {
  const recorder = createTreasuryRecorder();
  const first = recorder.record({ traceId: 'celo-1', timestamp: '2026-09-14T00:00:00.000Z', intent: { asset: 'USAT' }, decision: { action: 'ALLOW' } });
  const second = recorder.record({ traceId: 'celo-2', timestamp: '2026-09-14T00:00:01.000Z', intent: { asset: 'cNGN' }, decision: { action: 'BLOCK' } });
  assert.equal(first.previousHash, 'GENESIS');
  assert.equal(second.previousHash, first.currentHash);
  assert.equal(recorder.verify().valid, true);
});

test('builds a deterministic treasury trace from an authoritative previous hash', () => {
  const first = buildTreasuryTrace({
    traceId: 'durable-1',
    timestamp: '2026-09-14T00:00:00.000Z',
    intent: { asset: 'USAT', intentId: 'intent-1' },
    decision: { action: 'ALLOW', reasonCodes: [] }
  }, null);
  const repeated = buildTreasuryTrace({
    traceId: 'durable-1',
    timestamp: '2026-09-14T00:00:00.000Z',
    intent: { asset: 'USAT', intentId: 'intent-1' },
    decision: { action: 'ALLOW', reasonCodes: [] }
  }, null);
  const second = buildTreasuryTrace({
    traceId: 'durable-2',
    timestamp: '2026-09-14T00:00:01.000Z',
    intent: { asset: 'USDC', intentId: 'intent-2' },
    decision: { action: 'BLOCK', reasonCodes: ['PAYMENT_CAP_EXCEEDED'] }
  }, first.currentHash);

  assert.equal(first.previousHash, 'GENESIS');
  assert.equal(first.currentHash, repeated.currentHash);
  assert.equal(second.previousHash, first.currentHash);
  assert.equal(verifyTreasuryTraceChain([first, second]).valid, true);
});
