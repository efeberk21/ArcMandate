import { getAddress, isHex, pad, type Address, type Hex } from 'viem';
import { vaultImmutableSlots, vaultRuntime } from './generated/vault.js';

/** Instantiate every compiler-declared immutable, then compare every runtime byte. */
export function expectedVaultRuntime(owner: Address, publicKey: Hex): Hex {
  if (!isHex(publicKey, { strict: true }) || publicKey.length !== 66 || /^0x0{64}$/i.test(publicKey)) throw new Error('Invalid PQ public key');
  let runtime: string = vaultRuntime;
  const values = { owner: pad(getAddress(owner), { size: 32 }), pqPublicKey: publicKey };
  for (const name of ['owner', 'pqPublicKey'] as const) {
    for (const slot of vaultImmutableSlots[name]) {
      const start = 2 + slot.start * 2;
      runtime = runtime.slice(0, start) + values[name].slice(2) + runtime.slice(start + slot.length * 2);
    }
  }
  return runtime as Hex;
}

export function matchesVaultRuntime(code: Hex | undefined, owner: Address, publicKey: Hex): boolean {
  return code?.toLowerCase() === expectedVaultRuntime(owner, publicKey).toLowerCase();
}
