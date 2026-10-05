import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { canSubmitOperation, loadOperations, operationReceipt, saveOperation, type Operation } from './operations';
import { trackReceipt, type TransactionState } from './transactions';
import type { ArcClient } from './chain';
const owner = '0x1111111111111111111111111111111111111111';
const relay = '0x2222222222222222222222222222222222222222';
const vault = '0x3333333333333333333333333333333333333333';
const op: Operation = { id: 'fund-1', account: owner, network: 'testnet', action: 'fund', vault,
  dataHash: keccak256('0x1234'), stage: 'unknown', createdAt: '2026-10-05', hash: `0x${'ab'.repeat(32)}` };
describe('durable operations and emergency freeze (R03/R04)', () => {
  it('preserves duplicate protection across reload and allows a distinct relay freeze', () => {
    let json: string | null = null;
    const storage = { getItem: () => json, setItem: (_: string, value: string) => { json = value; } };
    saveOperation(op, storage);
    const reloaded = loadOperations(storage);
    expect(canSubmitOperation('fund', 'testnet', owner, vault, reloaded)).toBe(false);
    expect(canSubmitOperation('fund', 'testnet', relay, vault, reloaded)).toBe(false);
    expect(canSubmitOperation('owner-freeze', 'testnet', owner, vault, reloaded)).toBe(false);
    expect(canSubmitOperation('pq-freeze', 'testnet', relay, vault, reloaded)).toBe(true);
    saveOperation({ ...op, stage: 'confirmed' }, storage);
    expect(canSubmitOperation('fund', 'testnet', owner, vault, loadOperations(storage))).toBe(true);
  });
  it('blocks an unknown wallet hash and fails closed on corrupt history', () => {
    expect(canSubmitOperation('deploy', 'testnet', owner, undefined, [{ ...op, action: 'deploy', vault: undefined, hash: undefined, stage: 'wallet' }])).toBe(false);
    expect(() => loadOperations({ getItem: () => '[{"id":"wrong"}]' })).toThrow('Invalid stored');
  });
  it('does not confirm a mined cancellation of freeze, then confirms identical repricing with its actual hash', async () => {
    const input = encodeFunctionData({ abi: vaultAbi, functionName: 'freezeByOwner', args: [1n] });
    const freeze: Operation = { ...op, action: 'owner-freeze', to: vault, sessionId: '1', nonce: '1', dataHash: keccak256(input) };
    const actualHash = `0x${'cd'.repeat(32)}` as Hex;
    let sameIntent = false; let reason = 'cancelled'; let last: TransactionState | undefined;
    const rpc = {
      async waitForTransactionReceipt({ onReplaced }: { onReplaced: (event: { reason: string }) => void }) {
        onReplaced({ reason });
        return { status: 'success' as const, transactionHash: actualHash, blockNumber: 101n, contractAddress: null,
          logs: sameIntent ? [{ address: vault,
            topics: encodeEventTopics({ abi: vaultAbi, eventName: 'SessionRevoked', args: { oldSessionId: 1n, newSessionId: 2n, caller: owner } }),
            data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 2n]) }] : [] };
      },
      async getTransaction() { return { from: owner, to: sameIntent ? vault : owner, value: 0n, input: sameIntent ? input : '0x' }; },
    };
    const port = { receipt: (hash: Hex) => operationReceipt(rpc as unknown as ArcClient, freeze, hash) };
    expect(await trackReceipt(port, op.hash!, (state) => { last = state; })).toBeUndefined();
    expect(last?.stage).toBe('cancelled'); expect(last?.hash).toBe(actualHash);
    sameIntent = true; reason = 'repriced';
    expect((await trackReceipt(port, op.hash!, (state) => { last = state; }))?.effectVerified).toBe(true);
    expect(last?.stage).toBe('confirmed'); expect(last?.hash).toBe(actualHash);
    freeze.sessionId = '0';
    await trackReceipt(port, op.hash!, (state) => { last = state; });
    expect(last?.stage).toBe('unknown'); expect(last?.hash).toBe(actualHash); // stale expected session cannot confirm.
  });
});
