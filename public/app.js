import { createWalletController } from './js/wallet.js';
import { shortAddress, walletChainLabel, walletStatusView } from './js/ui.js';
import { loadDashboard, renderDashboardModel, paintDashboard } from './js/dashboard.js';
import { loadBalances, submitPreparedTransaction, pollTransactionStatus } from './js/treasury.js';

const $ = (selector) => document.querySelector(selector);
const API = '/api';
const sessionId = crypto.randomUUID();
let account = null;
let walletProvider = null;
let walletState = null;
let publicStatus = null;
let lastPrepared = null;
let lastDecision = null;
let lastTraceId = null;
let dashboardLoading = false;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setWalletStatus(message, tone = '') {
  const node = $('#walletStatus');
  if (!node) return;
  node.textContent = message;
  node.className = `wallet-status ${tone}`.trim();
}

function setHidden(selector, hidden) {
  const node = $(selector);
  if (!node) return;
  node.classList.toggle('hidden', hidden);
}

function clearExecutableState() {
  lastPrepared = null;
  lastDecision = null;
  lastTraceId = null;
  setHidden('#prepared', true);
  setHidden('#executeButton', true);
  setHidden('#txLink', true);
}

function renderWalletState(state) {
  walletState = state;
  account = state.account || null;
  walletProvider = state.provider || null;

  const connected = Boolean(state.connected && state.account);
  const button = $('#walletButton');
  if (button) {
    button.textContent = connected ? shortAddress(state.account) : 'Connect wallet';
    button.classList.toggle('connected', connected);
  }

  const providerName = $('#walletProviderName');
  if (providerName) providerName.textContent = state.providerInfo?.name || (state.status === 'no-wallet' ? 'No wallet detected' : 'Wallet');

  const address = $('#walletAddress');
  if (address) address.textContent = state.account || 'Not connected';

  const chain = $('#walletChain');
  if (chain) chain.textContent = walletChainLabel(state.chainId);

  const explorer = $('#walletExplorerLink');
  if (explorer) {
    if (state.account) {
      explorer.href = `https://celoscan.io/address/${state.account}`;
      explorer.classList.remove('hidden');
    } else {
      explorer.classList.add('hidden');
    }
  }

  const copyAction = $('#walletCopyAction');
  if (copyAction) copyAction.disabled = !state.account;

  setHidden('#walletConnectAction', connected);
  setHidden('#walletReconnectAction', !connected);
  setHidden('#walletDisconnectAction', !connected);

  const view = walletStatusView(state);
  setWalletStatus(view.message, view.tone);

  const permissionNote = $('#walletPermissionNote');
  if (permissionNote) {
    if (state.status === 'disconnected') {
      permissionNote.textContent = 'Wallet account permission was revoked where supported. Token approvals were not changed.';
    } else if (state.status === 'disconnected-local-permission-may-remain' || state.status === 'disconnected-local') {
      permissionNote.textContent = 'Disconnected locally. Your wallet may still retain site permission; token approvals were not changed.';
    } else {
      permissionNote.textContent = 'CIRCUIT never stores your private key. Disconnecting this dapp does not change token approvals.';
    }
  }

  void refreshBalances();
}

const wallet = createWalletController({ window, onStateChange: renderWalletState });

