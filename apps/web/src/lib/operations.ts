import { TransactionNotFoundError, decodeEventLog, decodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { matchesVaultRuntime } from '@arcmandate/core/runtime';
import { ARC_NETWORKS, USDC_ADDRESS } from '@arcmandate/core';
import type { ArcClient, Network } from './chain';
import type { Receipt, TransactionInput, TransactionState } from './transactions';

export type Action = 'deploy' | 'fund' | 'start' | 'owner-freeze' | 'pq-freeze' | 'withdraw' | 'agent-gas' | 'agent-pay';
export type Operation = {
  id: string; network: Network; account: Address; action: Action; vault?: Address;
  to?: Address; dataHash: Hex; hash?: Hex; stage: TransactionState['stage']; createdAt: string;
  sessionId?: string; nonce?: string; amount?: string; recipient?: Address; publicKey?: Hex; message?: string;
  blockNumber?: string; deployedVault?: Address;
  originalHash?: Hex; walletNonce?: number;
  requestId?: string; paymentId?: Hex;
  authorizationDeadline?: string;
};
const key = 'arcmandate.operations.v1';
const terminal = new Set(['confirmed', 'reverted', 'cancelled', 'wallet-rejected', 'simulation-rejected']);
export const unresolvedOperation = (op: Operation) => !terminal.has(op.stage);

export function loadOperations(storage: Pick<Storage, 'getItem'> = localStorage): Operation[] {
  const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
  if (!Array.isArray(value) || value.length > 500 || value.some((op) => !op || typeof op.id !== 'string' ||
    typeof op.createdAt !== 'string' || !Number.isFinite(Date.parse(op.createdAt)) ||
    !['testnet', 'mainnet'].includes(op.network) || !/^0x[0-9a-f]{40}$/i.test(op.account) ||
    !/^0x[0-9a-f]{64}$/i.test(op.dataHash) || (op.hash && !/^0x[0-9a-f]{64}$/i.test(op.hash)) ||
    (op.originalHash && !/^0x[0-9a-f]{64}$/i.test(op.originalHash)) ||
    (op.walletNonce !== undefined && (!Number.isSafeInteger(op.walletNonce) || op.walletNonce < 0)) ||
    (op.authorizationDeadline !== undefined && (typeof op.authorizationDeadline !== 'string' || !/^\d{1,78}$/.test(op.authorizationDeadline) || BigInt(op.authorizationDeadline) >= 2n ** 256n || !['start','pq-freeze','withdraw'].includes(op.action))) ||
    (op.amount !== undefined && (typeof op.amount !== 'string' || !/^[0-9]+$/.test(op.amount))) ||
    !['deploy','fund','start','owner-freeze','pq-freeze','withdraw','agent-gas','agent-pay'].includes(op.action) ||
    (op.vault !== undefined && !/^0x[0-9a-f]{40}$/i.test(op.vault)) || (op.to !== undefined && !/^0x[0-9a-f]{40}$/i.test(op.to)) ||
    (op.deployedVault !== undefined && !/^0x[0-9a-f]{40}$/i.test(op.deployedVault)) ||
    (op.recipient !== undefined && !/^0x[0-9a-f]{40}$/i.test(op.recipient)) ||
    (op.sessionId !== undefined && !/^[0-9]+$/.test(op.sessionId)) || (op.nonce !== undefined && !/^[0-9]+$/.test(op.nonce)) ||
    (op.blockNumber !== undefined && !/^[0-9]+$/.test(op.blockNumber)) ||
    (op.action === 'agent-pay' && (!/^0x[0-9a-f]{64}$/i.test(op.paymentId) || typeof op.requestId !== 'string' || !op.requestId || !op.sessionId || !op.amount || !op.recipient || !op.vault)) ||
    !['wallet','submitted','unknown','confirmed','cancelled','reverted','wallet-rejected','simulation-rejected'].includes(op.stage))) {
    throw new Error('Invalid stored operation history; reconcile wallet activity before submitting');
  }
  if(new Set(value.map(op=>op.id)).size!==value.length)throw new Error('Duplicate operation IDs in stored history; preserve and reconcile records.');
  return value;
}
export function saveOperation(op: Operation, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Operation[] {
  const existing = loadOperations(storage);
  const previous = existing.find(item => item.id === op.id);
  // Delayed callbacks cannot revive an operation another tab already resolved.
  if (previous && !unresolvedOperation(previous) && unresolvedOperation(op)) return existing;
  const next = [...existing.filter((item) => item.id !== op.id), op];
  // Never evict an unresolved operation.
  const pending = next.filter(unresolvedOperation);
  const records = [...next.filter((item) => !unresolvedOperation(item)).slice(-100), ...pending];
  storage.setItem(key, JSON.stringify(records));
  return records;
}
export async function saveOperationLocked(op: Operation): Promise<Operation[]> {
  if (!navigator.locks) throw new Error('Web Locks are required to safely save wallet operations.');
  return navigator.locks.request('arcmandate-operation-history', () => saveOperation(op));
}
export const sameAddress = (left?: string | null, right?: string | null) => !!left && !!right && left.toLowerCase() === right.toLowerCase();
export function pendingOperationsFor(network: Network, account: Address | null, vault: Address | null, ops: Operation[]): Operation[] {
  return ops.filter(op => op.network === network && unresolvedOperation(op) && (sameAddress(op.account, account) || sameAddress(op.vault, vault)));
}
export function operationBlockers(action: Action, network: Network, account: Address, vault: Address | undefined, ops: Operation[]): Operation[] {
  return ops.filter(op => op.network === network && unresolvedOperation(op) &&
    (sameAddress(op.account, account) || (action !== 'pq-freeze' && action !== 'owner-freeze' && sameAddress(op.vault, vault))));
}
export function canSubmitOperation(action: Action, network: Network, account: Address, vault: Address | undefined, ops: Operation[]): boolean {
  return operationBlockers(action, network, account, vault, ops).length === 0;
}
type ChainTransaction = Awaited<ReturnType<ArcClient['getTransaction']>>;
async function visibleTransaction(rpc: ArcClient, hash: Hex): Promise<ChainTransaction> {
  // A wallet can return a hash before the public RPC indexes the transaction.
  // Retry reads only; all intent checks still run once the transaction is visible.
  for (let attempt = 0; ; attempt++) {
    try { return await rpc.getTransaction({ hash }); }
    catch (error) {
      if (!(error instanceof TransactionNotFoundError) || attempt >= 19) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 1500));
    }
  }
}
function transactionMatches(op: Operation, tx: ChainTransaction): boolean {
  if (!(sameAddress(tx.from, op.account) && tx.to?.toLowerCase() === op.to?.toLowerCase() &&
    keccak256(tx.input) === op.dataHash && tx.value === 0n)) return false;
  if (op.authorizationDeadline === undefined) return true;
  try {
    const decoded = decodeFunctionData({ abi: vaultAbi, data: tx.input });
    const deadline = op.action === 'start' && decoded.functionName === 'startSession' ? decoded.args[1].deadline
      : op.action === 'pq-freeze' && decoded.functionName === 'freezeByPQ' ? decoded.args[0].deadline
      : op.action === 'withdraw' && decoded.functionName === 'withdraw' ? decoded.args[2].deadline : undefined;
    return deadline?.toString() === op.authorizationDeadline;
  } catch { return false; }
}
export async function validateOperationHash(rpc: ArcClient, op: Operation, hash: Hex): Promise<Operation> {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Enter a complete transaction hash (0x followed by 64 hex characters).');
  const chainId = ARC_NETWORKS[op.network].chainId;
  if (await rpc.getChainId() !== chainId) throw new Error('RPC network does not match this operation.');
  const tx = await visibleTransaction(rpc, hash);
  if (!transactionMatches(op, tx) || tx.chainId !== chainId || (op.walletNonce !== undefined && tx.nonce !== op.walletNonce)) {
    throw new Error('This transaction does not match this action. Check the sender, network and wallet activity.');
  }
  return { ...op, hash, originalHash: hash, walletNonce: tx.nonce, stage: 'submitted' };
}
const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export async function operationReceipt(rpc: ArcClient, op: Operation, hash: Hex): Promise<Receipt> {
  const originalHash = op.originalHash ?? hash;
  const validated = await validateOperationHash(rpc, op, originalHash);
  let replacementReason: string | undefined;
  const mined = await rpc.waitForTransactionReceipt({ hash: originalHash, timeout: 120_000, pollingInterval: 1500,
    onReplaced: (replacement) => { replacementReason = replacement.reason; } });
  let tx;
  try { tx = await rpc.getTransaction({ hash: mined.transactionHash }); }
  catch { throw new Error('The mined transaction could not be checked. Keep this operation pending and recheck its receipt.'); }
  const intentMatches = transactionMatches(op, tx) && tx.chainId === ARC_NETWORKS[op.network].chainId;
  const replacementVerified = mined.transactionHash.toLowerCase() !== originalHash.toLowerCase() &&
    sameAddress(tx.from, op.account) && tx.nonce === validated.walletNonce && tx.chainId === ARC_NETWORKS[op.network].chainId;
  if (mined.transactionHash.toLowerCase() !== originalHash.toLowerCase() && !replacementVerified) {
    throw new Error('Could not verify the replacement sender and wallet nonce. Keep the original operation pending.');
  }
  let effectVerified = false;
  if (intentMatches && mined.status === 'success') {
    if (op.action === 'deploy' && mined.contractAddress && op.publicKey) {
      effectVerified = matchesVaultRuntime(await rpc.getBytecode({ address: mined.contractAddress, blockNumber: mined.blockNumber }), op.account, op.publicKey);
    } else {
      effectVerified = mined.logs.some((log) => {
        try {
          if (op.action === 'fund' || op.action === 'agent-gas') {
            if (getAddress(log.address) !== getAddress(USDC_ADDRESS)) return false;
            const event = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics });
            return event.args.from.toLowerCase() === op.account.toLowerCase() && event.args.to.toLowerCase() === (op.action === 'agent-gas' ? op.recipient : op.vault)?.toLowerCase() && event.args.value.toString() === op.amount;
          }
          if (log.address.toLowerCase() !== op.vault?.toLowerCase()) return false;
          const event = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
          if (op.action === 'agent-pay' && event.eventName === 'AgentPaid') return event.args.sessionId.toString() === op.sessionId && event.args.paymentId.toLowerCase() === op.paymentId?.toLowerCase() && event.args.to.toLowerCase() === op.recipient?.toLowerCase() && event.args.amount.toString() === op.amount;
          if (op.action === 'start' && event.eventName === 'SessionStarted') return event.args.sessionId === BigInt(op.sessionId!) + 1n && event.args.controlNonce === BigInt(op.nonce!) + 1n;
          if ((op.action === 'owner-freeze' || op.action === 'pq-freeze') && event.eventName === 'SessionRevoked') {
            return event.args.oldSessionId.toString() === op.sessionId && event.args.newSessionId === BigInt(op.sessionId!) + 1n && event.args.controlNonce === BigInt(op.nonce!) + 1n && Number(event.args.reason) === (op.action === 'owner-freeze' ? 0 : 1);
          }
          return op.action === 'withdraw' && event.eventName === 'Withdrawn' && event.args.to.toLowerCase() === op.recipient?.toLowerCase() && event.args.amount.toString() === op.amount && event.args.controlNonce === BigInt(op.nonce!) + 1n;
        } catch { return false; }
      });
    }
  }
  return { ...mined, intentMatches, replacementReason, replacementVerified, effectVerified };
}
export function operationFromInput(input: TransactionInput): Pick<Operation, 'account' | 'to' | 'dataHash'> {
  return { account: input.from, to: input.to, dataHash: keccak256(input.data) };
}
