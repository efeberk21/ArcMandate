import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { ARC_NETWORKS } from '@arcmandate/core';
import type { VaultSnapshot, ArcClient } from './chain';
import { readVault } from './chain';
import type { Operation } from './operations';

export const REGISTRY_KEY = 'arcmandate.vault-registry.v1';
export type VaultBookmark = { chainId: number; address: Address; label: string; firstSeenAt: string; lastOpenedAt: string;
  source: 'address' | 'deployment' | 'import'; owner?: Address; publicKey?: Hex; deploymentHash?: Hex; deploymentBlock?: string; checkedAt?: string };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const bookmarkId = (item: Pick<VaultBookmark, 'chainId' | 'address'>) => `${item.chainId}:${item.address.toLowerCase()}`;
const fields = new Set(['chainId','address','label','firstSeenAt','lastOpenedAt','source','owner','publicKey','deploymentHash','deploymentBlock','checkedAt']);
function validBookmark(value: unknown): value is VaultBookmark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as VaultBookmark;
  return Object.keys(item).every(key => fields.has(key)) && [ARC_NETWORKS.testnet.chainId, ARC_NETWORKS.mainnet.chainId].includes(item.chainId as never) &&
    typeof item.address === 'string' && isAddress(item.address) && typeof item.label === 'string' && item.label.length <= 80 &&
    ['address','deployment','import'].includes(item.source) && [item.firstSeenAt, item.lastOpenedAt].every(date => typeof date === 'string' && Number.isFinite(Date.parse(date))) &&
    (!item.owner || isAddress(item.owner)) && (!item.publicKey || /^0x[0-9a-f]{64}$/i.test(item.publicKey)) &&
    (!item.deploymentHash || /^0x[0-9a-f]{64}$/i.test(item.deploymentHash)) && (!item.deploymentBlock || /^[0-9]+$/.test(item.deploymentBlock)) &&
    (!item.checkedAt || Number.isFinite(Date.parse(item.checkedAt)));
}
export function parseRegistry(json: string): VaultBookmark[] {
  if (new TextEncoder().encode(json).length > 512 * 1024) throw new Error('Vault list exceeds 512 KiB.');
  const data = JSON.parse(json);
  if (!data || Object.keys(data).sort().join(',') !== 'vaults,version' || data.version !== 1 || !Array.isArray(data.vaults) || data.vaults.length > 1000 || !data.vaults.every(validBookmark)) throw new Error('Invalid vault card/list. Import public vault metadata only; never a Vault Key backup.');
  const unique = new Map<string,VaultBookmark>();
  for (const item of data.vaults as VaultBookmark[]) unique.set(bookmarkId(item), { ...item, address: getAddress(item.address) });
  return [...unique.values()];
}
export function loadRegistry(storage: Pick<Storage,'getItem'> = localStorage): VaultBookmark[] { return parseRegistry(storage.getItem(REGISTRY_KEY) ?? '{"version":1,"vaults":[]}'); }
export function registryJson(items: VaultBookmark[]) { return JSON.stringify({ version: 1, vaults: items }, null, 2); }
export function repairRegistry(raw:string,replacement:string,storage:Store):VaultBookmark[]{
  if(storage.getItem(REGISTRY_KEY)!==raw)throw new Error('Vault list changed in another tab. Reload recovery first.');
  const imported=parseRegistry(replacement).map(item=>({...item,source:'import' as const,checkedAt:undefined}));let readable:VaultBookmark[]=[];
  try{const original=JSON.parse(raw);if(Array.isArray(original?.vaults))readable=original.vaults.filter(validBookmark);}catch{/* The entire original remains in quarantine. */}
  let merged=registryJson(readable);const temporary={getItem:()=>merged,setItem:(_key:string,value:string)=>{merged=value;}};const result=mergeRegistry(imported,temporary);
  storage.setItem(`arcmandate.registry-quarantine.${crypto.randomUUID()}`,raw);storage.setItem(REGISTRY_KEY,registryJson(result));return result;
}
export function mergeRegistry(items: VaultBookmark[], storage: Store = localStorage, editLabel=false): VaultBookmark[] {
  const all = new Map(loadRegistry(storage).map(item => [bookmarkId(item), item]));
  for (const item of items) {
    if (!validBookmark(item)) throw new Error('Invalid vault metadata.');
    const prior = all.get(bookmarkId(item));
    // Imported claims cannot replace locally verified owner/key/deployment evidence.
    all.set(bookmarkId(item), { ...item, ...prior, lastOpenedAt: item.lastOpenedAt > (prior?.lastOpenedAt ?? '') ? item.lastOpenedAt : prior!.lastOpenedAt,
      ...(item.source !== 'import' ? item : {}), label: editLabel ? item.label : prior?.label || item.label, firstSeenAt: prior?.firstSeenAt ?? item.firstSeenAt });
  }
  const result = [...all.values()]; if (result.length > 1000) throw new Error('Vault list is full; export before removing bookmarks.');
  storage.setItem(REGISTRY_KEY, registryJson(result)); return result;
}
export async function updateRegistry(change: (storage: Store) => VaultBookmark[]): Promise<VaultBookmark[]> {
  if (!navigator.locks) throw new Error('Web Locks are required to update the shared vault list.');
  return navigator.locks.request('arcmandate-vault-registry', () => change(localStorage));
}
export function snapshotBookmark(snapshot: VaultSnapshot, deployment?: Operation): VaultBookmark {
  const now = new Date().toISOString();
  return { chainId: ARC_NETWORKS.testnet.chainId, address: snapshot.address, label: '', firstSeenAt: now, lastOpenedAt: now, source: deployment ? 'deployment' : 'address',
    owner: snapshot.owner, publicKey: snapshot.publicKey, checkedAt: now,
    ...(deployment?.hash && deployment.blockNumber ? { deploymentHash: deployment.originalHash ?? deployment.hash, deploymentBlock: deployment.blockNumber } : {}) };
}
export function migrateOperations(operations: Operation[], storage: Store = localStorage): VaultBookmark[] {
  const candidates = operations.filter(op => op.stage === 'confirmed' && (op.deployedVault || op.vault));
  return mergeRegistry(candidates.map(op => ({ chainId: ARC_NETWORKS[op.network].chainId, address: getAddress(op.deployedVault ?? op.vault!), label: '', source: 'import' as const,
    firstSeenAt: new Date(op.createdAt).toISOString(), lastOpenedAt: new Date(op.createdAt).toISOString(),
    ...(op.action === 'deploy' && op.hash && op.blockNumber ? { deploymentHash: op.originalHash ?? op.hash, deploymentBlock: op.blockNumber } : {}) })), storage);
}
export async function findDeployment(rpc: ArcClient, hash: Hex): Promise<{ snapshot: VaultSnapshot; hash: Hex; block: bigint }> {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Enter the creation transaction hash: 0x followed by 64 hex characters. A public key is not a transaction.');
  if (await rpc.getChainId() !== ARC_NETWORKS.testnet.chainId) throw new Error('Switch the RPC to Arc Testnet.');
  const receipt = await rpc.getTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('This creation transaction reverted. No vault was created.');
  if (!receipt.contractAddress) throw new Error('This is not a direct contract-creation transaction. Use the vault address for a transfer or payment.');
  const tx = await rpc.getTransaction({ hash });
  if (tx.to !== null || tx.chainId !== ARC_NETWORKS.testnet.chainId) throw new Error('This is not a testnet contract creation.');
  const snapshot = await readVault(rpc, receipt.contractAddress, receipt.blockNumber);
  if (!snapshot.trusted || snapshot.owner.toLowerCase() !== tx.from.toLowerCase()) throw new Error('The created contract is not a supported ArcMandate vault.');
  return { snapshot, hash, block: receipt.blockNumber };
}
