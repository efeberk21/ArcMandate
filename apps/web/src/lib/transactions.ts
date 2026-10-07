import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, type Address, type Hex } from 'viem';
import { ContextChanged, WalletRequestNotSent } from './wallet';

export type TransactionInput = { from: Address; to?: Address; data: Hex; walletNonce?: number };
export class SimulationRejected extends Error {}
export type Quote = { gas: bigint; gasPrice: bigint };
export type Receipt = { status: 'success' | 'reverted'; blockNumber: bigint; contractAddress?: Address | null;
  transactionHash?: Hex; intentMatches?: boolean; replacementReason?: string; replacementVerified?: boolean; effectVerified?: boolean };
export type TransactionEmit = (state: TransactionState, receipt?: Receipt) => void | Promise<void>;
export type TransactionState = {
  stage: 'idle' | 'preparing' | 'review' | 'signing' | 'simulating' | 'ready' | 'wallet' | 'submitted'
    | 'confirmed' | 'simulation-rejected' | 'wallet-rejected' | 'reverted' | 'unknown' | 'cancelled';
  message: string; hash?: Hex; walletRequested?: boolean;
};
export type TransactionPort = {
  assertContext(): Promise<void>;
  simulate(input: TransactionInput): Promise<void>;
  quote(input: TransactionInput): Promise<Quote>;
  send(input: TransactionInput, gas: bigint): Promise<Hex>;
  receipt(hash: Hex): Promise<Receipt>;
};

export function isAssetLoadError(error: unknown): boolean {
  const matches = (cause: unknown) => cause instanceof Error && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed/i.test(cause.message);
  return matches(error) || (error instanceof BaseError && !!error.walk(matches));
}

export function errorMessage(error: unknown): string {
  if (isAssetLoadError(error)) return 'Application files could not load. Reload the app and restore your backup. Check Wallet activity before retrying any submitted transaction.';
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

function rejected(error: unknown): boolean {
  if (error instanceof BaseError && error.walk((cause) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 4001)) return true;
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 4001;
}

function simulationFailure(error: unknown): boolean {
  return error instanceof SimulationRejected || error instanceof ContractFunctionRevertedError ||
    (error instanceof BaseError && !!error.walk((cause) => cause instanceof ContractFunctionRevertedError || cause instanceof ExecutionRevertedError));
}

async function fail(error: unknown, emit: TransactionEmit, hash?: Hex, wallet = false): Promise<void> {
  const assetFailure = isAssetLoadError(error);
  const notRequested = !hash && error instanceof WalletRequestNotSent;
  const stage = hash ? 'unknown' : notRequested || error instanceof ContextChanged || (assetFailure && !wallet) ? 'cancelled'
    : wallet && rejected(error) ? 'wallet-rejected' : simulationFailure(error) ? 'simulation-rejected' : 'unknown';
  const message = stage === 'wallet-rejected'
    ? 'Wallet request rejected. No transaction was sent.'
    : assetFailure && !wallet && !hash
    ? 'Application files could not load. No wallet transaction was requested. Reload the app, restore your backup, and review the action again.'
    : errorMessage(error);
  await emit({ stage, message, ...(hash ? { hash } : {}), ...(notRequested ? { walletRequested: false } : wallet ? { walletRequested: true } : {}) });
}

export async function prepareTransaction(port: TransactionPort, input: TransactionInput, emit: TransactionEmit): Promise<Quote | undefined> {
  try {
    await port.assertContext();
    await emit({ stage: 'simulating', message: 'Simulating the transaction and estimating the network fee…' });
    await port.simulate(input);
    const quote = await port.quote(input);
    await port.assertContext();
    await emit({ stage: 'ready', message: 'Simulation passed. Review the fee before requesting wallet approval.' });
    return quote;
  } catch (error) { await fail(error, emit); }
}

export async function trackReceipt(port: Pick<TransactionPort, 'receipt'>, hash: Hex, emit: TransactionEmit): Promise<Receipt | undefined> {
  let actualHash = hash;
  try {
    const receipt = await port.receipt(hash);
    if (receipt.intentMatches === false) {
      if (!receipt.replacementVerified) throw new Error('This transaction does not match this action. The original operation still needs reconciliation.');
      actualHash = receipt.transactionHash ?? hash;
      await emit({ stage: 'cancelled', hash: actualHash, message: `Original action was replaced or cancelled (${receipt.replacementReason ?? 'different intent'}).` }, receipt);
      return;
    }
    actualHash = receipt.transactionHash ?? hash;
    if (receipt.status === 'success' && receipt.effectVerified === false) throw new Error('Receipt mined, but the expected action effect could not be verified');
    await emit({ stage: receipt.status === 'success' ? 'confirmed' : 'reverted', hash: actualHash,
      message: receipt.status === 'success' ? `Confirmed in block ${receipt.blockNumber}.` : `Transaction reverted in block ${receipt.blockNumber}.` }, receipt);
    return receipt;
  } catch (error) { await fail(error, emit, actualHash); }
}

export async function broadcastTransaction(port: TransactionPort, input: TransactionInput, quote: Quote, emit: TransactionEmit): Promise<Hex | undefined> {
  let hash: Hex;
  let wallet = false;
  try {
    await port.assertContext();
    await emit({ stage: 'simulating', message: 'Checking current authorization before sending…' });
    await port.simulate(input);
    await port.assertContext();
    wallet = true;
    await emit({ stage: 'wallet', message: 'Confirm the transaction in your wallet.' });
    hash = await port.send(input, quote.gas);
  } catch (error) { await fail(error, emit, undefined, wallet); return; }
  await emit({ stage: 'submitted', hash, message: 'Submitted. Waiting for the transaction receipt…' });
  return hash;
}

export async function submitTransaction(port: TransactionPort, input: TransactionInput, quote: Quote, emit: TransactionEmit): Promise<Receipt | undefined> {
  const hash = await broadcastTransaction(port, input, quote, emit);
  if (hash) return trackReceipt(port, hash, emit);
}
