const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const BALANCE_OF_SELECTOR = '70a08231';

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

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

async function readApiJson(response, label) {
  let payload = {};
  if (typeof response?.json === 'function') payload = await response.json();
  else if (typeof response?.text === 'function') {
    const text = await response.text();
    payload = text ? JSON.parse(text) : {};
  }
  if (!response?.ok) throw new Error(payload?.error || `${label} failed (${response?.status || 'unknown'})`);
  return payload;
}

async function postJson(path, body, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const response = await fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return readApiJson(response, path);
}

async function nativeBalance(provider, address) {
  try {
    const value = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] });
    const decoded = decodeQuantity(value);
    return { symbol: 'CELO', raw: decoded.toString(), decimals: 18, display: formatUnits(decoded, 18), available: true };
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

export async function recordSubmittedTransaction({ sessionId, traceId, txHash, walletAddress, fetchImpl = globalThis.fetch } = {}) {
  const session = requiredText(sessionId, 'sessionId');
  const trace = requiredText(traceId, 'traceId');
  const hash = String(txHash || '');
  const walletAddressValue = String(walletAddress || '');
  if (!TX_HASH.test(hash)) throw new TypeError('transaction hash must be 0x followed by 64 hex characters');
  if (!EVM_ADDRESS.test(walletAddressValue)) throw new TypeError('wallet address must be a valid EVM address');
  return postJson('/api/transaction-submitted', {
    sessionId: session,
    traceId: trace,
    txHash: hash,
    walletAddress: walletAddressValue
  }, fetchImpl);
}

export async function submitPreparedTransaction({
  decision,
  prepared,
  provider,
  walletAddress,
  sessionId,
  traceId,
  fetchImpl = globalThis.fetch
} = {}) {
  if (decision?.action !== 'ALLOW') throw new Error('Only ALLOW can cross the browser execution boundary');
  if (!provider?.request) throw new TypeError('wallet provider is required');

  const wallet = String(walletAddress || '');
  if (!EVM_ADDRESS.test(wallet)) throw new TypeError('wallet address must be a valid EVM address');
  const to = String(prepared?.to || '');
  if (!EVM_ADDRESS.test(to)) throw new TypeError('prepared transaction destination must be a valid EVM address');
  const data = String(prepared?.data || '');
  if (!/^0x[0-9a-fA-F]*$/.test(data)) throw new TypeError('prepared transaction data must be hex calldata');
  const session = requiredText(sessionId, 'sessionId');
  const trace = requiredText(traceId, 'traceId');

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet, to, data, value: '0x0' }]
  });
  const hash = String(txHash || '');
  if (!TX_HASH.test(hash)) throw new TypeError('wallet returned an invalid transaction hash');

  try {
    const activity = await recordSubmittedTransaction({
      sessionId: session,
      traceId: trace,
      txHash: hash,
      walletAddress: wallet,
      fetchImpl
    });
    return Object.freeze({ txHash: hash, activity });
  } catch (cause) {
    const error = new Error(`Transaction was broadcast to Celo as ${hash}, but CIRCUIT could not record the submission.`);
    error.code = 'SUBMISSION_RECORD_FAILED';
    error.txHash = hash;
    error.cause = cause;
    throw error;
  }
}

export async function reconcileTransaction({ sessionId, traceId, fetchImpl = globalThis.fetch } = {}) {
  const session = requiredText(sessionId, 'sessionId');
  const trace = requiredText(traceId, 'traceId');
  return postJson('/api/transaction-status', { sessionId: session, traceId: trace }, fetchImpl);
}

export async function pollTransactionStatus({
  sessionId,
  traceId,
  maxAttempts = 5,
  delayMs = 1500,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const attemptsLimit = Math.max(1, Math.min(10, Math.trunc(Number(maxAttempts) || 1)));
  const wait = Math.max(0, Number(delayMs) || 0);
  let latest = null;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    latest = await reconcileTransaction({ sessionId, traceId, fetchImpl });
    if (latest?.txStatus === 'CONFIRMED' || latest?.txStatus === 'FAILED') {
      return Object.freeze({ ...latest, attempts: attempt });
    }
    if (attempt < attemptsLimit) await sleep(wait);
  }

  return Object.freeze({ ...(latest || { txStatus: 'SUBMITTED', blockNumber: null }), attempts: attemptsLimit });
}

export { encodeBalanceOf, formatUnits };
