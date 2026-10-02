import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, type Address, type Hex } from 'viem';

export type PaymentIntent = {
  requestId: string;
  chainId: number;
  vault: Address;
  sessionId: string;
  paymentId: Hex;
  to: Address;
  amount: string;
  deploymentBlock: string;
};

export type PaymentJournal = PaymentIntent & {
  version: 1;
  signedTx?: Hex;
  txHash?: Hex;
  receipt?: { status: 'success' | 'reverted'; blockNumber: string };
};

export type PaymentPort = {
  sign(intent: PaymentIntent): Promise<{ signedTx: Hex; txHash: Hex }>;
  receipt(hash: Hex): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint } | null>;
  used(intent: PaymentIntent): Promise<boolean>;
  paymentEvent(intent: PaymentIntent): Promise<{ txHash: Hex; blockNumber: bigint } | null>;
  broadcast(signedTx: Hex): Promise<void>;
};

export type PaymentResult =
  | { status: 'confirmed'; journal: PaymentJournal }
  | { status: 'reverted'; journal: PaymentJournal }
  | { status: 'pending'; journal: PaymentJournal }
  | { status: 'used'; journal: PaymentJournal };

function assertIntent(saved: PaymentJournal, intended: Omit<PaymentIntent, 'paymentId'>): void {
  for (const key of ['requestId', 'chainId', 'vault', 'sessionId', 'to', 'amount', 'deploymentBlock'] as const) {
    const same = key === 'vault' || key === 'to'
      ? String(saved[key]).toLowerCase() === String(intended[key]).toLowerCase()
      : saved[key] === intended[key];
    if (!same) throw new Error(`Request ${intended.requestId} already belongs to a different ${key}`);
  }
}

function persist(path: string, journal: PaymentJournal): void {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try { renameSync(temp, path); } catch (error) { unlinkSync(temp); throw error; }
}

function acquireLock(path: string): number {
  try { return openSync(path, 'wx', 0o600); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8').trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Journal lock is incomplete: ${path}`);
    try { process.kill(pid, 0); } catch (probe) {
      if (probe instanceof Error && 'code' in probe && probe.code === 'ESRCH') {
        unlinkSync(path);
        return openSync(path, 'wx', 0o600);
      }
      throw probe;
    }
    throw new Error(`Payment journal is in use by process ${pid}`);
  }
}

export function journalPath(directory: string, requestId: string): string {
  if (!requestId || requestId.length > 128) throw new Error('Request ID must contain 1–128 characters');
  return join(directory, `${createHash('sha256').update(requestId).digest('hex')}.journal.json`);
}

export async function runPayment(
  directory: string,
  intended: Omit<PaymentIntent, 'paymentId'>,
  port: PaymentPort,
): Promise<PaymentResult> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = journalPath(directory, intended.requestId);
  const lock = `${path}.lock`;
  const lockFd = acquireLock(lock);
  try {
    writeFileSync(lockFd, `${process.pid}\n`);
    fsyncSync(lockFd);
    let journal: PaymentJournal;
    if (existsSync(path)) {
      journal = JSON.parse(readFileSync(path, 'utf8')) as PaymentJournal;
      if (journal.version !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(journal.paymentId)
        || /^0x0{64}$/i.test(journal.paymentId)
        || (journal.signedTx && journal.txHash !== keccak256(journal.signedTx))) {
        throw new Error('Invalid payment journal');
      }
      assertIntent(journal, intended);
    } else {
      let paymentId: Hex;
      do { paymentId = `0x${randomBytes(32).toString('hex')}`; } while (/^0x0{64}$/.test(paymentId));
      journal = { ...intended, version: 1, paymentId };
      persist(path, journal);
    }

    if (journal.receipt) return { status: journal.receipt.status === 'success' ? 'confirmed' : 'reverted', journal };
    if (journal.txHash) {
      const receipt = await port.receipt(journal.txHash);
      if (receipt) {
        journal.receipt = { status: receipt.status, blockNumber: receipt.blockNumber.toString() };
        persist(path, journal);
        return { status: receipt.status === 'success' ? 'confirmed' : 'reverted', journal };
      }
    }

    // A submitted transaction can be mined even if its hash was never returned to the caller.
    // The onchain paymentId check takes precedence over any rebroadcast.
    if (await port.used(journal)) {
      const event = await port.paymentEvent(journal);
      if (event) {
        journal.txHash = event.txHash;
        journal.receipt = { status: 'success', blockNumber: event.blockNumber.toString() };
        persist(path, journal);
        return { status: 'confirmed', journal };
      }
      return { status: 'used', journal };
    }

    if (!journal.signedTx) {
      const signed = await port.sign(journal);
      if (signed.txHash !== keccak256(signed.signedTx)) throw new Error('Signed transaction hash mismatch');
      journal.signedTx = signed.signedTx;
      journal.txHash = signed.txHash;
      // Persist the exact signed bytes and their hash before broadcasting. A retry
      // rebroadcasts this transaction; it never allocates another nonce or paymentId.
      persist(path, journal);
    }
    try { await port.broadcast(journal.signedTx); } catch {
      // RPC submission can fail after accepting the transaction. Reconcile below.
    }
    if (journal.txHash) {
      const receipt = await port.receipt(journal.txHash);
      if (receipt) {
        journal.receipt = { status: receipt.status, blockNumber: receipt.blockNumber.toString() };
        persist(path, journal);
        return { status: receipt.status === 'success' ? 'confirmed' : 'reverted', journal };
      }
    }
    if (await port.used(journal)) {
      const event = await port.paymentEvent(journal);
      if (event) {
        journal.txHash = event.txHash;
        journal.receipt = { status: 'success', blockNumber: event.blockNumber.toString() };
        persist(path, journal);
        return { status: 'confirmed', journal };
      }
      return { status: 'used', journal };
    }
    return { status: 'pending', journal };
  } finally {
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
