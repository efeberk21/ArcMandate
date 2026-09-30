import { expect, it } from 'vitest';
import { buildPolicy, usdcInput } from './policy.js';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x2222222222222222222222222222222222222222';
const agent = '0x3333333333333333333333333333333333333333';
it('keeps USDC integer precision and rejects silent rounding', () => {
  expect(usdcInput('123456789.123456')).toBe(123456789123456n);
  for (const value of ['0.0000001', '1e6', '-1', '0', '1.0000000']) expect(() => usdcInput(value)).toThrow();
});
it('sorts recipients before signing and rejects invalid policy authority', () => {
  const form = { agent, budget: '0.15', cap: '0.05', minutes: '15', recipients: `${agent}\n${owner}` };
  const policy = buildPolicy(form, owner, vault, 100n);
  expect(policy.recipients).toEqual([owner, agent]); expect(policy.expiresAt).toBe(1000n);
  for (const change of [{ agent: owner }, { cap: '0.2' }, { recipients: `${agent}\n${agent}` }, { recipients: vault }, { minutes: '0' }]) {
    expect(() => buildPolicy({ ...form, ...change }, owner, vault, 100n)).toThrow();
  }
});
