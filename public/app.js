const $ = (selector) => document.querySelector(selector);
const API = '/api';
let account = null;
let lastPrepared = null;
let lastDecision = null;
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
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function status() {
  try {
    const data = await api('/status');
    $('#apiStatus').textContent = `● ${data.network.name} · ${data.executionMode}`;
    $('#apiStatus').classList.add('ok');
    $('#executionLabel').textContent = `${data.executionMode} MODE`;
  } catch (error) { $('#apiStatus').textContent = `Control plane unavailable · ${error.message}`; }
}

async function connectWallet() {
  if (!window.ethereum) return alert('Install an EVM wallet such as MetaMask or use MiniPay, then reload.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  account = accounts[0];
  const button = $('#walletButton');
  button.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  button.classList.add('connected');
}

async function ensureCelo() {
  const chainId = '0xa4ec';
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'Celo', nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 }, rpcUrls: ['https://forno.celo.org'], blockExplorerUrls: ['https://celoscan.io'] }] });
  }
}

function paintDecision(data) {
  lastDecision = data.decision;
  lastPrepared = data.prepared;
  const action = data.decision.action;
  const verdict = $('#verdict');
  verdict.className = `verdict ${action.toLowerCase()}`;
  verdict.textContent = action;
  const copy = { ALLOW: 'Intent is inside the active mandate. The execution gateway may open.', BLOCK: 'A hard mandate constraint failed. No transaction payload is executable.', PAUSE: 'Sequence risk detected. Automatic execution is frozen until state is reconciled.', REVIEW: 'The action needs explicit human review before execution.', RESIZE: 'The action may proceed only at a reduced size.' };
  $('#verdictCopy').textContent = copy[action] || 'Decision returned.';
  $('#reasons').innerHTML = data.decision.reasonCodes.map((code) => `<span class="reason">${code}</span>`).join('') || '<span class="reason">NO POLICY VIOLATIONS</span>';
  const prepared = $('#prepared');
  const execute = $('#executeButton');
  $('#txLink').classList.add('hidden');
  if (data.prepared) {
    prepared.classList.remove('hidden');
    prepared.innerHTML = `<b>EXECUTABLE CELO PAYLOAD</b><br>to: ${data.prepared.to}<br>asset: ${data.prepared.asset}<br>recipient: ${data.prepared.recipient}<br>base units: ${data.prepared.amountBaseUnits}<br>data: ${data.prepared.data.slice(0, 34)}…${data.prepared.data.slice(-18)}<br>trace: ${data.trace.traceId}`;
    execute.classList.remove('hidden');
  } else { prepared.classList.add('hidden'); execute.classList.add('hidden'); }
  $('#coreState').textContent = action;
}

async function evaluate(event) {
  event.preventDefault();
  const asset = $('#asset').value;
  const intentId = crypto.randomUUID();
  const payload = {
    agentId: $('#agentId').value || undefined,
    intent: {
      chainId: 42220,
      kind: $('#kind').value,
      asset,
      recipient: $('#recipient').value.trim(),
      requestedUsd: Number($('#usd').value),
      amountBaseUnits: baseUnits($('#tokenAmount').value, decimals[asset]),
      intentId
    },
    context: { dailySpendUsd: 0, recentIntentIds: [] }
  };
  try { paintDecision(await api('/evaluate', { method: 'POST', body: JSON.stringify(payload) })); }
  catch (error) { $('#verdict').className = 'verdict block'; $('#verdict').textContent = 'ERROR'; $('#verdictCopy').textContent = error.message; }
}

async function execute() {
  if (lastDecision?.action !== 'ALLOW' || !lastPrepared) return alert('CIRCUIT execution boundary is closed.');
  if (!account) await connectWallet();
  if (!account) return;
  await ensureCelo();
  if (!confirm(`Sign ${lastPrepared.asset} transfer to ${lastPrepared.recipient}?\n\nCIRCUIT verdict: ALLOW\nYour wallet remains the signer.`)) return;
  const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: lastPrepared.to, data: lastPrepared.data, value: '0x0' }] });
  const link = $('#txLink');
  link.href = `https://celoscan.io/tx/${hash}`;
  link.textContent = `Mainnet receipt ${hash.slice(0, 10)}… ↗`;
  link.classList.remove('hidden');
}

async function runJudge() {
  const summary = $('#judgeSummary');
  summary.textContent = 'Running adversarial matrix…';
  try {
    const data = await api('/judge');
    summary.textContent = `${data.passed} / ${data.total} expected controls matched`;
    summary.classList.toggle('perfect', data.passed === data.total);
    $('#scenarioGrid').innerHTML = data.results.map((item, i) => `<article class="scenario ${item.passed ? 'pass' : ''}"><header><small>${String(i + 1).padStart(2, '0')}</small><b>${item.passed ? '✓' : '✕'}</b></header><strong>${item.title}</strong><div class="outcome">${item.actual}</div><p>${item.reasonCodes.join(' · ') || 'inside mandate'}</p></article>`).join('');
  } catch (error) { summary.textContent = error.message; }
}

$('#walletButton').addEventListener('click', connectWallet);
$('#intentForm').addEventListener('submit', evaluate);
$('#executeButton').addEventListener('click', execute);
$('#runJudge').addEventListener('click', runJudge);
$('#runJudgeHero').addEventListener('click', () => { document.querySelector('#judge').scrollIntoView({ behavior: 'smooth' }); runJudge(); });
status();
runJudge();
