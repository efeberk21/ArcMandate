import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from 'viem';
import type { Policy } from './digest.js';

export function addressInput(value: string, label: string): Address {
  if (!isAddress(value.trim())) throw new Error(`${label} must be a valid EVM address`);
  const address = getAddress(value.trim());
  if (address === zeroAddress) throw new Error(`${label} cannot be the zero address`);
  return address;
}

export function usdcInput(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.trim())) {
    throw new Error('Enter a positive USDC amount with at most 6 decimal places');
  }
  const amount = parseUnits(value.trim(), 6);
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('USDC amount is outside the supported range');
  return amount;
}

export function buildPolicy(input: {
  agent: string; budget: string; cap: string; minutes: string; recipients: string;
}, owner: Address, vault: Address, timestamp: bigint): Policy {
  const agent = addressInput(input.agent, 'Agent');
  if (agent === getAddress(owner) || agent === getAddress(vault)) throw new Error('Agent must differ from owner and vault');
  const totalBudget = usdcInput(input.budget);
  const perTxCap = usdcInput(input.cap);
  if (perTxCap > totalBudget) throw new Error('Per-payment cap cannot exceed the total budget');
  if (!/^[1-9]\d*$/.test(input.minutes) || BigInt(input.minutes) > 525600n) {
    throw new Error('Duration must be 1–525600 minutes');
  }
  const recipients = input.recipients.split(/[\s,]+/).filter(Boolean).map((value) => addressInput(value, 'Recipient'));
  if (recipients.length < 1 || recipients.length > 5) throw new Error('Choose 1–5 recipients');
  if (new Set(recipients).size !== recipients.length) throw new Error('Recipients must be unique');
  if (recipients.includes(getAddress(vault))) throw new Error('Vault cannot be a recipient');
  recipients.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  return { agent, totalBudget, perTxCap, expiresAt: timestamp + BigInt(input.minutes) * 60n, recipients };
}
