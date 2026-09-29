import { writeFileSync } from 'node:fs';
import {
  freezeDigest,
  recipientsHash,
  startParamsHash,
  startSessionDigest,
  withdrawDigest,
  withdrawParamsHash,
  ZERO_HASH,
  type Authorization,
  type DigestContext,
  type Policy,
} from '../packages/core/src/digest.js';

const context: DigestContext = {
  chainId: 5_042_002n,
  vault: '0x1111111111111111111111111111111111111111',
  owner: '0x2222222222222222222222222222222222222222',
};
const policy: Policy = {
  agent: '0x3333333333333333333333333333333333333333',
  totalBudget: 150_000n,
  perTxCap: 50_000n,
  expiresAt: 1_900_000_000n,
  recipients: [
    '0x4444444444444444444444444444444444444444',
    '0x5555555555555555555555555555555555555555',
  ],
};
const auth: Authorization = { nonce: 7n, sessionId: 3n, deadline: 1_899_999_000n };
const withdrawal = { to: '0x6666666666666666666666666666666666666666' as const, amount: 77_777n };

const vector = {
  description: 'Public test-only inputs. Never use these addresses or values as deployment authority.',
  context,
  policy,
  auth,
  withdrawal,
  expected: {
    recipientsHash: recipientsHash(policy.recipients),
    startParamsHash: startParamsHash(policy),
    startDigest: startSessionDigest(context, policy, auth),
    freezeParamsHash: ZERO_HASH,
    freezeDigest: freezeDigest(context, auth),
    withdrawParamsHash: withdrawParamsHash(withdrawal.to, withdrawal.amount),
    withdrawDigest: withdrawDigest(context, withdrawal.to, withdrawal.amount, auth),
  },
};
writeFileSync(
  new URL('../fixtures/digest-vectors.json', import.meta.url),
  `${JSON.stringify(vector, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`,
);
console.log('Wrote fixtures/digest-vectors.json');
