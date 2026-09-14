import test from 'node:test';
import assert from 'node:assert/strict';

function makeClassList() {
  const values = new Set();
  return { add: (...x) => x.forEach((v) => values.add(v)), remove: (...x) => x.forEach((v) => values.delete(v)), toggle: (v, force) => force === false ? values.delete(v) : values.add(v), contains: (v) => values.has(v) };
}

function makeElement() {
  const handlers = {};
  return {
    handlers,
    textContent: '',
    innerHTML: '',
    value: '',
    href: '',
    className: '',
    disabled: false,
    classList: makeClassList(),
    addEventListener(type, fn) { handlers[type] = fn; },
    scrollIntoView() {}
  };
}

async function loadApp({ ethereum } = {}) {
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  };
  get('#asset').value = 'USAT';
  get('#kind').value = 'TRANSFER';
  get('#recipient').value = '0x1111111111111111111111111111111111111111';
  get('#usd').value = '5';
  get('#tokenAmount').value = '5';
  get('#agentId').value = '';

  globalThis.window = { ethereum };
  globalThis.document = { querySelector: get };
  globalThis.fetch = async (url) => {
    const payload = String(url).includes('/judge')
      ? { total: 8, passed: 8, results: [] }
      : { network: { name: 'Celo Mainnet' }, executionMode: 'PREPARE' };
    return { ok: true, status: 200, async text() { return JSON.stringify(payload); } };
  };

  await import(`../../public/app.js?wallet-test=${Date.now()}-${Math.random()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { elements, get };
}

test('wallet button gives visible recovery state when no injected wallet exists', async () => {
  const { get } = await loadApp();
  const button = get('#walletButton');
  await assert.doesNotReject(async () => button.handlers.click());
  assert.match(button.textContent, /wallet|install/i);
  assert.match(get('#walletStatus').textContent, /MetaMask|MiniPay|wallet/i);
});

test('wallet connection requests accounts and then switches to Celo', async () => {
  const calls = [];
  const provider = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_requestAccounts') return ['0x1234567890123456789012345678901234567890'];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      return [];
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  await get('#walletButton').handlers.click();
  const requestIndex = calls.indexOf('eth_requestAccounts');
  const switchIndex = calls.indexOf('wallet_switchEthereumChain');
  assert.ok(requestIndex >= 0);
  assert.equal(switchIndex, requestIndex + 1);
  assert.match(get('#walletStatus').textContent, /Celo|connected/i);
});
