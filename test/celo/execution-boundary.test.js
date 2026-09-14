import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAndPrepare } from '../../src/celo/execution.js';

const intent = { chainId: 42220, kind: 'TRANSFER', asset: 'USAT', recipient: '0x1111111111111111111111111111111111111111', requestedUsd: 5, amountBaseUnits: 5000000n, intentId: 'exec-1' };

test('only ALLOW can cross the Celo execution boundary', () => {
  for (const action of ['BLOCK','REVIEW','PAUSE']) {
    assert.throws(() => authorizeAndPrepare({ decision: { action }, intent }), /ALLOW/);
  }
  const prepared = authorizeAndPrepare({ decision: { action: 'ALLOW' }, intent });
  assert.equal(prepared.executionMode, 'PREPARE');
  assert.equal(prepared.chainId, 42220);
});
