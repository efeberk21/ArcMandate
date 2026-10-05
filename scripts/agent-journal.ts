import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeFunctionData, getAddress, isAddress, keccak256, parseTransaction, type Address, type Hex } from 'viem';
import { recoverTransactionAddress, type TransactionSerialized } from 'viem';
import { vaultAbi } from '../packages/core/src/generated/vault.js';
import { atomicJson, withOsLock } from './durable.js';

export type PaymentIntent = {
  requestId: string; chainId: number; account: Address; vault: Address; sessionId: string;
  paymentId: Hex; to: Address; amount: string; deploymentBlock: string;
};
export type PaymentJournal = PaymentIntent & {
  version: 1; signedTx?: Hex; txHash?: Hex;
  receipt?: { status: 'success' | 'reverted'; blockNumber: string };
};
export type PaymentPort = {
  account: Address;
  /** One directory shared by every process using this wallet, including demos. */
  walletDirectory?: string;
  sign(intent: PaymentIntent): Promise<{ signedTx: Hex; txHash: Hex }>;
  receipt(hash: Hex): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint } | null>;
  used(intent: PaymentIntent): Promise<boolean>;
  paymentEvent(intent: PaymentIntent): Promise<{ txHash: Hex; blockNumber: bigint } | null>;
  broadcast(signedTx: Hex): Promise<void>;
  nonceConsumed(journal: PaymentJournal): Promise<boolean>;
};
export type PaymentResult = { status: 'confirmed' | 'reverted' | 'pending' | 'used' | 'nonce-consumed'; journal: PaymentJournal };
const uint = /^(0|[1-9][0-9]*)$/;
const hash = /^0x[0-9a-f]{64}$/i;

