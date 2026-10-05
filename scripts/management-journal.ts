import { existsSync, readFileSync } from 'node:fs';
import { keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from 'viem';
import { atomicJson, withOsLock } from './durable.js';

export type ManagementReceipt = { status: 'success' | 'reverted'; transactionHash: Hex; blockNumber: bigint; contractAddress?: Address | null };
export type ManagementJournal = { version: 1; chainId: number; account: Address; step: string; intentHash: Hex; signedTx: Hex; txHash: Hex };
export type ManagementPort<R extends ManagementReceipt> = {
  chainId: number; account: Address; intentHash: Hex;
  sign(): Promise<Hex>;
  broadcast(raw: Hex): Promise<void>;
  receipt(hash: Hex): Promise<R>;
  /** Fault hook used only by local tests. */
  checkpoint?(stage: 'signed' | 'persisted' | 'broadcast' | 'receipt'): void;
};
export async function runManagementStep<R extends ManagementReceipt>(path: string, step: string, port: ManagementPort<R>): Promise<R> {
  return withOsLock(`${path}.lock`, async (assertHeld) => {
    let journal: ManagementJournal;
    if (existsSync(path)) journal = JSON.parse(readFileSync(path, 'utf8')) as ManagementJournal;
    else {
      assertHeld();
      const signedTx = await port.sign(); assertHeld(); port.checkpoint?.('signed');
      journal = { version: 1, chainId: port.chainId, account: port.account, step, intentHash: port.intentHash, signedTx, txHash: keccak256(signedTx) };
      atomicJson(path, journal); port.checkpoint?.('persisted');
    }
    if (journal.version !== 1 || journal.chainId !== port.chainId || journal.account.toLowerCase() !== port.account.toLowerCase() || journal.step !== step || journal.intentHash !== port.intentHash || keccak256(journal.signedTx) !== journal.txHash) throw new Error('Management journal identity mismatch');
    const tx = parseTransaction(journal.signedTx);
    if (tx.chainId !== port.chainId || (await recoverTransactionAddress({ serializedTransaction: journal.signedTx as TransactionSerialized })).toLowerCase() !== port.account.toLowerCase()) throw new Error('Management signer/chain mismatch');
    assertHeld();
    try { await port.broadcast(journal.signedTx); } catch { /* Already mined or ambiguous submission: inspect original hash. */ }
    assertHeld();
    port.checkpoint?.('broadcast');
    const receipt = await port.receipt(journal.txHash); assertHeld(); port.checkpoint?.('receipt');
    if (receipt.transactionHash !== journal.txHash || receipt.status !== 'success') throw new Error('Management transaction did not succeed with its original hash; inspect journal, do not repeat transfers');
    return receipt;
  });
}
