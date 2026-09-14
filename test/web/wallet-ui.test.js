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

async function loadApp({ ethereum, eip6963 = [] } = {}) {
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

  const eventHandlers = new Map();
  globalThis.window = {
    ethereum,
    addEventListener(type, fn) {
      const list = eventHandlers.get(type) || [];
      list.push(fn);
      eventHandlers.set(type, list);
    },
    removeEventListener(type, fn) {
      eventHandlers.set(type, (eventHandlers.get(type) || []).filter((x) => x !== fn));
    },
    dispatchEvent(event) {
      if (event.type === 'eip6963:requestProvider') {
        for (const detail of eip6963) {
          for (const fn of eventHandlers.get('eip6963:announceProvider') || []) {
            fn({ type: 'eip6963:announceProvider', detail });
          }
        }
      }
      return true;
    }
  };
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

test('passively discovered account on another chain is not mislabeled as connected on Celo', async () => {
  const provider = {
    async request(payload) {
      if (payload.method === 'eth_accounts') return ['0x1234567890123456789012345678901234567890'];
      if (payload.method === 'eth_chainId') return '0x1';
      return [];
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  assert.match(get('#walletStatus').textContent, /switch to Celo|wrong network/i);
  assert.doesNotMatch(get('#walletStatus').textContent, /^Connected on Celo/i);
});

test('EIP-6963 MetaMask wins over a broken legacy window.ethereum provider', async () => {
  const address = '0x1234567890123456789012345678901234567890';
  const legacy = {
    async request(payload) {
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_requestAccounts') throw new Error('Unable to find any account for 60');
      return [];
    },
    on() {}
  };
  const calls = [];
  const metamask = {
    isMetaMask: true,
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_requestAccounts') return [address];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      if (payload.method === 'eth_chainId') return '0xa4ec';
      return [];
    },
    on() {}
  };
  const { get } = await loadApp({
    ethereum: legacy,
    eip6963: [{ info: { uuid: 'metamask-test', name: 'MetaMask', rdns: 'io.metamask', icon: 'data:image/svg+xml,<svg/>' }, provider: metamask }]
  });
  await get('#walletButton').handlers.click();
  assert.ok(calls.includes('eth_requestAccounts'));
  assert.match(get('#walletStatus').textContent, /Connected on Celo/i);
});
