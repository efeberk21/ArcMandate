import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, type Address, type Hex } from 'viem';
import { ContextChanged } from './wallet';

export type TransactionInput = { from: Address; to?: Address; data: Hex };
export class SimulationRejected extends Error {}
export type Quote = { gas: bigint; gasPrice: bigint };
export type Receipt = { status: 'success' | 'reverted'; blockNumber: bigint; contractAddress?: Address | null };
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

export function errorMessage(error: unknown): string {
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

function fail(error: unknown, emit: (state: TransactionState) => void, hash?: Hex, wallet = false): void {
  const stage = hash ? 'unknown' : error instanceof ContextChanged ? 'cancelled'
    : wallet && rejected(error) ? 'wallet-rejected' : simulationFailure(error) ? 'simulation-rejected' : 'unknown';
  emit({ stage, message: errorMessage(error), ...(hash ? { hash } : {}), ...(wallet ? { walletRequested: true } : {}) });
}

export async function prepareTransaction(port: TransactionPort, input: TransactionInput, emit: (state: TransactionState) => void): Promise<Quote | undefined> {
  try {
    await port.assertContext();
    emit({ stage: 'simulating', message: 'Simulating the transaction and estimating the network fee…' });
    await port.simulate(input);
    const quote = await port.quote(input);
    await port.assertContext();
    emit({ stage: 'ready', message: 'Simulation passed. Review the fee before requesting wallet approval.' });
    return quote;
  } catch (error) { fail(error, emit); }
}

export async function trackReceipt(port: Pick<TransactionPort, 'receipt'>, hash: Hex, emit: (state: TransactionState) => void): Promise<Receipt | undefined> {
  try {
    const receipt = await port.receipt(hash);
    emit({ stage: receipt.status === 'success' ? 'confirmed' : 'reverted', hash,
      message: receipt.status === 'success' ? `Confirmed in block ${receipt.blockNumber}.` : `Transaction reverted in block ${receipt.blockNumber}.` });
    return receipt;
  } catch (error) { fail(error, emit, hash); }
}

export async function submitTransaction(port: TransactionPort, input: TransactionInput, quote: Quote, emit: (state: TransactionState) => void): Promise<Receipt | undefined> {
  let hash: Hex;
  let wallet = false;
  try {
    await port.assertContext();
    emit({ stage: 'simulating', message: 'Checking current authorization before sending…' });
    await port.simulate(input);
    await port.assertContext();
    wallet = true;
    emit({ stage: 'wallet', message: 'Confirm the transaction in your wallet.' });
    hash = await port.send(input, quote.gas);
  } catch (error) { fail(error, emit, undefined, wallet); return; }
  emit({ stage: 'submitted', hash, message: 'Submitted. Waiting for the transaction receipt…' });
  return trackReceipt(port, hash, emit);
}
