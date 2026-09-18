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

function textResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() { return JSON.stringify(payload); },
    async json() { return payload; }
  };
}

async function loadApp({ ethereum, eip6963 = [], fetchImpl } = {}) {
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
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { async writeText() {} } },
    configurable: true
  });
  globalThis.document = { querySelector: get };
  globalThis.fetch = fetchImpl || (async (url) => {
    const payload = String(url).includes('/judge')
      ? { total: 8, passed: 8, results: [] }
      : { network: { name: 'Celo Mainnet' }, executionMode: 'PREPARE' };
    return textResponse(payload);
  });

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

test('executed ALLOW binds the wallet hash to its authorization trace before receipt reconciliation', async () => {
  const walletAddress = '0x1234567890123456789012345678901234567890';
  const txHash = `0x${'c'.repeat(64)}`;
  const traceId = 'trace-submit-ui';
  const callOrder = [];
  const submittedBodies = [];
  const provider = {
    async request(payload) {
      if (payload.method === 'eth_accounts') return [];
      if (payload.method === 'eth_chainId') return '0xa4ec';
      if (payload.method === 'eth_requestAccounts') return [walletAddress];
      if (payload.method === 'wallet_switchEthereumChain') return null;
      if (payload.method === 'eth_getBalance') return '0x0';
      if (payload.method === 'eth_sendTransaction') {
        callOrder.push('wallet-send');
        return txHash;
      }
      return [];
    },
    on() {}
  };

  const fetchImpl = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/status')) {
      return textResponse({
        network: { name: 'Celo Mainnet' }, executionMode: 'PREPARE', assets: {},
        publicMandate: { maxDailySpendUsd: 100, maxPaymentUsd: 20, maxX402Usd: 2 }
      });
    }
    if (path.includes('/api/judge')) return textResponse({ total: 8, passed: 8, results: [] });
    if (path.includes('/api/metrics')) return textResponse({ counts: { ALLOW: 0, BLOCK: 0, REVIEW: 0, PAUSE: 0 }, totalAuthorizedUsd: 0, protectedOrReviewedUsd: 0, confirmedTransactions: 0 });
    if (path.includes('/api/activity')) return textResponse({ items: [] });
    if (path.includes('/api/evaluate')) {
      return textResponse({
        decision: { action: 'ALLOW', reasonCodes: [] },
        prepared: {
          to: '0x0000000000000000000000000000000000000001',
          asset: 'USAT',
          recipient: '0x1111111111111111111111111111111111111111',
          amountBaseUnits: '5000000',
          data: `0xa9059cbb${'0'.repeat(128)}`
        },
        trace: { traceId }
      });
    }
    if (path.includes('/api/transaction-submitted')) {
      callOrder.push('submitted');
      const body = JSON.parse(options.body);
      submittedBodies.push(body);
      return textResponse({ ...body, txStatus: 'SUBMITTED' });
    }
    if (path.includes('/api/transaction-status')) {
      callOrder.push('reconcile');
      return textResponse({ traceId, txHash, txStatus: 'CONFIRMED', blockNumber: 12345 });
    }
    throw new Error(`unexpected URL ${path}`);
  };

  const { get } = await loadApp({ ethereum: provider, fetchImpl });
  await get('#walletButton').handlers.click();
  await get('#walletConnectAction').handlers.click();

  const submitter = makeElement();
  await get('#intentForm').handlers.submit({ preventDefault() {}, submitter });
  assert.equal(get('#executeButton').classList.contains('hidden'), false);
  await get('#executeButton').handlers.click();

  assert.equal(submittedBodies.length, 1);
  assert.equal(submittedBodies[0].traceId, traceId);
  assert.equal(submittedBodies[0].txHash, txHash);
  assert.equal(submittedBodies[0].walletAddress, walletAddress);
  assert.deepEqual(callOrder.slice(0, 3), ['wallet-send', 'submitted', 'reconcile']);
  assert.match(get('#walletStatus').textContent, /confirmed|submitted|pending/i);
});