import { getAddress, toHex, type Address, type Hex } from 'viem';
import { ARC_NETWORKS } from '@arcmandate/core';
import type { Network } from './chain';

export type BrowserWallet = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, callback: (...args: unknown[]) => void): void;
  removeListener?(event: string, callback: (...args: unknown[]) => void): void;
};
declare global { interface Window { ethereum?: BrowserWallet } }

export class ContextChanged extends Error {}
export class WalletRequestNotSent extends Error {}

export async function pendingWalletNonce(provider: BrowserWallet, account: Address): Promise<number> {
  let raw: unknown;
  try { raw = await provider.request({ method: 'eth_getTransactionCount', params: [account, 'pending'] }); }
  catch { throw new WalletRequestNotSent('Could not read the wallet pending nonce. No wallet transaction was requested.'); }
  // Some injected wallets expose the JSON-RPC quantity as a number. Accept only
  // an exact, non-negative safe integer; never round or silently choose a nonce.
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw)) {
    const nonce = BigInt(raw);
    if (nonce <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(nonce);
  }
  throw new WalletRequestNotSent(`Wallet returned an invalid pending transaction nonce (received ${typeof raw}). No wallet transaction was requested.`);
}

const disconnectPreference = 'arcmandate.wallet-disconnected.v1';
const accountPreference = 'arcmandate.wallet-account.v1';
export function walletAccountPreference(storage: Pick<Storage, 'getItem'> = localStorage): Address | null {
  try { const value = storage.getItem(accountPreference); return value && /^0x[0-9a-f]{40}$/i.test(value) ? getAddress(value) : null; }
  catch { return null; }
}
export function rememberWalletAccount(account: Address, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(accountPreference, getAddress(account)); } catch { /* This tab can still select an authorized account. */ }
}
export function rememberWalletDisconnect(disconnected: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  // This preference stores no password or key. Storage failure must not block a manual connection.
  try { storage.setItem(disconnectPreference, disconnected ? 'true' : 'false'); } catch { /* optional preference */ }
}

export async function resumeWalletContext(provider: BrowserWallet, storage: Pick<Storage, 'getItem'> = localStorage) {
  try { if (storage.getItem(disconnectPreference) === 'true') return null; } catch { return null; }
  // Read accounts already authorized for this origin; never request fresh permission on load.
  const context = await walletContext(provider, walletAccountPreference(storage));
  return context.account ? context : null;
}

export async function walletContext(provider: BrowserWallet, preferred: Address | null = null): Promise<{ account: Address | null; accounts: Address[]; chainId: number }> {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || accounts.some(value => typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) || typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Wallet returned an invalid account or chain');
  const authorized = [...new Set(accounts.map(value => getAddress(value)))];
  // A saved public address is a preference, never authority. Removal does not
  // silently switch to another sender, even if another account remains exposed.
  return { account: preferred ? authorized.find(value => value === getAddress(preferred)) ?? null : authorized[0] ?? null, accounts: authorized, chainId: Number(BigInt(chain)) };
}

export async function assertWallet(provider: BrowserWallet, account: Address, chainId: number): Promise<void> {
  const current = await walletContext(provider);
  if (current.chainId !== chainId) throw new ContextChanged('Wallet network changed. Review the action again.');
  if (!current.accounts.includes(getAddress(account))) throw new ContextChanged('Wallet account changed. Review the action again.');
}

export async function switchNetwork(provider: BrowserWallet, network: Network): Promise<void> {
  const config = ARC_NETWORKS[network];
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(config.chainId) }] });
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: toHex(config.chainId), chainName: network === 'testnet' ? 'Arc Testnet' : 'Arc',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: [config.rpcUrl], blockExplorerUrls: [config.explorerUrl],
    }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(config.chainId) }] });
  }
}

export async function sendWalletTransaction(provider: BrowserWallet, transaction: {
  from: Address; to?: Address; data: Hex; gas: bigint; chainId: number; walletNonce?: number;
}): Promise<Hex> {
  await assertWallet(provider, transaction.from, transaction.chainId);
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{
    from: transaction.from, ...(transaction.to ? { to: transaction.to } : {}), data: transaction.data,
    gas: toHex(transaction.gas), chainId: toHex(transaction.chainId),
    ...(transaction.walletNonce !== undefined ? { nonce: toHex(transaction.walletNonce) } : {}),
  }] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Wallet did not return a transaction hash');
  return hash as Hex;
}
