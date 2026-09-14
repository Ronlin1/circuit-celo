export const CELO_CHAIN_HEX = '0xa4ec';
export const WALLET_DISCONNECT_KEY = 'circuit.wallet.disconnected';

const CELO_NETWORK = Object.freeze({
  chainId: CELO_CHAIN_HEX,
  chainName: 'Celo',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: ['https://forno.celo.org'],
  blockExplorerUrls: ['https://celoscan.io']
});

function copyInfo(info) {
  return info ? { ...info } : null;
}

function eventNamed(type) {
  try {
    if (typeof Event === 'function') return new Event(type);
  } catch {}
  return { type };
}

export function createWalletController({ window: win = globalThis.window, onStateChange = () => {}, storage = win?.localStorage } = {}) {
  const announcedProviders = [];
  const boundProviders = new WeakSet();
  let announcementListenerBound = false;
  let state = {
    provider: null,
    providerInfo: null,
    account: null,
    chainId: null,
    connected: false,
    executionAvailable: false,
    status: 'idle',
    error: null
  };

  function getState() {
    return { ...state, providerInfo: copyInfo(state.providerInfo) };
  }

  function emit(patch = {}) {
    state = { ...state, ...patch };
    const snapshot = getState();
    onStateChange(snapshot);
    return snapshot;
  }

  function storageGet(key) {
    try { return storage?.getItem?.(key) ?? null; } catch { return null; }
  }

  function storageSet(key, value) {
    try { storage?.setItem?.(key, value); } catch {}
  }

  function storageRemove(key) {
    try { storage?.removeItem?.(key); } catch {}
  }

  function registerAnnouncement(event) {
    const detail = event?.detail;
    if (!detail?.provider?.request) return;
    const uuid = detail?.info?.uuid;
    const exists = announcedProviders.some((entry) =>
      (uuid && entry.info?.uuid === uuid) || entry.provider === detail.provider
    );
    if (!exists) announcedProviders.push({ info: detail.info || {}, provider: detail.provider });
  }

  function requestAnnouncements() {
    if (!win?.addEventListener || !win?.dispatchEvent) return;
    if (!announcementListenerBound) {
      win.addEventListener('eip6963:announceProvider', registerAnnouncement);
      announcementListenerBound = true;
    }
    try { win.dispatchEvent(eventNamed('eip6963:requestProvider')); } catch {}
  }

  function legacyProviders() {
    const ethereum = win?.ethereum;
    if (!ethereum) return [];
    if (Array.isArray(ethereum.providers) && ethereum.providers.length) return ethereum.providers;
    return [ethereum];
  }

  function chooseProvider() {
    const metamaskAnnouncement = announcedProviders.find(({ info, provider }) =>
      info?.rdns === 'io.metamask' || /metamask/i.test(info?.name || '') || provider?.isMetaMask
    );
    if (metamaskAnnouncement) return metamaskAnnouncement;

    const miniPayAnnouncement = announcedProviders.find(({ info, provider }) =>
      /minipay/i.test(info?.name || '') || /minipay/i.test(info?.rdns || '') || provider?.isMiniPay
    );
    if (miniPayAnnouncement) return miniPayAnnouncement;

    if (announcedProviders[0]) return announcedProviders[0];

    const providers = legacyProviders();
    const provider = providers.find((item) => item?.isMetaMask)
      || providers.find((item) => item?.isMiniPay)
      || providers[0]
      || null;
    if (!provider) return null;
    return {
      provider,
      info: {
        name: provider.isMetaMask ? 'MetaMask' : provider.isMiniPay ? 'MiniPay' : 'Injected wallet',
        rdns: 'legacy'
      }
    };
  }

  async function chainIdOf(provider) {
    try { return String(await provider.request({ method: 'eth_chainId' })).toLowerCase(); }
    catch { return null; }
  }

  async function ensureCelo(provider) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CELO_CHAIN_HEX }] });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [CELO_NETWORK] });
    }
    return CELO_CHAIN_HEX;
  }

  async function requestAccounts(provider) {
    try {
      return await provider.request({ method: 'eth_requestAccounts' });
    } catch (error) {
      if (/Unable to find any account for 60/i.test(error?.message || '')) {
        const existing = await provider.request({ method: 'eth_accounts' }).catch(() => []);
        if (existing?.[0]) return existing;
      }
      throw error;
    }
  }

  function bindProvider(provider) {
    if (!provider || boundProviders.has(provider) || typeof provider.on !== 'function') return;
    boundProviders.add(provider);

    provider.on('accountsChanged', async (accounts) => {
      const account = accounts?.[0] || null;
      if (!account) {
        emit({
          account: null,
          connected: false,
          executionAvailable: false,
          status: 'account-unavailable',
          error: null
        });
        return;
      }
      const chainId = await chainIdOf(provider);
      const onCelo = chainId === CELO_CHAIN_HEX;
      emit({
        account,
        chainId,
        connected: true,
        executionAvailable: onCelo,
        status: onCelo ? 'connected-celo' : 'wrong-network-switch-to-celo',
        error: null
      });
    });

    provider.on('chainChanged', (nextChainId) => {
      const chainId = String(nextChainId || '').toLowerCase();
      const onCelo = chainId === CELO_CHAIN_HEX;
      emit({
        chainId,
        connected: Boolean(state.account),
        executionAvailable: Boolean(state.account) && onCelo,
        status: state.account
          ? (onCelo ? 'connected-celo' : 'wrong-network-switch-to-celo')
          : (onCelo ? 'celo-ready-connect-account' : 'wallet-detected'),
        error: null
      });
    });
  }

  async function discover() {
    requestAnnouncements();
    const chosen = chooseProvider();
    if (!chosen) {
      return emit({
        provider: null,
        providerInfo: null,
        account: null,
        chainId: null,
        connected: false,
        executionAvailable: false,
        status: 'no-wallet',
        error: null
      });
    }
    bindProvider(chosen.provider);
    return emit({
      provider: chosen.provider,
      providerInfo: chosen.info,
      status: 'wallet-detected',
      error: null
    });
  }

  async function refresh() {
    requestAnnouncements();
    if (storageGet(WALLET_DISCONNECT_KEY) === '1') {
      return emit({
        provider: null,
        providerInfo: null,
        account: null,
        chainId: null,
        connected: false,
        executionAvailable: false,
        status: 'disconnected-local',
        error: null
      });
    }

    const chosen = chooseProvider();
    if (!chosen) {
      return emit({
        provider: null,
        providerInfo: null,
        account: null,
        chainId: null,
        connected: false,
        executionAvailable: false,
        status: 'no-wallet',
        error: null
      });
    }

    bindProvider(chosen.provider);
    let accounts = [];
    try { accounts = await chosen.provider.request({ method: 'eth_accounts' }); } catch {}
    if (!accounts?.[0]) {
      return emit({
        provider: chosen.provider,
        providerInfo: chosen.info,
        account: null,
        chainId: await chainIdOf(chosen.provider),
        connected: false,
        executionAvailable: false,
        status: 'wallet-detected',
        error: null
      });
    }

    const chainId = await chainIdOf(chosen.provider);
    const onCelo = chainId === CELO_CHAIN_HEX;
    return emit({
      provider: chosen.provider,
      providerInfo: chosen.info,
      account: accounts[0],
      chainId,
      connected: true,
      executionAvailable: onCelo,
      status: onCelo ? 'connected-celo' : 'wrong-network-switch-to-celo',
      error: null
    });
  }

  async function connect() {
    storageRemove(WALLET_DISCONNECT_KEY);
    requestAnnouncements();
    const chosen = chooseProvider();
    if (!chosen) {
      return emit({
        provider: null,
        providerInfo: null,
        account: null,
        chainId: null,
        connected: false,
        executionAvailable: false,
        status: 'no-wallet',
        error: 'No compatible EVM wallet provider is available.'
      });
    }

    emit({
      provider: chosen.provider,
      providerInfo: chosen.info,
      account: null,
      connected: false,
      executionAvailable: false,
      status: 'connecting',
      error: null
    });

    try {
      const accounts = await requestAccounts(chosen.provider);
      if (!accounts?.[0]) throw new Error('Wallet returned no EVM account.');
      await ensureCelo(chosen.provider);
      bindProvider(chosen.provider);
      return emit({
        provider: chosen.provider,
        providerInfo: chosen.info,
        account: accounts[0],
        chainId: CELO_CHAIN_HEX,
        connected: true,
        executionAvailable: true,
        status: 'connected-celo',
        error: null
      });
    } catch (error) {
      const rejected = error?.code === 4001;
      return emit({
        provider: chosen.provider,
        providerInfo: chosen.info,
        account: null,
        chainId: await chainIdOf(chosen.provider),
        connected: false,
        executionAvailable: false,
        status: rejected ? 'connection-cancelled' : 'connection-failed',
        error: error?.message || 'Unknown wallet error'
      });
    }
  }

  async function disconnect() {
    const provider = state.provider;
    storageSet(WALLET_DISCONNECT_KEY, '1');

    emit({
      provider: null,
      providerInfo: null,
      account: null,
      chainId: null,
      connected: false,
      executionAvailable: false,
      status: 'disconnecting-local',
      error: null
    });

    let permissionRevoked = false;
    let revokeError = null;
    if (provider?.request) {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }]
        });
        permissionRevoked = true;
      } catch (error) {
        revokeError = error;
      }
    }

    return emit({
      provider: null,
      providerInfo: null,
      account: null,
      chainId: null,
      connected: false,
      executionAvailable: false,
      status: permissionRevoked ? 'disconnected' : 'disconnected-local-permission-may-remain',
      error: revokeError?.message || null
    });
  }

  return Object.freeze({ discover, connect, disconnect, refresh, getState });
}
