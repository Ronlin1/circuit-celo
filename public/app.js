const $ = (selector) => document.querySelector(selector);
const API = '/api';
const CELO_CHAIN_HEX = '0xa4ec';
const sessionId = crypto.randomUUID();
let account = null;
let walletProvider = null;
let lastPrepared = null;
let lastDecision = null;
let walletListenersBound = false;
const decimals = { USAT: 6, cNGN: 6, USDC: 6, USDT: 6, USDm: 18 };

function baseUnits(value, places) {
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Token amount must be a positive decimal number.');
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > places) throw new Error(`This asset supports at most ${places} decimals.`);
  return (BigInt(whole) * (10n ** BigInt(places)) + BigInt((fraction + '0'.repeat(places)).slice(0, places) || '0')).toString();
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Control plane returned invalid JSON (${response.status}).`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function setWalletStatus(message, tone = '') {
  const node = $('#walletStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `wallet-status ${tone}`.trim();
}

function injectedProviders() {
  const ethereum = window?.ethereum;
  if (!ethereum) return [];
  if (Array.isArray(ethereum.providers) && ethereum.providers.length) return ethereum.providers;
  return [ethereum];
}

function chooseProvider() {
  const providers = injectedProviders();
  return providers.find((p) => p?.isMiniPay) || providers.find((p) => p?.isMetaMask) || providers[0] || null;
}

async function chainIdOf(provider) {
  try { return String(await provider.request({ method: 'eth_chainId' })).toLowerCase(); }
  catch { return null; }
}

function displayAccount(address, celoState = null) {
  account = address || null;
  const button = $('#walletButton');
  if (!button) return;
  if (account) {
    button.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    button.classList.add('connected');
    if (celoState === true) setWalletStatus('Connected on Celo · wallet remains the signer', 'ok');
    else if (celoState === false) setWalletStatus('Wallet connected · switch to Celo before execution', 'warn');
    else setWalletStatus('Wallet connected · checking network…');
  } else {
    button.textContent = 'Connect wallet';
    button.classList.remove('connected');
    setWalletStatus('Wallet detected · connect to authorize mainnet execution');
  }
}

async function status() {
  try {
    const data = await api('/status');
    $('#apiStatus').textContent = `● ${data.network.name} · ${data.executionMode}`;
    $('#apiStatus').classList.add('ok');
    $('#executionLabel').textContent = `${data.executionMode} MODE`;
  } catch (error) {
    $('#apiStatus').textContent = `Control plane unavailable · ${error.message}`;
  }
}

async function ensureCelo(provider = walletProvider) {
  if (!provider?.request) throw new Error('No compatible EVM wallet provider is available.');
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CELO_CHAIN_HEX }] });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CELO_CHAIN_HEX,
        chainName: 'Celo',
        nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
        rpcUrls: ['https://forno.celo.org'],
        blockExplorerUrls: ['https://celoscan.io']
      }]
    });
  }
}

function bindWalletEvents(provider) {
  if (walletListenersBound || !provider?.on) return;
  walletListenersBound = true;
  provider.on('accountsChanged', async (accounts) => {
    if (!accounts?.[0]) return displayAccount(null);
    const chainId = await chainIdOf(provider);
    displayAccount(accounts[0], chainId === CELO_CHAIN_HEX);
  });
  provider.on('chainChanged', (chainId) => {
    const onCelo = String(chainId).toLowerCase() === CELO_CHAIN_HEX;
    if (account) displayAccount(account, onCelo);
    else if (onCelo) setWalletStatus('Celo network selected · connect wallet to enable execution', 'ok');
  });
}

async function connectWallet() {
  const button = $('#walletButton');
  const provider = chooseProvider();
  if (!provider) {
    if (button) button.textContent = 'Install wallet';
    setWalletStatus('No injected wallet found. Open this page in MetaMask/MiniPay, or install an EVM wallet.', 'warn');
    return null;
  }

  walletProvider = provider;
  if (button) { button.disabled = true; button.textContent = 'Connecting…'; }
  setWalletStatus('Requesting wallet access…');

  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('Wallet returned no account.');
    await ensureCelo(provider);
    bindWalletEvents(provider);
    displayAccount(accounts[0], true);
    return accounts[0];
  } catch (error) {
    const rejected = error?.code === 4001;
    displayAccount(null);
    setWalletStatus(rejected ? 'Connection cancelled in your wallet.' : `Wallet connection failed · ${error?.message || 'Unknown wallet error'}`, 'warn');
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

async function initializeWallet() {
  const provider = chooseProvider();
  if (!provider) {
    setWalletStatus('No wallet connected · Treasury Lab still works in prepare mode');
    return;
  }
  walletProvider = provider;
  bindWalletEvents(provider);
  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (accounts?.[0]) {
      const chainId = await chainIdOf(provider);
      displayAccount(accounts[0], chainId === CELO_CHAIN_HEX);
    } else {
      setWalletStatus('Wallet detected · click Connect wallet to enable execution');
    }
  } catch {
    setWalletStatus('Wallet detected · click Connect wallet to enable execution');
  }
}

function paintDecision(data) {
  lastDecision = data.decision;
  lastPrepared = data.prepared;
  const action = data.decision.action;
  const verdict = $('#verdict');
  verdict.className = `verdict ${action.toLowerCase()}`;
  verdict.textContent = action;
  const copy = {
    ALLOW: 'Intent is inside the active mandate. The execution gateway may open.',
    BLOCK: 'A hard mandate constraint failed. No transaction payload is executable.',
    PAUSE: 'Sequence risk detected. Automatic execution is frozen until state is reconciled.',
    REVIEW: 'The action needs explicit human review before execution.',
    RESIZE: 'The action may proceed only at a reduced size.'
  };
  $('#verdictCopy').textContent = copy[action] || 'Decision returned.';
  $('#reasons').innerHTML = data.decision.reasonCodes.map((code) => `<span class="reason">${code}</span>`).join('') || '<span class="reason">NO POLICY VIOLATIONS</span>';
  const prepared = $('#prepared');
  const executeButton = $('#executeButton');
  $('#txLink').classList.add('hidden');
  if (data.prepared) {
    prepared.classList.remove('hidden');
    prepared.textContent = `EXECUTABLE CELO PAYLOAD\nto: ${data.prepared.to}\nasset: ${data.prepared.asset}\nrecipient: ${data.prepared.recipient}\nbase units: ${data.prepared.amountBaseUnits}\ndata: ${data.prepared.data.slice(0, 34)}…${data.prepared.data.slice(-18)}\ntrace: ${data.trace.traceId}`;
    executeButton.classList.remove('hidden');
  } else {
    prepared.classList.add('hidden');
    executeButton.classList.add('hidden');
  }
  $('#coreState').textContent = action;
}

async function evaluate(event) {
  event.preventDefault();
  const asset = $('#asset').value;
  const button = event?.submitter;
  if (button) { button.disabled = true; button.textContent = 'Evaluating…'; }
  const payload = {
    agentId: $('#agentId').value || undefined,
    intent: {
      chainId: 42220,
      kind: $('#kind').value,
      asset,
      recipient: $('#recipient').value.trim(),
      requestedUsd: Number($('#usd').value),
      amountBaseUnits: baseUnits($('#tokenAmount').value, decimals[asset]),
      intentId: crypto.randomUUID(),
      sessionId
    }
  };
  try {
    paintDecision(await api('/evaluate', { method: 'POST', body: JSON.stringify(payload) }));
  } catch (error) {
    $('#verdict').className = 'verdict block';
    $('#verdict').textContent = 'ERROR';
    $('#verdictCopy').textContent = error.message;
    $('#reasons').innerHTML = '';
    lastDecision = null;
    lastPrepared = null;
    $('#executeButton').classList.add('hidden');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Evaluate intent →'; }
  }
}

async function execute() {
  if (lastDecision?.action !== 'ALLOW' || !lastPrepared) {
    setWalletStatus('Execution boundary is closed until CIRCUIT returns ALLOW.', 'warn');
    return;
  }
  if (!account) await connectWallet();
  if (!account || !walletProvider) return;

  const button = $('#executeButton');
  button.disabled = true;
  button.textContent = 'Confirm in wallet…';
  setWalletStatus(`Requesting ${lastPrepared.asset} signature from your wallet…`);
  try {
    await ensureCelo(walletProvider);
    displayAccount(account, true);
    const hash = await walletProvider.request({
      method: 'eth_sendTransaction',
      params: [{ from: account, to: lastPrepared.to, data: lastPrepared.data, value: '0x0' }]
    });
    const link = $('#txLink');
    link.href = `https://celoscan.io/tx/${hash}`;
    link.textContent = `Mainnet receipt ${hash.slice(0, 10)}… ↗`;
    link.classList.remove('hidden');
    setWalletStatus('Transaction submitted to Celo · receipt available below', 'ok');
  } catch (error) {
    setWalletStatus(error?.code === 4001 ? 'Transaction cancelled in your wallet.' : `Transaction failed · ${error?.message || 'Unknown wallet error'}`, 'warn');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign & execute on Celo';
  }
}

async function runJudge() {
  const summary = $('#judgeSummary');
  summary.textContent = 'Running adversarial matrix…';
  try {
    const data = await api('/judge');
    summary.textContent = `${data.passed} / ${data.total} expected controls matched`;
    summary.classList.toggle('perfect', data.passed === data.total);
    $('#scenarioGrid').innerHTML = data.results.map((item, i) => `<article class="scenario ${item.passed ? 'pass' : ''}"><header><small>${String(i + 1).padStart(2, '0')}</small><b>${item.passed ? '✓' : '✕'}</b></header><strong>${item.title}</strong><div class="outcome">${item.actual}</div><p>${item.reasonCodes.join(' · ') || 'inside mandate'}</p></article>`).join('');
  } catch (error) {
    summary.textContent = `Judge Mode unavailable · ${error.message}`;
  }
}

$('#walletButton').addEventListener('click', connectWallet);
$('#intentForm').addEventListener('submit', evaluate);
$('#executeButton').addEventListener('click', execute);
$('#runJudge').addEventListener('click', runJudge);
$('#runJudgeHero').addEventListener('click', () => { document.querySelector('#judge').scrollIntoView({ behavior: 'smooth' }); runJudge(); });
status();
initializeWallet();
runJudge();
