import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

export type Policy = {
  agent: Address;
  totalBudget: bigint;
  perTxCap: bigint;
  expiresAt: bigint;
  recipients: Address[];
};

export type Authorization = {
  nonce: bigint;
  sessionId: bigint;
  deadline: bigint;
};

export type DigestContext = {
  chainId: bigint;
  vault: Address;
  owner: Address;
};

export const DOMAIN = keccak256(stringToHex('ArcMandate'));
export const VERSION = keccak256(stringToHex('1'));
export const START = keccak256(stringToHex('START_SESSION'));
export const FREEZE = keccak256(stringToHex('FREEZE'));
export const WITHDRAW = keccak256(stringToHex('WITHDRAW'));
export const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex;

const recipientsAbi = parseAbiParameters('address[]');
const startAbi = parseAbiParameters('address, uint256, uint256, uint256, bytes32');
const withdrawAbi = parseAbiParameters('address, uint256');
const digestAbi = parseAbiParameters(
  'bytes32, bytes32, uint256, address, address, bytes32, uint256, uint256, uint256, bytes32',
);

export function recipientsHash(recipients: Address[]): Hex {
  return keccak256(encodeAbiParameters(recipientsAbi, [recipients]));
}

export function startParamsHash(policy: Policy): Hex {
  return keccak256(
    encodeAbiParameters(startAbi, [
      policy.agent,
      policy.totalBudget,
      policy.perTxCap,
      policy.expiresAt,
      recipientsHash(policy.recipients),
    ]),
  );
}

export function withdrawParamsHash(to: Address, amount: bigint): Hex {
  return keccak256(encodeAbiParameters(withdrawAbi, [to, amount]));
}

export function authorizationDigest(
  context: DigestContext,
  action: Hex,
  auth: Authorization,
  paramsHash: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(digestAbi, [
      DOMAIN,
      VERSION,
      context.chainId,
      context.vault,
      context.owner,
      action,
      auth.nonce,
      auth.sessionId,
      auth.deadline,
      paramsHash,
    ]),
  );
}

export function startSessionDigest(context: DigestContext, policy: Policy, auth: Authorization): Hex {
  return authorizationDigest(context, START, auth, startParamsHash(policy));
}

export function freezeDigest(context: DigestContext, auth: Authorization): Hex {
  return authorizationDigest(context, FREEZE, auth, ZERO_HASH);
}

export function withdrawDigest(
  context: DigestContext,
  to: Address,
  amount: bigint,
  auth: Authorization,
): Hex {
  return authorizationDigest(context, WITHDRAW, auth, withdrawParamsHash(to, amount));
}
