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
  globalThis.fetch = async (url) => ({
    ok: true,
    async json() {
      if (String(url).includes('/judge')) return { total: 8, passed: 8, results: [] };
      return { network: { name: 'Celo Mainnet' }, executionMode: 'PREPARE' };
    }
  });

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

test('wallet connection requests accounts and switches to Celo immediately', async () => {
  const calls = [];
  const provider = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_requestAccounts') return ['0x1234567890123456789012345678901234567890'];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      if (payload.method === 'eth_chainId') return '0xa4ec';
      return [];
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  await get('#walletButton').handlers.click();
  assert.deepEqual(calls.slice(0, 2), ['eth_requestAccounts', 'wallet_switchEthereumChain']);
  assert.match(get('#walletStatus').textContent, /Celo|connected/i);
});
