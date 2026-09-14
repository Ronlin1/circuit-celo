import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreasuryRecorder } from '../../src/celo/trace.js';

test('reuses CIRCUIT hash-linked Flight Recorder for Celo decisions', () => {
  const recorder = createTreasuryRecorder();
  const first = recorder.record({ traceId: 'celo-1', timestamp: '2026-09-14T00:00:00.000Z', intent: { asset: 'USAT' }, decision: { action: 'ALLOW' } });
  const second = recorder.record({ traceId: 'celo-2', timestamp: '2026-09-14T00:00:01.000Z', intent: { asset: 'cNGN' }, decision: { action: 'BLOCK' } });
  assert.equal(first.previousHash, 'GENESIS');
  assert.equal(second.previousHash, first.currentHash);
  assert.equal(recorder.verify().valid, true);
});
