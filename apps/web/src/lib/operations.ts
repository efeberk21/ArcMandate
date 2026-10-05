import { decodeEventLog, getAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { matchesVaultRuntime } from '@arcmandate/core/runtime';
import { USDC_ADDRESS } from '@arcmandate/core';
import type { ArcClient, Network } from './chain';
import type { Receipt, TransactionInput, TransactionState } from './transactions';

export type Action = 'deploy' | 'fund' | 'start' | 'owner-freeze' | 'pq-freeze' | 'withdraw';
export type Operation = {
  id: string; network: Network; account: Address; action: Action; vault?: Address;
  to?: Address; dataHash: Hex; hash?: Hex; stage: TransactionState['stage']; createdAt: string;
  sessionId?: string; nonce?: string; amount?: string; recipient?: Address; publicKey?: Hex; message?: string;
  blockNumber?: string; deployedVault?: Address;
};
const key = 'arcmandate.operations.v1';
const terminal = new Set(['confirmed', 'reverted', 'cancelled', 'wallet-rejected', 'simulation-rejected']);
export const unresolvedOperation = (op: Operation) => !terminal.has(op.stage);

export function loadOperations(storage: Pick<Storage, 'getItem'> = localStorage): Operation[] {
  const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
  if (!Array.isArray(value) || value.length > 500 || value.some((op) => !op || typeof op.id !== 'string' ||
    !['testnet', 'mainnet'].includes(op.network) || !/^0x[0-9a-f]{40}$/i.test(op.account) ||
    !/^0x[0-9a-f]{64}$/i.test(op.dataHash) || (op.hash && !/^0x[0-9a-f]{64}$/i.test(op.hash)) ||
    !['deploy','fund','start','owner-freeze','pq-freeze','withdraw'].includes(op.action) ||
    !['wallet','submitted','unknown','confirmed','cancelled','reverted','wallet-rejected','simulation-rejected'].includes(op.stage))) {
    throw new Error('Invalid stored operation history; reconcile wallet activity before submitting');
  }
  return value;
}
export function saveOperation(op: Operation, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Operation[] {
  const existing = loadOperations(storage);
  const next = [...existing.filter((item) => item.id !== op.id), op];
  // Never evict an unresolved operation.
  const pending = next.filter(unresolvedOperation);
  const records = [...next.filter((item) => !unresolvedOperation(item)).slice(-100), ...pending];
  storage.setItem(key, JSON.stringify(records));
  return records;
}
export function canSubmitOperation(action: Action, network: Network, account: Address, vault: Address | undefined, ops: Operation[]): boolean {
  const pending = ops.filter((op) => op.network === network && unresolvedOperation(op));
  if (pending.some((op) => op.account.toLowerCase() === account.toLowerCase())) return false;
  if (action === 'pq-freeze' || action === 'owner-freeze') return true;
  return !pending.some((op) => op.vault?.toLowerCase() === vault?.toLowerCase());
}
const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export async function operationReceipt(rpc: ArcClient, op: Operation, hash: Hex): Promise<Receipt> {
  let replacementReason: string | undefined;
  const mined = await rpc.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1500,
    onReplaced: (replacement) => { replacementReason = replacement.reason; } });
  let tx;
  try { tx = await rpc.getTransaction({ hash: mined.transactionHash }); }
  catch { return { ...mined, effectVerified: false, replacementReason }; }
  const intentMatches = tx.from.toLowerCase() === op.account.toLowerCase() &&
    tx.to?.toLowerCase() === op.to?.toLowerCase() && keccak256(tx.input) === op.dataHash && tx.value === 0n;
  let effectVerified = false;
  if (intentMatches && mined.status === 'success') {
    if (op.action === 'deploy' && mined.contractAddress && op.publicKey) {
      effectVerified = matchesVaultRuntime(await rpc.getBytecode({ address: mined.contractAddress, blockNumber: mined.blockNumber }), op.account, op.publicKey);
    } else {
      effectVerified = mined.logs.some((log) => {
        try {
          if (op.action === 'fund') {
            if (getAddress(log.address) !== getAddress(USDC_ADDRESS)) return false;
            const event = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics });
            return event.args.from.toLowerCase() === op.account.toLowerCase() && event.args.to.toLowerCase() === op.vault?.toLowerCase() && event.args.value.toString() === op.amount;
          }
          if (log.address.toLowerCase() !== op.vault?.toLowerCase()) return false;
          const event = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
          if (op.action === 'start' && event.eventName === 'SessionStarted') return event.args.sessionId === BigInt(op.sessionId!) + 1n && event.args.controlNonce === BigInt(op.nonce!) + 1n;
          if ((op.action === 'owner-freeze' || op.action === 'pq-freeze') && event.eventName === 'SessionRevoked') {
            return event.args.oldSessionId.toString() === op.sessionId && event.args.newSessionId === BigInt(op.sessionId!) + 1n && event.args.controlNonce === BigInt(op.nonce!) + 1n && Number(event.args.reason) === (op.action === 'owner-freeze' ? 0 : 1);
          }
          return op.action === 'withdraw' && event.eventName === 'Withdrawn' && event.args.to.toLowerCase() === op.recipient?.toLowerCase() && event.args.amount.toString() === op.amount && event.args.controlNonce === BigInt(op.nonce!) + 1n;
        } catch { return false; }
      });
    }
  }
  return { ...mined, intentMatches, replacementReason, effectVerified };
}
export function operationFromInput(input: TransactionInput): Pick<Operation, 'account' | 'to' | 'dataHash'> {
  return { account: input.from, to: input.to, dataHash: keccak256(input.data) };
}
