const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BALANCE_OF_SELECTOR = '70a08231';

function encodeBalanceOf(address) {
  const value = String(address || '');
  if (!EVM_ADDRESS.test(value)) throw new TypeError('wallet address must be a valid EVM address');
  return `0x${BALANCE_OF_SELECTOR}${value.slice(2).toLowerCase().padStart(64, '0')}`;
}

function decodeQuantity(value) {
  const raw = String(value || '');
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new TypeError('RPC balance must be a hex quantity');
  return BigInt(raw);
}

function formatUnits(value, decimals) {
  const places = Number(decimals);
  if (!Number.isInteger(places) || places < 0 || places > 255) throw new TypeError('invalid token decimals');
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  if (places === 0) return `${negative ? '-' : ''}${absolute}`;
  const base = 10n ** BigInt(places);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(places, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

async function nativeBalance(provider, address) {
  try {
    const value = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] });
    return { symbol: 'CELO', raw: decodeQuantity(value).toString(), decimals: 18, display: formatUnits(decodeQuantity(value), 18), available: true };
  } catch (error) {
    return { symbol: 'CELO', raw: null, decimals: 18, display: 'Unavailable', available: false, error: error?.message || 'balance unavailable' };
  }
}

async function tokenBalance(provider, address, symbol, asset) {
  const decimals = Number(asset?.decimals);
  const token = String(asset?.address || '');
  if (!EVM_ADDRESS.test(token) || !Number.isInteger(decimals)) {
    return { symbol, raw: null, decimals: Number.isInteger(decimals) ? decimals : null, display: 'Unavailable', available: false, error: 'invalid token configuration' };
  }
  try {
    const value = await provider.request({
      method: 'eth_call',
      params: [{ to: token, data: encodeBalanceOf(address) }, 'latest']
    });
    const decoded = decodeQuantity(value);
    return { symbol, raw: decoded.toString(), decimals, display: formatUnits(decoded, decimals), available: true };
  } catch (error) {
    return { symbol, raw: null, decimals, display: 'Unavailable', available: false, error: error?.message || 'balance unavailable' };
  }
}

export async function loadBalances(provider, address, status = {}) {
  if (!provider?.request) throw new TypeError('wallet provider is required');
  if (!EVM_ADDRESS.test(String(address || ''))) throw new TypeError('wallet address must be a valid EVM address');
  const assets = status?.assets && typeof status.assets === 'object' ? status.assets : {};
  const entries = await Promise.all(Object.entries(assets).map(async ([symbol, asset]) => [symbol, await tokenBalance(provider, address, symbol, asset)]));
  const celo = await nativeBalance(provider, address);
  return Object.freeze({ CELO: Object.freeze(celo), ...Object.fromEntries(entries.map(([key, value]) => [key, Object.freeze(value)])) });
}

export { encodeBalanceOf, formatUnits };
