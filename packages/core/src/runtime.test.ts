import { describe, it, expect } from 'vitest';
import { expectedVaultRuntime, matchesVaultRuntime } from './runtime.js';
import { vaultImmutableSlots } from './generated/vault.js';

describe('full vault runtime identity (R01)', () => {
  it('instantiates every immutable for different legitimate owners and keys', () => {
    for (const digit of ['1', '2']) {
      const owner = `0x${digit.repeat(40)}` as const;
      const key = `0x${digit.repeat(64)}` as const;
      const code = expectedVaultRuntime(owner, key);
      expect(matchesVaultRuntime(code, owner, key)).toBe(true);
      for (const slot of vaultImmutableSlots.owner) expect(code.slice(2 + slot.start * 2, 2 + (slot.start + 32) * 2)).toBe('0'.repeat(24) + owner.slice(2));
      expect(matchesVaultRuntime(code, '0x3333333333333333333333333333333333333333', key)).toBe(false);
      expect(matchesVaultRuntime(code, owner, `0x${'a'.repeat(64)}`)).toBe(false);
    }
  });
  it('rejects fake getters, proxy code and a single altered runtime byte', () => {
    const owner = '0x1111111111111111111111111111111111111111'; const key = `0x${'ab'.repeat(32)}` as const;
    expect(matchesVaultRuntime('0x60006000', owner, key)).toBe(false);
    expect(matchesVaultRuntime(undefined, owner, key)).toBe(false);
    const code = expectedVaultRuntime(owner, key);
    expect(matchesVaultRuntime(`0xff${code.slice(4)}`, owner, key)).toBe(false);
  });
});
