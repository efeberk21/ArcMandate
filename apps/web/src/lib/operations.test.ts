import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { canSubmitOperation, loadOperations, operationReceipt, saveOperation, pendingOperationsFor, validateOperationHash, type Operation } from './operations';
import { trackReceipt, type TransactionState } from './transactions';
import type { ArcClient } from './chain';
const owner = '0x1111111111111111111111111111111111111111';
const relay = '0x2222222222222222222222222222222222222222';
const vault = '0x3333333333333333333333333333333333333333';
const op: Operation = { id: 'fund-1', account: owner, network: 'testnet', action: 'fund', vault,
  dataHash: keccak256('0x1234'), stage: 'unknown', createdAt: '2026-10-05', hash: `0x${'ab'.repeat(32)}` };
describe('durable operations and emergency freeze (R03/R04)', () => {
  it('preserves valid signing deadlines on reload and binds them to the recovered calldata',async()=>{
    const auth={nonce:2n,sessionId:2n,deadline:1700000060n};
    const input=encodeFunctionData({abi:vaultAbi,functionName:'freezeByPQ',args:[auth,'0x']});
    const pending:Operation={...op,action:'pq-freeze',to:vault,hash:undefined,stage:'wallet',dataHash:keccak256(input),authorizationDeadline:auth.deadline.toString()};
    const storage={getItem:()=>JSON.stringify([pending])};
    expect(loadOperations(storage)[0].authorizationDeadline).toBe('1700000060');
    const rpc={getChainId:async()=>5042002,getTransaction:async()=>({from:owner,to:vault,value:0n,input,nonce:9,chainId:5042002})};
    expect(await validateOperationHash(rpc as unknown as ArcClient,pending,op.hash!)).toMatchObject({stage:'submitted',authorizationDeadline:'1700000060'});
    await expect(validateOperationHash(rpc as unknown as ArcClient,{...pending,authorizationDeadline:'1700000061'},op.hash!)).rejects.toThrow('does not match');
    for(const invalid of [-1,true,'-1','bad',(2n**256n).toString()])expect(()=>loadOperations({getItem:()=>JSON.stringify([{...pending,authorizationDeadline:invalid}])})).toThrow('Invalid stored');
    expect(()=>loadOperations({getItem:()=>JSON.stringify([{...pending,action:'fund'}])})).toThrow('Invalid stored');
    expect(loadOperations({getItem:()=>JSON.stringify([{...pending,authorizationDeadline:undefined}])})).toHaveLength(1);
  });
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
    expect(() => loadOperations({ getItem: () => JSON.stringify([{ ...op, amount: 'not-a-number' }]) })).toThrow('Invalid stored');
  });
  it('does not confirm a mined cancellation of freeze, then confirms identical repricing with its actual hash', async () => {
    const input = encodeFunctionData({ abi: vaultAbi, functionName: 'freezeByOwner', args: [1n] });
    const freeze: Operation = { ...op, action: 'owner-freeze', to: vault, sessionId: '1', nonce: '1', dataHash: keccak256(input) };
    const actualHash = `0x${'cd'.repeat(32)}` as Hex;
    let sameIntent = false; let reason = 'cancelled'; let last: TransactionState | undefined;
    const rpc = {
      getChainId: async () => 5042002,
      async waitForTransactionReceipt({ onReplaced }: { onReplaced: (event: { reason: string }) => void }) {
        onReplaced({ reason });
        return { status: 'success' as const, transactionHash: actualHash, blockNumber: 101n, contractAddress: null,
          logs: sameIntent ? [{ address: vault,
            topics: encodeEventTopics({ abi: vaultAbi, eventName: 'SessionRevoked', args: { oldSessionId: 1n, newSessionId: 2n, caller: owner } }),
            data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, 2n]) }] : [] };
      },
      async getTransaction({ hash }: { hash: Hex }) {
        return { from: owner, to: hash === op.hash || sameIntent ? vault : owner, value: 0n,
          input: hash === op.hash || sameIntent ? input : '0x', nonce: 7, chainId: 5042002 };
      },
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
  it('rejects unrelated manual hashes before tracking a receipt or clearing pending protection', async () => {
    const rpc = { getChainId: async () => 5042002, getTransaction: async () => ({ from: relay, to: vault, value: 0n, input: '0x', nonce: 1, chainId: 5042002 }) };
    const pending = { ...op, hash: undefined, stage: 'wallet' as const };
    await expect(validateOperationHash(rpc as unknown as ArcClient, pending, op.hash!)).rejects.toThrow('does not match');
    let last: TransactionState | undefined;
    await trackReceipt({ receipt: hash => operationReceipt(rpc as unknown as ArcClient, pending, hash) }, op.hash!, state => { last = state; });
    expect(last?.stage).toBe('unknown');
    expect(canSubmitOperation('fund', 'testnet', owner, vault, [{ ...pending, stage: last!.stage }])).toBe(false);
  });
  it('validates network, actual calldata/value and nonce before attaching a matching hash', async () => {
    const tx = { from: owner, to: vault, value: 0n, input: '0x1234', nonce: 9, chainId: 5042002 };
    const pending: Operation = { ...op, to: vault, hash: undefined };
    const rpc = { getChainId: async () => 5042002, getTransaction: async () => tx };
    expect(await validateOperationHash(rpc as unknown as ArcClient, pending, op.hash!)).toMatchObject({ walletNonce: 9, originalHash: op.hash, stage: 'submitted' });
    tx.value = 1n;
    await expect(validateOperationHash(rpc as unknown as ArcClient, pending, op.hash!)).rejects.toThrow('does not match');
    tx.value = 0n; tx.chainId = 1;
    await expect(validateOperationHash(rpc as unknown as ArcClient, pending, op.hash!)).rejects.toThrow('does not match');
    tx.chainId = 5042002;
    await expect(validateOperationHash(rpc as unknown as ArcClient, { ...pending, walletNonce: 8 }, op.hash!)).rejects.toThrow('does not match');
  });
  it('shows the same case-insensitive pending operations that block submission, including other vaults', () => {
    const mixed = '0xaBcDEfabcdefabcdefabcdefabcdefabcdefABCD' as const;
    const pending = { ...op, account: mixed };
    const account = mixed.toLowerCase() as typeof mixed;
    expect(pendingOperationsFor('testnet', account, relay, [pending])).toEqual([pending]);
    expect(canSubmitOperation('fund', 'testnet', account, relay, [pending])).toBe(false);
  });
  it('does not revive a terminal operation from a delayed tab update', () => {
    let json: string | null = null;
    const storage = { getItem: () => json, setItem: (_: string, value: string) => { json = value; } };
    saveOperation({ ...op, stage: 'confirmed', blockNumber: '42' }, storage);
    expect(saveOperation(op, storage)[0]).toMatchObject({ stage: 'confirmed', blockNumber: '42' });
  });
  it('keeps a reverted replacement unresolved if its sender/nonce proof cannot be read', async () => {
    const originalHash = op.hash!;
    const pending: Operation = { ...op, to: vault };
    const replacementHash = `0x${'cd'.repeat(32)}` as Hex;
    const rpc = {
      getChainId: async () => 5042002,
      getTransaction: async ({ hash }: { hash: Hex }) => {
        if (hash !== originalHash) throw new Error('RPC unavailable');
        return { from: owner, to: vault, value: 0n, input: '0x1234', nonce: 9, chainId: 5042002 };
      },
      waitForTransactionReceipt: async () => ({ transactionHash: replacementHash, status: 'reverted', blockNumber: 102n, logs: [] }),
    };
    let last: TransactionState | undefined;
    await trackReceipt({ receipt: hash => operationReceipt(rpc as unknown as ArcClient, pending, hash) }, originalHash, state => { last = state; });
    expect(last).toMatchObject({ stage: 'unknown', hash: originalHash });
    expect(canSubmitOperation('fund', 'testnet', owner, vault, [{ ...pending, stage: last!.stage }])).toBe(false);
  });
});
