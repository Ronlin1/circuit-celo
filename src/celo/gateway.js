import { getConfiguredAssets, isEvmAddress } from './config.js';

const TRANSFER_SELECTOR = 'a9059cbb';

function uint256Hex(value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) throw new RangeError('amountBaseUnits must be non-negative');
  const hex = n.toString(16);
  if (hex.length > 64) throw new RangeError('amountBaseUnits exceeds uint256');
  return hex.padStart(64, '0');
}

export function buildErc20Transfer({ recipient, amountBaseUnits }) {
  if (!isEvmAddress(recipient)) throw new TypeError('recipient must be a 20-byte EVM address');
  const addressWord = recipient.slice(2).toLowerCase().padStart(64, '0');
  return `0x${TRANSFER_SELECTOR}${addressWord}${uint256Hex(amountBaseUnits)}`;
}

export function prepareCeloTransfer(intent, config = getConfiguredAssets()) {
  if (!intent || typeof intent !== 'object') throw new TypeError('intent is required');
  if (intent.chainId != null && Number(intent.chainId) !== config.chainId) throw new Error('Only Celo mainnet chain 42220 is supported');
  const asset = config.assets[intent.asset];
  if (!asset) throw new Error(`Unsupported configured asset: ${intent.asset}`);
  if (!isEvmAddress(asset.address)) throw new Error(`Invalid token address for ${intent.asset}`);
  if (!isEvmAddress(intent.recipient)) throw new TypeError('recipient must be a 20-byte EVM address');
  const amount = typeof intent.amountBaseUnits === 'bigint' ? intent.amountBaseUnits : BigInt(intent.amountBaseUnits);
  if (amount <= 0n) throw new RangeError('amountBaseUnits must be greater than zero');
  return Object.freeze({
    executionMode: 'PREPARE',
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
    to: asset.address,
    data: buildErc20Transfer({ recipient: intent.recipient, amountBaseUnits: amount }),
    value: '0x0',
    asset: intent.asset,
    recipient: intent.recipient,
    amountBaseUnits: amount.toString()
  });
}
