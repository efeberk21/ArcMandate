import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  freezeDigest,
  recipientsHash,
  startParamsHash,
  startSessionDigest,
  withdrawDigest,
  withdrawParamsHash,
  type Authorization,
  type DigestContext,
  type Policy,
} from './digest.js';

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/digest-vectors.json', import.meta.url), 'utf8'));
const context: DigestContext = {
  ...fixture.context,
  chainId: BigInt(fixture.context.chainId),
};
const policy: Policy = {
  ...fixture.policy,
  totalBudget: BigInt(fixture.policy.totalBudget),
  perTxCap: BigInt(fixture.policy.perTxCap),
  expiresAt: BigInt(fixture.policy.expiresAt),
};
const auth: Authorization = {
  nonce: BigInt(fixture.auth.nonce),
  sessionId: BigInt(fixture.auth.sessionId),
  deadline: BigInt(fixture.auth.deadline),
};
const to = fixture.withdrawal.to;
const amount = BigInt(fixture.withdrawal.amount);

describe('ArcMandate authorization vectors', () => {
  it('matches fixed START, FREEZE, WITHDRAW hashes', () => {
    expect(recipientsHash(policy.recipients)).toBe(fixture.expected.recipientsHash);
    expect(startParamsHash(policy)).toBe(fixture.expected.startParamsHash);
    expect(startSessionDigest(context, policy, auth)).toBe(fixture.expected.startDigest);
    expect(freezeDigest(context, auth)).toBe(fixture.expected.freezeDigest);
    expect(withdrawParamsHash(to, amount)).toBe(fixture.expected.withdrawParamsHash);
    expect(withdrawDigest(context, to, amount, auth)).toBe(fixture.expected.withdrawDigest);
  });

  it('changes on domain-relevant fields', () => {
    const base = startSessionDigest(context, policy, auth);
    expect(startSessionDigest({ ...context, chainId: context.chainId + 1n }, policy, auth)).not.toBe(base);
    expect(startSessionDigest({ ...context, vault: '0x9999999999999999999999999999999999999999' }, policy, auth)).not.toBe(base);
    expect(startSessionDigest(context, { ...policy, totalBudget: policy.totalBudget + 1n }, auth)).not.toBe(base);
    expect(startSessionDigest(context, policy, { ...auth, nonce: auth.nonce + 1n })).not.toBe(base);
    expect(freezeDigest(context, auth)).not.toBe(base);
  });
});
