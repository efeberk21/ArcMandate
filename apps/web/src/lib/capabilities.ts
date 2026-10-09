import { networkLabel } from './release';
import { ARC_NETWORKS } from '@arcmandate/core';
import type { Address, Hex } from 'viem';
import type { VaultSnapshot, Network } from './chain';
import { operationBlockers, sameAddress, type Action, type Operation } from './operations';

export type CapabilityState = {
  network: Network; account: Address | null; walletChain: number | null; provider: boolean;
  vault: Address | null; snapshot: VaultSnapshot | null; readError?: string; checking?: boolean;
  phase: 'locked' | 'generated' | 'restored'; publicKey: Hex | null;
  operations: Operation[]; historyError?: string; busy?: boolean; keyBusy?: boolean; assetsUnavailable?: boolean; locksAvailable: boolean;
};
export type Capability = { allowed: boolean; reasons: string[]; fix: 'connect' | 'switch' | 'refresh' | 'key' | 'pending' | 'session' | null };
export function capability(action: Action, state: CapabilityState): Capability {
  const reasons: string[] = []; let fix: Capability['fix'] = null;
  const add = (message: string, next: Capability['fix'] = null) => { reasons.push(message); fix ??= next; };
  if (!state.provider || !state.account) add('Connect an EVM wallet to continue.', 'connect');
  else if (state.walletChain !== ARC_NETWORKS[state.network].chainId) add(`Switch your wallet to ${networkLabel(state.network)}.`, 'switch');
  if (state.checking) add('Verifying the changed wallet account or network.');
  if (!state.locksAvailable) add('Use a browser with Web Locks support for safe transaction submission.');
  if (state.historyError) add('Resolve the saved operation history before sending.', 'pending');
  if (state.busy) add('Wait for the current operation to finish.');
  if (state.keyBusy && !['owner-freeze','agent-pay','agent-gas'].includes(action)) add('Wait for Vault Key verification or signing to finish.', 'key');
  if (state.assetsUnavailable) add('Reload application files, then check wallet activity.');
  if (state.account && operationBlockers(action, state.network, state.account, state.vault ?? undefined, state.operations).length) add('Reconcile the existing operation for this sender or vault.', 'pending');
  const snapshot = state.snapshot;
  if (action === 'deploy') {
    if (state.vault) add('Choose Create another vault first.');
    if (state.phase !== 'restored' || !state.publicKey) add('Create or select a Vault Key backup, then restore it to verify recovery.', 'key');
  } else {
    if (!state.vault || !snapshot || !sameAddress(state.vault, snapshot.address) || snapshot.chainId !== ARC_NETWORKS[state.network].chainId) add('Open a vault and read its current state.', 'refresh');
    else {
      if (state.readError) add('Refresh the stale vault state before sending.', 'refresh');
      if (!snapshot.trusted) add('This contract build is unverified. Transactions are disabled.');
      if (['start', 'withdraw', 'owner-freeze', 'agent-gas'].includes(action) && !sameAddress(state.account, snapshot.owner)) add('Connect the owner account for this action.', 'connect');
      if (!['owner-freeze', 'agent-pay', 'agent-gas'].includes(action) && (state.phase !== 'restored' || state.publicKey?.toLowerCase() !== snapshot.publicKey.toLowerCase())) add('Restore the Vault Key backup matching this vault.', 'key');
      if (['owner-freeze', 'pq-freeze'].includes(action) && !snapshot.active) add('There is no onchain session to freeze.');
      if (action === 'withdraw' && snapshot.active) add('Freeze the onchain session and wait for confirmation before withdrawing.', 'session');
      if (action === 'agent-pay') {
        if (!sameAddress(state.account, snapshot.policy.agent)) add('Select the configured agent account in your wallet.', 'connect');
        if (!snapshot.active) add('Open a spending session with the owner first.', 'session');
        else if (snapshot.timestamp >= snapshot.policy.expiresAt) add('This session expired. The owner can replace or freeze it.', 'session');
        else if (snapshot.spent >= snapshot.policy.totalBudget) add('The session budget is used. A deposit does not renew it.', 'session');
        if (snapshot.balance === 0n) add('The vault needs a USDC deposit.', 'session');
      }
    }
  }
  return { allowed: reasons.length === 0, reasons, fix };
}
export function walletRole(state: Pick<CapabilityState, 'account' | 'snapshot'>): string {
  if (!state.account) return 'Not connected';
  if (!state.snapshot) return 'Vault creator';
  return sameAddress(state.account, state.snapshot.owner) ? 'Owner' : sameAddress(state.account, state.snapshot.policy.agent) ? 'Agent' : 'Other account / freeze relay';
}
