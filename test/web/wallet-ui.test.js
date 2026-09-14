import test from 'node:test';
import assert from 'node:assert/strict';

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...items) => items.forEach((value) => values.add(value)),
    remove: (...items) => items.forEach((value) => values.delete(value)),
    toggle(value, force) {
      if (force === false) { values.delete(value); return false; }
      if (force === true) { values.add(value); return true; }
      if (values.has(value)) { values.delete(value); return false; }
      values.add(value); return true;
    },
    contains: (value) => values.has(value)
  };
}

function makeElement() {
  const handlers = {};
  const attributes = new Map();
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
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focus() {},
    scrollIntoView() {}
  };
}

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
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
  get('#walletModal').classList.add('hidden');
  get('#walletReconnectAction').classList.add('hidden');
  get('#walletDisconnectAction').classList.add('hidden');
  get('#walletExplorerLink').classList.add('hidden');
  get('#prepared').classList.add('hidden');
  get('#executeButton').classList.add('hidden');
  get('#txLink').classList.add('hidden');

  const eventHandlers = new Map();
  globalThis.window = {
    ethereum,
    localStorage: makeStorage(),
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
    },
    open() {}
  };
  globalThis.navigator = { clipboard: { async writeText() {} } };
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

test('wallet header button opens an explicit connection panel instead of immediately requesting accounts', async () => {
  const calls = [];
  const provider = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_chainId') return '0xa4ec';
      if (payload.method === 'eth_requestAccounts') return ['0x1234567890123456789012345678901234567890'];
      return null;
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  calls.length = 0;

  await get('#walletButton').handlers.click();
  assert.equal(get('#walletModal').classList.contains('hidden'), false);
  assert.equal(calls.includes('eth_requestAccounts'), false);
});

test('wallet panel connect action requests accounts and switches to Celo', async () => {
  const calls = [];
  const provider = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_chainId') return '0x1';
      if (payload.method === 'eth_requestAccounts') return ['0x1234567890123456789012345678901234567890'];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      return [];
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  await get('#walletButton').handlers.click();
  await get('#walletConnectAction').handlers.click();

  const requestIndex = calls.indexOf('eth_requestAccounts');
  const switchIndex = calls.indexOf('wallet_switchEthereumChain');
  assert.ok(requestIndex >= 0);
  assert.equal(switchIndex, requestIndex + 1);
  assert.match(get('#walletStatus').textContent, /Celo|connected/i);
  assert.match(get('#walletProviderName').textContent, /wallet|metamask|injected/i);
  assert.match(get('#walletAddress').textContent, /^0x1234/i);
});

test('passively discovered account on another chain is not mislabeled as executable on Celo', async () => {
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

test('EIP-6963 MetaMask still wins over a broken legacy window.ethereum provider through the modal', async () => {
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
  await get('#walletConnectAction').handlers.click();
  assert.ok(calls.includes('eth_requestAccounts'));
  assert.match(get('#walletStatus').textContent, /Celo|connected/i);
  assert.equal(get('#walletProviderName').textContent, 'MetaMask');
});

test('disconnect action clears visible wallet and executable preparation even if wallet permission revocation is unsupported', async () => {
  const provider = {
    async request(payload) {
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_chainId') return '0xa4ec';
      if (payload.method === 'eth_requestAccounts') return ['0x1234567890123456789012345678901234567890'];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      if (payload.method === 'wallet_revokePermissions') throw Object.assign(new Error('unsupported'), { code: -32601 });
      return null;
    },
    on() {}
  };
  const { get } = await loadApp({ ethereum: provider });
  await get('#walletButton').handlers.click();
  await get('#walletConnectAction').handlers.click();

  get('#prepared').classList.remove('hidden');
  get('#executeButton').classList.remove('hidden');
  await get('#walletDisconnectAction').handlers.click();

  assert.match(get('#walletButton').textContent, /connect wallet/i);
  assert.match(get('#walletStatus').textContent, /disconnected/i);
  assert.equal(get('#prepared').classList.contains('hidden'), true);
  assert.equal(get('#executeButton').classList.contains('hidden'), true);
  assert.match(get('#walletPermissionNote').textContent, /permission|wallet/i);
  assert.doesNotMatch(get('#walletPermissionNote').textContent, /token approvals? (were|are) revoked/i);
});
