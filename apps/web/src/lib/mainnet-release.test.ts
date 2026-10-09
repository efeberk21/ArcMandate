import { describe, expect, it } from 'vitest';
import { expectedVaultRuntime } from '@arcmandate/core/runtime';
import { PQ_VERIFIER_ADDRESS, USDC_ADDRESS } from '@arcmandate/core';
import { capability, type CapabilityState } from './capabilities';
import { readVault, type ArcClient, type VaultSnapshot } from './chain';
import { loadPaymentDrafts, newPaymentDraft, savePaymentDraft, validatePayment } from './payment-drafts';
import { findDeployment, mergeRegistry, loadRegistry, snapshotBookmark } from './vault-registry';
import { initialVaultSelection, latestAccountVault, rememberVaultSelection } from './vault-selection';
import type { Operation } from './operations';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x2222222222222222222222222222222222222222';
const agent = '0x3333333333333333333333333333333333333333';
const key = `0x${'ab'.repeat(32)}` as const;
const snapshot: VaultSnapshot = { chainId: 5042, address: vault, owner, publicKey: key, trusted: true,
  sessionId: 1n, nonce: 1n, active: true, spent: 0n, balance: 1_000_000n, blockNumber: 100n, timestamp: 1000n,
  policy: { agent, totalBudget: 1_000_000n, perTxCap: 100_000n, expiresAt: 2000n, recipients: [owner] } };
const operation: Operation = { id: 'created', action: 'deploy', account: owner, network: 'mainnet', stage: 'confirmed',
  deployedVault: vault, createdAt: '2026-10-09T00:00:00Z', dataHash: key };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } };
}

describe('mainnet release isolation', () => {
  it('keeps independent remembered selections and rejects links from another release network', () => {
    const saved = storage();
    rememberVaultSelection(owner, saved);
    rememberVaultSelection(vault, saved, 'mainnet');
    expect(initialVaultSelection(new URL('https://app.example/?network=mainnet'), saved, 'mainnet').address).toBe(vault);
    expect(initialVaultSelection(new URL('https://app.example/?network=testnet'), saved).address).toBe(owner);
    expect(initialVaultSelection(new URL(`https://app.example/?network=testnet&vault=${vault}`), saved, 'mainnet')).toMatchObject({ address: null, recover: false });
    expect(latestAccountVault([operation], owner)).toBeNull();
    expect(latestAccountVault([operation], owner, 'mainnet')).toBe(vault);
  });
  it('keeps same-address bookmarks and payment requests bound to their actual chain', () => {
    const saved = storage();
    const testnet = { ...snapshot, chainId: 5042002 as const };
    mergeRegistry([snapshotBookmark(snapshot), snapshotBookmark(testnet)], saved);
    expect(loadRegistry(saved).map(item => item.chainId).sort()).toEqual([5042, 5042002]);
    const draft = newPaymentDraft(snapshot, agent, owner, 10000n);
    savePaymentDraft(draft, saved);
    expect(loadPaymentDrafts(saved)[0].chainId).toBe(5042);
    expect(() => validatePayment(testnet, draft, [])).toThrow('another network');
    expect(() => snapshotBookmark(snapshot, { ...operation, network: 'testnet' })).toThrow('another network');
  });
  it('preserves runtime, wallet, owner, PQ and unknown-operation gates on mainnet', () => {
    const state: CapabilityState = { network: 'mainnet', account: owner, walletChain: 5042, provider: true, vault, snapshot,
      phase: 'restored', publicKey: key, operations: [], locksAvailable: true };
    expect(capability('start', state).allowed).toBe(true);
    const changedStates: CapabilityState[] = [
      { ...state, walletChain: 5042002 }, { ...state, account: agent }, { ...state, publicKey: null },
      { ...state, snapshot: { ...snapshot, chainId: 5042002 as const } },
      { ...state, snapshot: { ...snapshot, trusted: false } },
      { ...state, operations: [{ ...operation, stage: 'unknown' as const }] },
    ];
    for (const changed of changedStates) expect(capability('start', changed).allowed).toBe(false);
  });
  it('verifies direct creation on the configured mainnet and rejects a testnet transaction hash', async () => {
    const fields: Record<string, unknown> = { owner, pqPublicKey: key, sessionId: 1n, controlNonce: 1n, active: true,
      currentPolicy: snapshot.policy, spent: 0n, balanceOf: snapshot.balance, USDC_ADDRESS, PQ_VERIFIER_ADDRESS };
    let txChain = 5042;
    const rpc = { chain: { id: 5042 }, getChainId: async () => 5042,
      getBlock: async () => ({ number: 100n, timestamp: 1000n }),
      getTransactionReceipt: async () => ({ status: 'success', contractAddress: vault, blockNumber: 100n }),
      getTransaction: async () => ({ from: owner, to: null, chainId: txChain }),
      readContract: async ({ functionName }: { functionName: string }) => fields[functionName],
      getBytecode: async () => expectedVaultRuntime(owner, key) } as unknown as ArcClient;
    expect((await readVault(rpc, vault)).chainId).toBe(5042);
    expect((await findDeployment(rpc, key)).snapshot.trusted).toBe(true);
    txChain = 5042002;
    await expect(findDeployment(rpc, key)).rejects.toThrow('selected Arc network');
  });
});