export async function validateJournal(value: unknown): Promise<PaymentJournal> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid payment journal');
  const j = value as PaymentJournal;
  const fields = ['requestId','chainId','account','vault','sessionId','paymentId','to','amount','deploymentBlock','version','signedTx','txHash','receipt'];
  if (Object.keys(j).some((field) => !fields.includes(field)) || j.version !== 1 || typeof j.requestId !== 'string' || !j.requestId || j.requestId.length > 128 ||
    !Number.isSafeInteger(j.chainId) || j.chainId <= 0 || !isAddress(j.account) || !isAddress(j.vault) || !isAddress(j.to) ||
    !hash.test(j.paymentId) || /^0x0{64}$/i.test(j.paymentId) ||
    ![j.sessionId,j.amount,j.deploymentBlock].every((v) => typeof v === 'string' && uint.test(v)) || BigInt(j.amount) === 0n ||
    (j.txHash !== undefined && !hash.test(j.txHash)) || (!!j.signedTx && !j.txHash) ||
    (j.receipt && (!j.txHash || !['success','reverted'].includes(j.receipt.status) || typeof j.receipt.blockNumber !== 'string' || !uint.test(j.receipt.blockNumber) || Object.keys(j.receipt).sort().join(',') !== 'blockNumber,status'))) {
    throw new Error('Invalid payment journal schema');
  }
  if (j.signedTx) {
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(j.signedTx) || keccak256(j.signedTx) !== j.txHash) throw new Error('Invalid signed transaction hash');
    const tx = parseTransaction(j.signedTx);
    const signer = await recoverTransactionAddress({ serializedTransaction: j.signedTx as TransactionSerialized });
    if (tx.chainId !== j.chainId || signer.toLowerCase() !== j.account.toLowerCase() || tx.to?.toLowerCase() !== j.vault.toLowerCase() || (tx.value ?? 0n) !== 0n || !tx.data) throw new Error('Signed transaction does not match journal account, chain or vault');
    const call = decodeFunctionData({ abi: vaultAbi, data: tx.data });
    if (call.functionName !== 'agentPay' || call.args[0].toString() !== j.sessionId || call.args[1] !== j.paymentId ||
      call.args[2].toLowerCase() !== j.to.toLowerCase() || call.args[3].toString() !== j.amount) throw new Error('Signed calldata does not match payment intent');
  }
  return j;
}
export function journalPath(directory: string, requestId: string): string {
  if (!requestId || requestId.length > 128) throw new Error('Request ID must contain 1–128 characters');
  return join(directory, `${createHash('sha256').update(requestId).digest('hex')}.journal.json`);
}
function assertIntent(saved: PaymentJournal, intended: Omit<PaymentIntent, 'paymentId'>) {
  for (const key of ['requestId','chainId','account','vault','sessionId','to','amount','deploymentBlock'] as const) {
    const address = ['account','vault','to'].includes(key);
    if (address ? String(saved[key]).toLowerCase() !== String(intended[key]).toLowerCase() : saved[key] !== intended[key]) throw new Error(`Request ${intended.requestId} already belongs to a different ${key}`);
  }
}
async function reconcile(path: string, j: PaymentJournal, port: PaymentPort): Promise<PaymentResult | undefined> {
  // Always revalidate cached final receipts. A successful hash alone does not prove payment.
  const receipt = j.txHash ? await port.receipt(j.txHash) : null;
  if (receipt?.status === 'reverted') {
    j.receipt = { status: 'reverted', blockNumber: receipt.blockNumber.toString() }; atomicJson(path, j);
    return { status: 'reverted', journal: j };
  }
  if (await port.used(j)) {
    const event = await port.paymentEvent(j);
    if (!event) return { status: 'used', journal: j };
    const proof = await port.receipt(event.txHash);
    if (!proof || proof.status !== 'success' || proof.blockNumber !== event.blockNumber) return { status: 'used', journal: j };
    if (j.txHash && j.txHash !== event.txHash) throw new Error('Payment event hash differs from signed journal; reconcile replacement explicitly');
    j.txHash = event.txHash; j.receipt = { status: 'success', blockNumber: proof.blockNumber.toString() }; atomicJson(path, j);
    return { status: 'confirmed', journal: j };
  }
  if (receipt?.status === 'success') throw new Error('Mined success has no matching AgentPaid proof');
  if (j.signedTx && await port.nonceConsumed(j)) return { status: 'nonce-consumed', journal: j };
  if (j.receipt) throw new Error('Cached receipt is not present on chain; do not trust restored cache');
}
export async function runPayment(directory: string, intended: Omit<PaymentIntent, 'paymentId' | 'account'>, port: PaymentPort, options: { reconcileOnly?: boolean; retryConsumed?: boolean } = {}): Promise<PaymentResult> {
  const account = getAddress(port.account);
  const walletPath = join(port.walletDirectory ?? 'private/agent-wallet-locks', `${intended.chainId}-${account.toLowerCase()}`);
  const path = resolve(journalPath(directory, intended.requestId));
  return withOsLock(`${walletPath}.lock`, async (walletHeld) => withOsLock(`${path}.lock`, async (requestHeld) => {
    const assertHeld = () => { walletHeld(); requestHeld(); };
    const original = port;
    const checked = async <T>(work: () => Promise<T>): Promise<T> => { assertHeld(); const result = await work(); assertHeld(); return result; };
    port = { ...original, sign: (intent) => checked(() => original.sign(intent)),
      receipt: (hash) => checked(() => original.receipt(hash)), used: (intent) => checked(() => original.used(intent)),
      paymentEvent: (intent) => checked(() => original.paymentEvent(intent)),
      broadcast: (raw) => checked(() => original.broadcast(raw)), nonceConsumed: (journal) => checked(() => original.nonceConsumed(journal)) };
    const expected = { ...intended, account };
    let journal: PaymentJournal;
    if (existsSync(path)) { journal = await validateJournal(JSON.parse(readFileSync(path, 'utf8'))); assertIntent(journal, expected); }
    else { journal = { ...expected, version: 1, paymentId: `0x${randomBytes(32).toString('hex')}` }; atomicJson(path, journal); }
    const reservationPath = `${walletPath}.pending.json`;
    const reservation = existsSync(reservationPath) ? JSON.parse(readFileSync(reservationPath, 'utf8')) as { path?: string } : {};
    if (reservation.path && reservation.path !== path) {
      const prior = await validateJournal(JSON.parse(readFileSync(reservation.path, 'utf8')));
      if (prior.chainId !== intended.chainId || prior.account.toLowerCase() !== account.toLowerCase()) throw new Error('Invalid wallet nonce reservation');
      const result = await reconcile(reservation.path, prior, port);
      if (!result || !['confirmed','reverted','nonce-consumed'].includes(result.status)) throw new Error(`Wallet nonce is reserved by ${prior.requestId}; retry that request before signing another`);
    }
    atomicJson(reservationPath, { path }); // Reserve before signing, including the crash window.
    let result = await reconcile(path, journal, port);
    if (result?.status === 'nonce-consumed' && options.retryConsumed && !options.reconcileOnly) {
      // Explicit repair only after current-chain nonce proof, preserving paymentId and history.
      atomicJson(`${path}.attempt-${journal.txHash}.json`, journal);
      const { signedTx: _raw, txHash: _hash, receipt: _receipt, ...intent } = journal;
      journal = intent; atomicJson(path, journal);
      result = await reconcile(path, journal, port);
    }
    if (!result && options.reconcileOnly) return { status: 'pending', journal };
    if (!result) {
      if (!journal.signedTx) {
        const signed = await port.sign(journal);
        journal = await validateJournal({ ...journal, ...signed }); atomicJson(path, journal);
      }
      try { await port.broadcast(journal.signedTx!); } catch { /* Reconcile ambiguous submission. */ }
      result = await reconcile(path, journal, port) ?? { status: 'pending', journal };
    }
    if (['confirmed','reverted','nonce-consumed'].includes(result.status)) atomicJson(reservationPath, {});
    return result;
  }));
}
