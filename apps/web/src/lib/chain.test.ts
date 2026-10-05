import { describe, expect, it, vi } from 'vitest';
import { PQ_VERIFIER_ADDRESS, USDC_ADDRESS } from '@arcmandate/core';
import { expectedVaultRuntime } from '@arcmandate/core/runtime';
import { readVault, type ArcClient } from './chain';
const owner = '0x1111111111111111111111111111111111111111'; const vault = '0x2222222222222222222222222222222222222222';
const publicKey = `0x${'ab'.repeat(32)}` as const;
function fake(code: string) {
  const fields: Record<string, unknown> = { owner, pqPublicKey: publicKey, sessionId: 1n, controlNonce: 1n, active: true,
    currentPolicy: { agent: vault, totalBudget: 1n, perTxCap: 1n, expiresAt: 200n, recipients: [owner] },
    spent: 0n, balanceOf: 1n, USDC_ADDRESS, PQ_VERIFIER_ADDRESS };
  return { chain: { id: 5042002 }, getChainId: async () => 5042002, getBlock: async () => ({ number: 100n, timestamp: 100n }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => fields[functionName]), getBytecode: async () => code };
}
describe('read-only versus trusted vault and RPC identity (R01/R09)', () => {
  it('keeps matching fake getters and proxy runtimes read only while trusting the complete legitimate runtime', async () => {
    for (const code of ['0x6000','0x363d3d373d3d3d363d73']) expect((await readVault(fake(code) as unknown as ArcClient, vault)).trusted).toBe(false);
    expect((await readVault(fake(expectedVaultRuntime(owner, publicKey)) as unknown as ArcClient, vault)).trusted).toBe(true);
  });
  it('rejects a wrong-chain override before reading authorization fields', async () => {
    const rpc = fake('0x6000'); rpc.getChainId = async () => 1;
    await expect(readVault(rpc as unknown as ArcClient, vault)).rejects.toThrow('RPC chain');
    expect(rpc.readContract).not.toHaveBeenCalled();
  });
});
