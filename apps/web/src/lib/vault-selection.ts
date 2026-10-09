import { getAddress, isAddress, type Address } from 'viem';
import type { Network } from './chain';
import type { Operation } from './operations';

const key = 'arcmandate.vault-selection.v1';
export type VaultSelection = { address: Address | null; setup: boolean; recover: boolean };

export function initialVaultSelection(url: URL, storage: Pick<Storage, 'getItem'> = localStorage, network: Network = 'testnet'): VaultSelection {
  const empty = { address: null, setup: false, recover: true };
  // An explicit incompatible network or address must never silently open a different saved vault.
  if (url.searchParams.has('network') && url.searchParams.get('network') !== network) return { ...empty, recover: false };
  if (url.searchParams.has('vault')) {
    const address = url.searchParams.get('vault')!;
    return { ...empty, address: isAddress(address) ? getAddress(address) : null, recover: false };
  }
  try {
    const saved = JSON.parse(storage.getItem(network === 'testnet' ? key : `${key}:mainnet`) ?? 'null');
    if (saved?.network !== network) return empty;
    if (saved.setup === true && saved.address === null) return { address: null, setup: true, recover: false };
    if (typeof saved.address === 'string' && isAddress(saved.address)) return { address: getAddress(saved.address), setup: false, recover: false };
  } catch { /* Optional navigation preference; chain identity is always checked after loading. */ }
  return empty;
}

export function rememberVaultSelection(address: Address | null, storage: Pick<Storage, 'setItem'> = localStorage, network: Network = 'testnet'): void {
  try { storage.setItem(network === 'testnet' ? key : `${key}:mainnet`, JSON.stringify({ network, address, setup: address === null })); } catch { /* URL remains a fallback. */ }
}

export function latestAccountVault(operations: Operation[], account: Address, network: Network = 'testnet'): Address | null {
  const candidates = operations.filter((op) => op.network === network && op.stage === 'confirmed' && op.account.toLowerCase() === account.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const op of candidates) {
    const address = op.deployedVault ?? op.vault;
    if (address && isAddress(address)) return getAddress(address);
  }
  return null;
}
