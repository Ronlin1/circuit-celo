const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const CELO_MAINNET = Object.freeze({
  chainId: 42220,
  caip2: 'eip155:42220',
  rpcUrl: 'https://forno.celo.org',
  explorerUrl: 'https://celoscan.io',
  x402FacilitatorUrl: 'https://api.x402.celo.org'
});

export const ERC8004 = Object.freeze({
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
});

export const ASSETS = Object.freeze({
  USAT: Object.freeze({ symbol: 'USAT', address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', decimals: 6, source: 'CeloScan' }),
  cNGN: Object.freeze({ symbol: 'cNGN', address: '0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f', decimals: 6, source: 'cNGN' }),
  USDC: Object.freeze({ symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6, source: 'Celo' }),
  USDT: Object.freeze({ symbol: 'USDT', address: '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e', decimals: 6, source: 'Celo' }),
  USDm: Object.freeze({ symbol: 'USDm', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18, source: 'Mento' })
});

function requireAddress(value, label) {
  if (!ADDRESS.test(value ?? '')) throw new TypeError(`${label} must be a 20-byte EVM address`);
  return value;
}

export function getConfiguredAssets(env = process.env) {
  const assets = Object.fromEntries(Object.entries(ASSETS).map(([key, value]) => [key, { ...value }]));
  if (env.USAT_TOKEN_ADDRESS) assets.USAT.address = requireAddress(env.USAT_TOKEN_ADDRESS, 'USAT_TOKEN_ADDRESS');
  if (env.CNGN_TOKEN_ADDRESS) assets.cNGN.address = requireAddress(env.CNGN_TOKEN_ADDRESS, 'CNGN_TOKEN_ADDRESS');
  return Object.freeze({
    chainId: CELO_MAINNET.chainId,
    caip2: CELO_MAINNET.caip2,
    rpcUrl: env.CELO_RPC_URL || CELO_MAINNET.rpcUrl,
    explorerUrl: CELO_MAINNET.explorerUrl,
    x402FacilitatorUrl: env.X402_FACILITATOR_URL || CELO_MAINNET.x402FacilitatorUrl,
    assets: Object.freeze(assets)
  });
}

export function isEvmAddress(value) {
  return ADDRESS.test(value ?? '');
}
