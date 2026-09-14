import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletController, CELO_CHAIN_HEX } from '../../public/js/wallet.js';

const ADDRESS = '0x1234567890123456789012345678901234567890';
const OTHER = '0x9999999999999999999999999999999999999999';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createWindow({ ethereum = null, announcements = [], storage = createStorage() } = {}) {
  const handlers = new Map();
  return {
    ethereum,
    localStorage: storage,
    addEventListener(type, fn) {
      const list = handlers.get(type) || [];
      list.push(fn);
      handlers.set(type, list);
    },
    removeEventListener(type, fn) {
      handlers.set(type, (handlers.get(type) || []).filter((item) => item !== fn));
    },
    dispatchEvent(event) {
      if (event.type === 'eip6963:requestProvider') {
        for (const detail of announcements) {
          for (const fn of handlers.get('eip6963:announceProvider') || []) fn({ detail });
        }
      }
      return true;
    }
  };
}

function createProvider({ accounts = [], chainId = CELO_CHAIN_HEX, revokeError = null, isMetaMask = false } = {}) {
  const calls = [];
  const listeners = new Map();
  let currentAccounts = [...accounts];
  let currentChain = chainId;
  const provider = {
    isMetaMask,
    calls,
    on(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn));
    },
    emit(type, value) {
      if (type === 'accountsChanged') currentAccounts = [...value];
      if (type === 'chainChanged') currentChain = value;
      for (const fn of listeners.get(type) || []) fn(value);
    },
    async request(payload) {
      calls.push(payload);
      if (payload.method === 'eth_accounts') return [...currentAccounts];
      if (payload.method === 'eth_requestAccounts') return currentAccounts.length ? [...currentAccounts] : [ADDRESS];
      if (payload.method === 'eth_chainId') return currentChain;
      if (payload.method === 'wallet_switchEthereumChain') { currentChain = payload.params[0].chainId; return null; }
      if (payload.method === 'wallet_addEthereumChain') { currentChain = payload.params[0].chainId; return null; }
      if (payload.method === 'wallet_revokePermissions') {
        if (revokeError) throw revokeError;
        currentAccounts = [];
        return null;
      }
      return null;
    }
  };
  return provider;
}

test('EIP-6963 MetaMask remains preferred over a broken legacy injected provider', async () => {
  const legacy = createProvider();
  legacy.request = async ({ method }) => {
    if (method === 'eth_requestAccounts') throw new Error('Unable to find any account for 60');
    if (method === 'eth_accounts') return [];
    return null;
  };
  const metamask = createProvider({ accounts: [ADDRESS], isMetaMask: true });
  const win = createWindow({
    ethereum: legacy,
    announcements: [{ info: { uuid: 'mm', name: 'MetaMask', rdns: 'io.metamask' }, provider: metamask }]
  });
  const controller = createWalletController({ window: win });

  const state = await controller.connect();
  assert.equal(state.account, ADDRESS);
  assert.equal(state.provider, metamask);
  assert.equal(state.providerInfo.rdns, 'io.metamask');
  assert.equal(state.executionAvailable, true);
  assert.ok(metamask.calls.some((call) => call.method === 'eth_requestAccounts'));
});

test('disconnect clears CIRCUIT state immediately, records local marker, and attempts wallet permission revocation', async () => {
  const storage = createStorage();
  const provider = createProvider({ accounts: [ADDRESS], isMetaMask: true });
  const controller = createWalletController({ window: createWindow({ ethereum: provider, storage }) });
  await controller.connect();

  const state = await controller.disconnect();
  assert.equal(state.account, null);
  assert.equal(state.provider, null);
  assert.equal(state.connected, false);
  assert.equal(state.executionAvailable, false);
  assert.equal(storage.getItem('circuit.wallet.disconnected'), '1');
  assert.ok(provider.calls.some((call) => call.method === 'wallet_revokePermissions'));
});

test('unsupported permission revocation still disconnects locally and reconnect clears the marker', async () => {
  const storage = createStorage();
  const provider = createProvider({
    accounts: [ADDRESS],
    revokeError: Object.assign(new Error('method not supported'), { code: -32601 })
  });
  const controller = createWalletController({ window: createWindow({ ethereum: provider, storage }) });
  await controller.connect();

  const disconnected = await controller.disconnect();
  assert.equal(disconnected.account, null);
  assert.match(disconnected.status, /disconnected/i);
  assert.equal(storage.getItem('circuit.wallet.disconnected'), '1');

  const reconnected = await controller.connect();
  assert.equal(reconnected.account, ADDRESS);
  assert.equal(reconnected.executionAvailable, true);
  assert.equal(storage.getItem('circuit.wallet.disconnected'), null);
});

test('passive refresh respects the local disconnect marker and does not silently re-authorize an account', async () => {
  const storage = createStorage({ 'circuit.wallet.disconnected': '1' });
  const provider = createProvider({ accounts: [ADDRESS], isMetaMask: true });
  const controller = createWalletController({ window: createWindow({ ethereum: provider, storage }) });

  const state = await controller.refresh();
  assert.equal(state.account, null);
  assert.equal(state.connected, false);
  assert.equal(state.executionAvailable, false);
  assert.equal(provider.calls.some((call) => call.method === 'eth_accounts'), false);
});

test('account and chain events update state and wrong-chain state closes execution', async () => {
  const provider = createProvider({ accounts: [ADDRESS] });
  const states = [];
  const controller = createWalletController({
    window: createWindow({ ethereum: provider }),
    onStateChange: (state) => states.push(state)
  });
  await controller.connect();

  provider.emit('accountsChanged', [OTHER]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.getState().account, OTHER);

  provider.emit('chainChanged', '0x1');
  assert.equal(controller.getState().chainId, '0x1');
  assert.equal(controller.getState().connected, true);
  assert.equal(controller.getState().executionAvailable, false);
  assert.match(controller.getState().status, /wrong-network|switch-to-celo/i);
  assert.ok(states.length >= 3);
});
