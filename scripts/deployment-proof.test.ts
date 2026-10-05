import { describe, expect, it } from 'vitest';
import { encodeDeployData, type Hex } from 'viem';
import { vaultAbi, vaultBytecode } from '../packages/core/src/generated/vault.js';
import { expectedVaultRuntime } from '../packages/core/src/runtime.js';
import { assertDeploymentProof } from './deployment-proof.js';
describe('release deployment binding (R12)', () => {
  it('rejects swapped receipts, vaults, constructors and runtimes', () => {
    const owner = '0x1111111111111111111111111111111111111111'; const vault = '0x2222222222222222222222222222222222222222';
    const key = `0x${'ab'.repeat(32)}` as Hex; const hash = `0x${'cd'.repeat(32)}` as Hex;
    const proof: Parameters<typeof assertDeploymentProof>[0] = { owner, vault, publicKey: key, expectedHash: hash, runtime: expectedVaultRuntime(owner, key),
      transaction: { hash, input: encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args: [owner,key] }), from: owner, to: null, blockNumber: 10n },
      receipt: { transactionHash: hash, status: 'success' as const, contractAddress: vault, blockNumber: 10n } };
    expect(() => assertDeploymentProof(proof)).not.toThrow();
    expect(() => assertDeploymentProof({ ...proof, vault: owner })).toThrow('mismatch');
    expect(() => assertDeploymentProof({ ...proof, receipt: { ...proof.receipt, status: 'reverted' } })).toThrow('mismatch');
    expect(() => assertDeploymentProof({ ...proof, expectedHash: `0x${'ef'.repeat(32)}` })).toThrow('mismatch');
    expect(() => assertDeploymentProof({ ...proof, publicKey: `0x${'01'.repeat(32)}` })).toThrow('mismatch');
    expect(() => assertDeploymentProof({ ...proof, runtime: '0x6000' })).toThrow('mismatch');
  });
});
