import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErc20Transfer, prepareCeloTransfer } from '../../src/celo/gateway.js';

test('encodes ERC-20 transfer calldata deterministically', () => {
  const data = buildErc20Transfer({ recipient: '0x1111111111111111111111111111111111111111', amountBaseUnits: 100000n });
  assert.equal(data.slice(0, 10), '0xa9059cbb');
  assert.equal(data.length, 138);
  assert.ok(data.endsWith('00000000000000000000000000000000000000000000000000000000000186a0'));
});

test('prepares but never signs a Celo stablecoin transfer', () => {
  const result = prepareCeloTransfer({ asset: 'USAT', recipient: '0x1111111111111111111111111111111111111111', amountBaseUnits: 100000n });
  assert.equal(result.chainId, 42220);
  assert.equal(result.to, '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771');
  assert.equal(result.value, '0x0');
  assert.equal(result.executionMode, 'PREPARE');
  assert.equal('privateKey' in result, false);
});
