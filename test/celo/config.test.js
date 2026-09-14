import test from 'node:test';
import assert from 'node:assert/strict';
import { CELO_MAINNET, ERC8004, ASSETS, getConfiguredAssets } from '../../src/celo/config.js';

test('pins official Celo mainnet and ERC-8004 registry addresses', () => {
  assert.equal(CELO_MAINNET.chainId, 42220);
  assert.equal(CELO_MAINNET.rpcUrl, 'https://forno.celo.org');
  assert.equal(ERC8004.identityRegistry.toLowerCase(), '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432');
  assert.equal(ERC8004.reputationRegistry.toLowerCase(), '0x8004baa17c55a88189ae136b182e5fda19de9b63');
});

test('pins verified Celo stablecoin addresses including USA₮ and cNGN', () => {
  assert.deepEqual(ASSETS.USAT, { symbol: 'USAT', address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', decimals: 6, source: 'CeloScan' });
  assert.deepEqual(ASSETS.cNGN, { symbol: 'cNGN', address: '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f', decimals: 6, source: 'cNGN' });
  assert.equal(ASSETS.USDC.address.toLowerCase(), '0xceba9300f2b948710d2653dd7b07f33a8b32118c');
  assert.equal(ASSETS.USDT.address.toLowerCase(), '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e');
  assert.equal(ASSETS.USDm.address.toLowerCase(), '0x765de816845861e75a25fca122bb6898b8b1282a');
});

test('configuration can override RPC and headline asset addresses without mutating defaults', () => {
  const configured = getConfiguredAssets({ CELO_RPC_URL: 'https://rpc.example', USAT_TOKEN_ADDRESS: '0x1111111111111111111111111111111111111111' });
  assert.equal(configured.rpcUrl, 'https://rpc.example');
  assert.equal(configured.assets.USAT.address, '0x1111111111111111111111111111111111111111');
  assert.equal(ASSETS.USAT.address, '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771');
});
