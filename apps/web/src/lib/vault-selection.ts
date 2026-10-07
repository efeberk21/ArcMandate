import { getAddress, isAddress, type Address } from 'viem';
import type { Operation } from './operations';

const key = 'arcmandate.vault-selection.v1';
export type VaultSelection = { address: Address | null; setup: boolean; recover: boolean };

export function initialVaultSelection(url: URL, storage: Pick<Storage, 'getItem'> = localStorage): VaultSelection {
  const empty = { address: null, setup: false, recover: true };
  // An explicit incompatible network or address must never silently open a different saved vault.
  if (url.searchParams.get('network') === 'mainnet') return { ...empty, recover: false };
  if (url.searchParams.has('vault')) {
    const address = url.searchParams.get('vault')!;
    return { ...empty, address: isAddress(address) ? getAddress(address) : null, recover: false };
  }
  try {
    const saved = JSON.parse(storage.getItem(key) ?? 'null');
    if (saved?.network !== 'testnet') return empty;
    if (saved.setup === true && saved.address === null) return { address: null, setup: true, recover: false };
    if (typeof saved.address === 'string' && isAddress(saved.address)) return { address: getAddress(saved.address), setup: false, recover: false };
  } catch { /* Optional navigation preference; chain identity is always checked after loading. */ }
  return empty;
}

export function rememberVaultSelection(address: Address | null, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(key, JSON.stringify({ network: 'testnet', address, setup: address === null })); } catch { /* URL remains a fallback. */ }
}

export function latestAccountVault(operations: Operation[], account: Address): Address | null {
  const candidates = operations.filter((op) => op.network === 'testnet' && op.stage === 'confirmed' && op.account.toLowerCase() === account.toLowerCase())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const op of candidates) {
    const address = op.deployedVault ?? op.vault;
    if (address && isAddress(address)) return getAddress(address);
  }
  return null;
}
