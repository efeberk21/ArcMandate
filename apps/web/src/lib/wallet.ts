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

export async function walletContext(provider: BrowserWallet): Promise<{ account: Address | null; chainId: number }> {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]);
  if (!Array.isArray(accounts) || typeof chain !== 'string') throw new Error('Wallet returned an invalid account or chain');
  return { account: accounts.length ? getAddress(String(accounts[0])) : null, chainId: Number(BigInt(chain)) };
}

export async function assertWallet(provider: BrowserWallet, account: Address, chainId: number): Promise<void> {
  const current = await walletContext(provider);
  if (current.chainId !== chainId) throw new ContextChanged('Wallet network changed. Review the action again.');
  if (current.account !== getAddress(account)) throw new ContextChanged('Wallet account changed. Review the action again.');
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
  from: Address; to?: Address; data: Hex; gas: bigint; chainId: number;
}): Promise<Hex> {
  await assertWallet(provider, transaction.from, transaction.chainId);
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{
    from: transaction.from, ...(transaction.to ? { to: transaction.to } : {}), data: transaction.data,
    gas: toHex(transaction.gas), chainId: toHex(transaction.chainId),
  }] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Wallet did not return a transaction hash');
  return hash as Hex;
}
