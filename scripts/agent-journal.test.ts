import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { vaultAbi } from '../packages/core/src/generated/vault.js';
import { journalPath, runPayment, validateJournal, type PaymentIntent, type PaymentPort } from './agent-journal.js';
import { withOsLock } from './durable.js';
const agent = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const intended = { requestId: 'invoice-42', chainId: 5_042_002,
  vault: '0x1111111111111111111111111111111111111111' as const, sessionId: '7',
  to: '0x2222222222222222222222222222222222222222' as const, amount: '50000', deploymentBlock: '100' };
function withDirectory(test: (directory: string) => Promise<void>) {
  return async () => { const dir = mkdtempSync(join(tmpdir(), 'arc-journal-')); try { await test(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
}
async function sign(intent: PaymentIntent) {
  const signedTx = await agent.signTransaction({ chainId: intent.chainId, nonce: 1, gas: 100000n, gasPrice: 1n, to: intent.vault,
    data: encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay', args: [BigInt(intent.sessionId), intent.paymentId, intent.to, BigInt(intent.amount)] }), value: 0n });
  return { signedTx, txHash: keccak256(signedTx) };
}
function port(directory: string): PaymentPort {
  return { account: agent.address, walletDirectory: join(directory, 'wallet'), sign,
    receipt: async () => null, used: async () => false, paymentEvent: async () => null,
    broadcast: async () => {}, nonceConsumed: async () => false };
}
describe('agent journal, wallet serialization and OS locks (R05/R06/R14)', () => {
  it('preserves bytes and payment ID after ambiguous broadcast and proves the receipt with an event', withDirectory(async (dir) => {
    const rpc = port(dir); let signs = 0; let sends = 0;
    rpc.sign = async (intent) => { signs++; return sign(intent); };
    rpc.broadcast = async () => { sends++; throw new Error('timeout after accepting'); };
    const first = await runPayment(dir, intended, rpc);
    const second = await runPayment(dir, intended, rpc);
    expect(first.status).toBe('pending'); expect(second.journal.signedTx).toBe(first.journal.signedTx);
    expect(second.journal.paymentId).toBe(first.journal.paymentId); expect(signs).toBe(1); expect(sends).toBe(2);
    rpc.receipt = async () => ({ status: 'success', blockNumber: 123n });
    rpc.used = async () => true;
    rpc.paymentEvent = async () => ({ txHash: first.journal.txHash!, blockNumber: 123n });
    expect((await runPayment(dir, intended, rpc)).status).toBe('confirmed');
    rpc.receipt = async () => null;
    expect((await runPayment(dir, intended, rpc)).status).toBe('used'); // restored cache is rechecked.
    expect(sends).toBe(2);
  }));
  it('blocks parallel different request IDs and a later request while the first nonce is ambiguous', withDirectory(async (dir) => {
    const rpc = port(dir); let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    rpc.sign = async (intent) => { enter(); await hold; return sign(intent); };
    const first = runPayment(dir, intended, rpc); await entered;
    try { await expect(runPayment(dir, { ...intended, requestId: 'invoice-43', vault: intended.to }, rpc)).rejects.toThrow('in use'); }
    finally { release(); }
    await first;
    await expect(runPayment(dir, { ...intended, requestId: 'invoice-43' }, rpc)).rejects.toThrow('reserved');
    rpc.nonceConsumed = async () => true;
    expect((await runPayment(dir, intended, rpc)).status).toBe('nonce-consumed');
  }));
  it('does not depend on lock contents, missing PID, recycled PID or two recovery processes', withDirectory(async (dir) => {
    for (const content of ['', '9', `${process.pid}\n`, '99999999\n']) {
      writeFileSync(`${journalPath(dir, intended.requestId)}.lock`, content);
      expect((await runPayment(dir, intended, port(dir))).status).toBe('pending');
    }
    await expect(withOsLock(join(dir, 'crash.lock'), async () => { throw new Error('injected crash'); })).rejects.toThrow('injected');
    await withOsLock(join(dir, 'crash.lock'), async () => {
      const attempts = await Promise.allSettled([withOsLock(join(dir, 'crash.lock'), async () => {}), withOsLock(join(dir, 'crash.lock'), async () => {})]);
      expect(attempts.every((result) => result.status === 'rejected')).toBe(true);
    });
  }));
  it('rejects corrupt schema, altered signed calldata/account/chain/hash, and unproved success caches', withDirectory(async (dir) => {
    const rpc = port(dir); const first = await runPayment(dir, intended, rpc);
    for (const patch of [{ amount: '50001' }, { account: intended.to }, { chainId: 1 }, { txHash: `0x${'ab'.repeat(32)}` }, { receipt: { status: 'success', blockNumber: '-1' } }]) {
      await expect(validateJournal({ ...first.journal, ...patch })).rejects.toThrow();
    }
    await expect(runPayment(dir, { ...intended, sessionId: '8' }, rpc)).rejects.toThrow('different sessionId');
    const saved = JSON.parse(readFileSync(journalPath(dir, intended.requestId), 'utf8'));
    saved.receipt = { status: 'success', blockNumber: '123' };
    writeFileSync(journalPath(dir, intended.requestId), JSON.stringify(saved));
    await expect(runPayment(dir, intended, rpc)).rejects.toThrow('Cached receipt');
    rpc.receipt = async () => ({ status: 'success', blockNumber: 123n });
    await expect(runPayment(dir, intended, rpc)).rejects.toThrow('no matching AgentPaid');
  }));
  it('releases the OS lock after abrupt parent exit, without inspecting or deleting a PID file', withDirectory(async (dir) => {
    const path = join(dir, 'abrupt.lock');
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', "import { withOsLock } from './scripts/durable.ts'; await withOsLock(process.argv[1], async () => { process.stdout.write('held\\n'); process.exit(9); });", path], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      let output = ''; child.stdout.on('data', (data) => { output += data; }); child.once('error', reject); child.once('exit', (code) => resolve({ code, output }));
    });
    expect(result.code).toBe(9); expect(result.output).toContain('held');
    await withOsLock(path, async () => {});
  }));
  it('supports read-only reconciliation and an explicit nonce repair with the same payment ID', withDirectory(async (dir) => {
    const rpc = port(dir); let signs = 0;
    rpc.sign = async (intent) => { signs++; return sign(intent); };
    expect((await runPayment(dir, intended, rpc, { reconcileOnly: true })).status).toBe('pending'); expect(signs).toBe(0);
    const first = await runPayment(dir, intended, rpc);
    rpc.nonceConsumed = async () => true;
    expect((await runPayment(dir, intended, rpc)).status).toBe('nonce-consumed');
    rpc.sign = async (intent) => {
      signs++; rpc.nonceConsumed = async () => false;
      const raw = await agent.signTransaction({ chainId: intent.chainId, nonce: 2, gas: 100000n, gasPrice: 1n, to: intent.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay', args: [BigInt(intent.sessionId), intent.paymentId, intent.to, BigInt(intent.amount)] }) });
      return { signedTx: raw, txHash: keccak256(raw) };
    };
    const repaired = await runPayment(dir, intended, rpc, { retryConsumed: true });
    expect(repaired.journal.paymentId).toBe(first.journal.paymentId); expect(repaired.journal.txHash).not.toBe(first.journal.txHash); expect(signs).toBe(2);
  }));
});
