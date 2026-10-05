import { encodeDeployData, getAddress, type Address, type Hex } from 'viem';
import { vaultAbi, vaultBytecode } from '../packages/core/src/generated/vault.js';
import { matchesVaultRuntime } from '../packages/core/src/runtime.js';
export function assertDeploymentProof(proof: {
  vault: Address; owner: Address; publicKey: Hex; expectedHash: Hex; runtime?: Hex;
  transaction: { hash: Hex; input: Hex; from: Address; to: Address | null; blockNumber: bigint | null };
  receipt: { transactionHash: Hex; status: 'success' | 'reverted'; contractAddress?: Address | null; blockNumber: bigint };
}): void {
  const { transaction: tx, receipt: r } = proof;
  if (r.status !== 'success' || !r.contractAddress || getAddress(r.contractAddress) !== getAddress(proof.vault) ||
    tx.hash !== proof.expectedHash || r.transactionHash !== proof.expectedHash || tx.blockNumber !== r.blockNumber || tx.to !== null ||
    getAddress(tx.from) !== getAddress(proof.owner)) throw new Error('Deployment receipt/address/sender/hash mismatch');
  const expected = encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args: [proof.owner, proof.publicKey] });
  if (tx.input.toLowerCase() !== expected.toLowerCase() || !matchesVaultRuntime(proof.runtime, proof.owner, proof.publicKey)) throw new Error('Deployment constructor/runtime mismatch');
}
