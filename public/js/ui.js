import { CELO_CHAIN_HEX } from './wallet.js';

export function shortAddress(address) {
  const value = String(address || '');
  if (!value) return 'Not connected';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function walletChainLabel(chainId) {
  const normalized = String(chainId || '').toLowerCase();
  if (!normalized) return 'Not selected';
  if (normalized === CELO_CHAIN_HEX) return 'Celo Mainnet · 42220';
  return `Wrong network · ${normalized}`;
}

export function walletStatusView(state = {}) {
  const name = state.providerInfo?.name || 'Wallet';
  switch (state.status) {
    case 'connected-celo':
      return { message: `${name} connected on Celo · wallet remains the signer`, tone: 'ok' };
    case 'wrong-network-switch-to-celo':
      return { message: `${name} connected · switch to Celo before execution`, tone: 'warn' };
    case 'connecting':
      return { message: `Requesting ${name} access…`, tone: '' };
    case 'connection-cancelled':
      return { message: 'Connection cancelled in your wallet.', tone: 'warn' };
    case 'connection-failed': {
      const raw = state.error || 'Unknown wallet error';
      const hint = /Unable to find any account for 60/i.test(raw)
        ? ' Select a MetaMask account with a 0x Ethereum/EVM address, then reconnect.'
        : '';
      return { message: `Wallet connection failed · ${raw}.${hint}`, tone: 'warn' };
    }
    case 'no-wallet':
      return { message: 'No injected wallet found. Open CIRCUIT in MetaMask/MiniPay, or install an EVM wallet.', tone: 'warn' };
    case 'disconnected':
      return { message: 'Wallet disconnected from CIRCUIT.', tone: '' };
    case 'disconnected-local':
    case 'disconnected-local-permission-may-remain':
      return { message: 'Wallet disconnected from CIRCUIT · wallet-side site permission may remain.', tone: '' };
    case 'disconnecting-local':
      return { message: 'Disconnecting wallet from CIRCUIT…', tone: '' };
    case 'account-unavailable':
      return { message: `${name} has no exposed account · reconnect to continue.`, tone: 'warn' };
    case 'celo-ready-connect-account':
      return { message: 'Celo network selected · connect a wallet account to enable execution.', tone: 'ok' };
    case 'wallet-detected':
      return { message: `${name} detected · connect to authorize mainnet execution`, tone: '' };
    default:
      return { message: 'Checking wallet…', tone: '' };
  }
}
