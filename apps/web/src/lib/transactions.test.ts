import { describe, expect, it, vi } from 'vitest';
import { BaseError, type Address, type Hex } from 'viem';
import { assertWallet, ContextChanged } from './wallet';
import { prepareTransaction, SimulationRejected, submitTransaction, trackReceipt, type TransactionPort, type TransactionState } from './transactions';

const account = '0x1111111111111111111111111111111111111111' as Address;
const hash = `0x${'ab'.repeat(32)}` as Hex;
const input = { from: account, to: account, data: '0x' as Hex };
const quote = { gas: 100n, gasPrice: 2n };
function port(): TransactionPort {
  return {
    assertContext: vi.fn(async () => {}), simulate: vi.fn(async () => {}), quote: vi.fn(async () => quote),
    send: vi.fn(async () => hash), receipt: vi.fn(async () => ({ status: 'success' as const, blockNumber: 100n })),
  };
}

describe('wallet transaction lifecycle', () => {
  it('rejects a wrong account or network before sending', async () => {
    const provider = { request: async ({ method }: { method: string }) => method === 'eth_accounts' ? [account] : '0x1' };
    await expect(assertWallet(provider, account, 5042002)).rejects.toThrow('network changed');
    await expect(assertWallet(provider, '0x2222222222222222222222222222222222222222', 1)).rejects.toThrow('account changed');
  });
  it('prepares without sending and tracks a successful wallet submission', async () => {
    const rpc = port(); const states: TransactionState[] = [];
    expect(await prepareTransaction(rpc, input, (state) => states.push(state))).toEqual(quote);
    expect(rpc.send).not.toHaveBeenCalled();
    await submitTransaction(rpc, input, quote, (state) => states.push(state));
    expect(states.map((state) => state.stage)).toEqual(['simulating', 'ready', 'simulating', 'wallet', 'submitted', 'confirmed']);
    expect(rpc.send).toHaveBeenCalledOnce();
    expect(states.at(-1)?.hash).toBe(hash);
  });
  it('labels contract simulation failure without inventing a transaction hash', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    rpc.simulate = vi.fn(async () => { throw new SimulationRejected('SessionInactive'); });
    await prepareTransaction(rpc, input, (state) => { last = state; });
    expect(last).toEqual({ stage: 'simulation-rejected', message: 'SessionInactive' });
    expect(rpc.send).not.toHaveBeenCalled();
  });
  it('distinguishes user wallet rejection from simulation rejection', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    rpc.send = vi.fn(async () => { throw new BaseError('Rejected', { cause: Object.assign(new Error('User rejected'), { code: 4001 }) }); });
    await submitTransaction(rpc, input, quote, (state) => { last = state; });
    expect(last?.stage).toBe('wallet-rejected'); expect(last?.hash).toBeUndefined();
    expect(rpc.receipt).not.toHaveBeenCalled();
  });
  it('keeps a submitted hash after RPC timeout and rechecks receipt without another send', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    rpc.receipt = vi.fn(async () => { throw new Error('RPC timeout'); });
    await submitTransaction(rpc, input, quote, (state) => { last = state; });
    expect(last).toEqual({ stage: 'unknown', message: 'RPC timeout', hash });
    rpc.receipt = vi.fn(async () => ({ status: 'success' as const, blockNumber: 101n }));
    await trackReceipt(rpc, hash, (state) => { last = state; });
    expect(last?.stage).toBe('confirmed'); expect(rpc.send).toHaveBeenCalledOnce();
  });
  it('distinguishes a mined revert and preserves its explorer hash', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    rpc.receipt = vi.fn(async () => ({ status: 'reverted' as const, blockNumber: 102n }));
    await submitTransaction(rpc, input, quote, (state) => { last = state; });
    expect(last?.stage).toBe('reverted'); expect(last?.hash).toBe(hash);
  });
  it('cancels authorization if context changes during fee preparation or before wallet send', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    rpc.assertContext = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new ContextChanged('Session changed'));
    expect(await prepareTransaction(rpc, input, (state) => { last = state; })).toBeUndefined();
    expect(last?.stage).toBe('cancelled');
    await submitTransaction(rpc, input, quote, (state) => { last = state; });
    expect(rpc.send).not.toHaveBeenCalled();
  });
  it('does not confirm a successful cancellation or different-calldata replacement (R02)', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    const replacement = `0x${'cd'.repeat(32)}` as Hex;
    rpc.receipt = async () => ({ status: 'success', blockNumber: 123n, transactionHash: replacement, intentMatches: false, replacementReason: 'cancelled' });
    expect(await trackReceipt(rpc, hash, (state) => { last = state; })).toBeUndefined();
    expect(last?.stage).toBe('cancelled'); expect(last?.hash).toBe(replacement);
  });
  it('uses the actual repriced hash and requires expected effects (R02)', async () => {
    const rpc = port(); let last: TransactionState | undefined;
    const replacement = `0x${'cd'.repeat(32)}` as Hex;
    rpc.receipt = async () => ({ status: 'success', blockNumber: 123n, transactionHash: replacement, intentMatches: true, effectVerified: true });
    await trackReceipt(rpc, hash, (state) => { last = state; });
    expect(last?.stage).toBe('confirmed'); expect(last?.hash).toBe(replacement);
    rpc.receipt = async () => ({ status: 'success', blockNumber: 123n, intentMatches: true, effectVerified: false });
    await trackReceipt(rpc, hash, (state) => { last = state; });
    expect(last?.stage).toBe('unknown');
  });
});