function openWalletModal() {
  const modal = $('#walletModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  $('#walletCloseAction')?.focus?.();
}

function closeWalletModal() {
  const modal = $('#walletModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function connectWallet() {
  const button = $('#walletConnectAction');
  const reconnect = $('#walletReconnectAction');
  if (button) button.disabled = true;
  if (reconnect) reconnect.disabled = true;
  try {
    const state = await wallet.connect();
    return state.account || null;
  } finally {
    if (button) button.disabled = false;
    if (reconnect) reconnect.disabled = false;
  }
}

async function disconnectWallet() {
  clearExecutableState();
  await wallet.disconnect();
}

async function copyWalletAddress() {
  const value = wallet.getState().account;
  if (!value) return;
  try {
    await navigator.clipboard?.writeText?.(value);
    const note = $('#walletPermissionNote');
    if (note) note.textContent = 'Address copied. CIRCUIT never stores your private key or changes token approvals.';
  } catch {
    const note = $('#walletPermissionNote');
    if (note) note.textContent = 'Could not copy automatically. Select the address above to copy it manually.';
  }
}

async function initializeWallet() {
  await wallet.refresh();
}

function balanceCards(balances) {
  return Object.values(balances || {}).map((entry) => {
    const available = entry?.available !== false;
    return `<article class="balance-card ${available ? '' : 'unavailable'}"><small>${escapeHtml(entry?.symbol || 'ASSET')}</small><b>${escapeHtml(entry?.display || 'Unavailable')}</b><span>${available ? 'Connected wallet balance' : 'RPC read unavailable'}</span></article>`;
  }).join('');
}

async function refreshBalances() {
  const node = $('#dashboardBalances');
  if (!node) return;
  const state = walletState || wallet.getState();
  if (!state?.account || !state?.provider) {
    node.innerHTML = '<div class="dashboard-empty compact">Connect a wallet to read live Celo balances.</div>';
    return;
  }
  if (!state.executionAvailable) {
    node.innerHTML = '<div class="dashboard-empty compact">Wallet connected on another network. Switch to Celo to read execution balances.</div>';
    return;
  }
  if (!publicStatus?.assets) {
    node.innerHTML = '<div class="dashboard-empty compact">Waiting for Celo asset configuration…</div>';
    return;
  }
  node.innerHTML = '<div class="dashboard-empty compact">Reading Celo balances…</div>';
  try {
    const balances = await loadBalances(state.provider, state.account, publicStatus);
    node.innerHTML = balanceCards(balances);
  } catch (error) {
    node.innerHTML = `<div class="dashboard-empty compact">Balance reads unavailable · ${escapeHtml(error?.message || 'unknown error')}</div>`;
  }
}

async function refreshDashboard() {
  if (dashboardLoading) return;
  dashboardLoading = true;
  const statusNode = $('#dashboardStatus');
  if (statusNode) statusNode.textContent = 'Refreshing session evidence…';
  try {
    const data = await loadDashboard({ sessionId, walletAddress: wallet.getState().account });
    const model = renderDashboardModel({
      metrics: data.metrics,
      activity: data.activity,
      mandate: publicStatus?.publicMandate || {}
    });
    paintDashboard(model, $);
    if (statusNode) {
      statusNode.textContent = model.empty ? 'Live · no session activity yet' : `Live · ${data.activity.length} recent record${data.activity.length === 1 ? '' : 's'}`;
      statusNode.classList.add('ok');
    }
  } catch (error) {
    if (statusNode) statusNode.textContent = `Dashboard unavailable · ${error?.message || 'unknown error'}`;
  } finally {
    dashboardLoading = false;
  }
}

async function status() {
  try {
    const data = await api('/status');
    publicStatus = data;
    $('#apiStatus').textContent = `● ${data.network.name} · ${data.executionMode}`;
    $('#apiStatus').classList.add('ok');
    $('#executionLabel').textContent = `${data.executionMode} MODE`;
    await Promise.allSettled([refreshDashboard(), refreshBalances()]);
  } catch (error) {
    $('#apiStatus').textContent = `Control plane unavailable · ${error.message}`;
  }
}

function paintDecision(data) {
  lastDecision = data.decision;
  lastPrepared = data.prepared;
  lastTraceId = data.trace?.traceId || null;
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
  if (data.prepared && lastTraceId) {
    prepared.classList.remove('hidden');
    prepared.textContent = `EXECUTABLE CELO PAYLOAD\nto: ${data.prepared.to}\nasset: ${data.prepared.asset}\nrecipient: ${data.prepared.recipient}\nbase units: ${data.prepared.amountBaseUnits}\ndata: ${data.prepared.data.slice(0, 34)}…${data.prepared.data.slice(-18)}\ntrace: ${lastTraceId}`;
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
    await refreshDashboard();
  } catch (error) {
    $('#verdict').className = 'verdict block';
    $('#verdict').textContent = 'ERROR';
    $('#verdictCopy').textContent = error.message;
    $('#reasons').innerHTML = '';
    clearExecutableState();
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Evaluate intent →'; }
  }
}

async function execute() {
  if (lastDecision?.action !== 'ALLOW' || !lastPrepared || !lastTraceId) {
    setWalletStatus('Execution boundary is closed until CIRCUIT returns a traceable ALLOW.', 'warn');
    return;
  }

  const state = wallet.getState();
  if (!state.account || !state.provider || !state.executionAvailable) {
    openWalletModal();
    setWalletStatus(state.account
      ? 'Wallet connected on another network · switch/reconnect on Celo before execution.'
      : 'Connect your wallet from the wallet panel before execution.', 'warn');
    return;
  }

  account = state.account;
  walletProvider = state.provider;
  const button = $('#executeButton');
  button.disabled = true;
  button.textContent = 'Confirm in wallet…';
  setWalletStatus(`Requesting ${lastPrepared.asset} signature from your wallet…`);
  try {
    const submitted = await submitPreparedTransaction({
      decision: lastDecision,
      prepared: lastPrepared,
      provider: walletProvider,
      walletAddress: account,
      sessionId,
      traceId: lastTraceId,
      fetchImpl: fetch
    });
    const hash = submitted.txHash;
    const link = $('#txLink');
    link.href = `https://celoscan.io/tx/${hash}`;
    link.textContent = `Submitted ${hash.slice(0, 10)}… · CeloScan ↗`;
    link.classList.remove('hidden');
    setWalletStatus('Transaction submitted to Celo · confirmation pending.', 'ok');
    await refreshDashboard();

    try {
      const receipt = await pollTransactionStatus({
        sessionId,
        traceId: lastTraceId,
        maxAttempts: 5,
        delayMs: 1500,
        fetchImpl: fetch
      });
      if (receipt.txStatus === 'CONFIRMED') {
        setWalletStatus(`Transaction confirmed on Celo${receipt.blockNumber != null ? ` · block ${receipt.blockNumber}` : ''}.`, 'ok');
        link.textContent = `Confirmed ${hash.slice(0, 10)}… · CeloScan ↗`;
      } else if (receipt.txStatus === 'FAILED') {
        setWalletStatus('Transaction was submitted but failed on Celo. Inspect the CeloScan receipt.', 'warn');
        link.textContent = `Failed ${hash.slice(0, 10)}… · CeloScan ↗`;
      } else {
        setWalletStatus('Transaction submitted to Celo · receipt not confirmed yet.', 'warn');
      }
    } catch (error) {
      setWalletStatus(`Transaction submitted to Celo · confirmation check unavailable · ${error?.message || 'unknown error'}`, 'warn');
    }

    await Promise.allSettled([refreshDashboard(), refreshBalances()]);
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

$('#walletButton').addEventListener('click', openWalletModal);
$('#walletConnectAction')?.addEventListener('click', connectWallet);
$('#walletReconnectAction')?.addEventListener('click', connectWallet);
$('#walletDisconnectAction')?.addEventListener('click', disconnectWallet);
$('#walletCopyAction')?.addEventListener('click', copyWalletAddress);
$('#walletCloseAction')?.addEventListener('click', closeWalletModal);
$('#dashboardRefresh')?.addEventListener('click', refreshDashboard);
$('#intentForm').addEventListener('submit', evaluate);
$('#executeButton').addEventListener('click', execute);
$('#runJudge').addEventListener('click', runJudge);
$('#runJudgeHero').addEventListener('click', () => { document.querySelector('#judge').scrollIntoView({ behavior: 'smooth' }); runJudge(); });
status();
initializeWallet();
runJudge();
