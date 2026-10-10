import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';

export type Vault = {
  chainId: number; address: Address; owner: Address; agent: Address; sessionId: string;
  active: boolean; expiresAt: number; budget: string; spent: string; cap: string;
  balance: string; recipients: Address[];
};
export type Schedule = { recipient: Address; amount: string; startAt: number; intervalSeconds: number; count: number };
export type Payment = {
  index: number; dueAt: number; paymentId: Hex;
  status: 'intent' | 'signed' | 'confirmed' | 'missed' | 'failed';
  signedTx?: Hex; hash?: Hex; nonce?: number; block?: string; message?: string;
};
export type Plan = Schedule & {
  id: string; sessionId: string; agent: Address; status: 'running' | 'paused' | 'completed' | 'stopped';
  createdAt: number; updatedAt: number; nextIndex: number; payments: Payment[]; message: string;
};
export type Agent = { address: Address; sealedKey: string };
export type FeeReturn = { signedTx: Hex; hash: Hex; nonce: number; amount: string; status: 'signed' | 'confirmed' | 'failed'; message: string };
export type RecordState = {
  vault: Address; owner: Address; chainId: number; agent?: Agent; plan?: Plan;
  history: Plan[]; lastCheckedAt?: number; lastError?: string; feeReturn?: FeeReturn;
};
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const dueAt = (p: Schedule, index: number) => p.startAt + p.intervalSeconds * 1000 * index;
export const pendingPayment = (p?: Plan) => p?.payments.find(x => x.status === 'intent' || x.status === 'signed');
export function assertAuthority(v: Vault, agent: Address, sessionId: string, recipient: Address, amount: bigint) {
  if (!v.active || v.sessionId !== sessionId || !same(v.agent, agent)) throw new Error('Session was frozen or replaced. Authorize a new plan.');
  if (v.expiresAt <= Date.now()) throw new Error('Session expired.');
  if (!v.recipients.some(a => same(a, recipient))) throw new Error('Recipient is not allowed.');
  if (amount <= 0n || amount > BigInt(v.cap)) throw new Error('Per-payment limit exceeded.');
  if (amount > BigInt(v.budget) - BigInt(v.spent)) throw new Error('Session budget exhausted.');
  if (amount > BigInt(v.balance)) throw new Error('Insufficient vault USDC.');
}
export function parseSchedule(raw: unknown, v: Vault, agent: Address, now = Date.now()): Schedule {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid payment plan.');
  const s = raw as Schedule;
  if (Object.keys(s).sort().join(',') !== 'amount,count,intervalSeconds,recipient,startAt') throw new Error('Unexpected plan fields.');
  const recipient = getAddress(s.recipient);
  if (typeof s.amount !== 'string' || !/^[1-9][0-9]{0,29}$/.test(s.amount)) throw new Error('Invalid USDC amount.');
  if (!Number.isSafeInteger(s.count) || s.count < 1 || s.count > 100) throw new Error('Choose 1–100 payments.');
  if (!Number.isSafeInteger(s.intervalSeconds) || s.intervalSeconds < 60 || s.intervalSeconds > 2_592_000) throw new Error('Interval must be 1 minute to 30 days.');
  if (!Number.isSafeInteger(s.startAt) || s.startAt < now + 30_000 || s.startAt > now + 2_592_000_000) throw new Error('First payment must be 30 seconds to 30 days from now.');
  assertAuthority(v, agent, v.sessionId, recipient, BigInt(s.amount));
  if (dueAt(s, s.count - 1) >= v.expiresAt) throw new Error('All payments must fall before the session expires.');
  if (BigInt(s.amount) * BigInt(s.count) > BigInt(v.budget) - BigInt(v.spent)) throw new Error('Plan total exceeds remaining session budget.');
  if (BigInt(s.amount) * BigInt(s.count) > BigInt(v.balance)) throw new Error('Fund the vault for the full plan first.');
  return { recipient, amount: s.amount, startAt: s.startAt, intervalSeconds: s.intervalSeconds, count: s.count };
}
export function createPlan(schedule: Schedule, vault: Vault, agent: Address, now = Date.now()): Plan {
  return { ...schedule, id: crypto.randomUUID(), sessionId: vault.sessionId, agent, status: 'running', createdAt: now,
    updatedAt: now, nextIndex: 0, payments: [], message: 'Scheduled. Payments run even when this page is closed.' };
}
export function paymentFor(p: Plan, index: number): Payment {
  return { index, dueAt: dueAt(p, index), paymentId: keccak256(toHex(`ArcMandate/schedule/v1/${p.id}/${index}`)), status: 'intent' };
}
export function publicState(s: RecordState) {
  const clean = (p: Plan) => ({ ...p, payments: p.payments.map(({ signedTx: _signed, ...payment }) => payment) });
  const { signedTx: _signed, ...feeReturn } = s.feeReturn ?? {};
  return { vault: s.vault, chainId: s.chainId, agent: s.agent?.address ?? null, plan: s.plan ? clean(s.plan) : null,
    history: s.history.map(clean), lastCheckedAt: s.lastCheckedAt ?? null, lastError: s.lastError ?? null, feeReturn: s.feeReturn ? feeReturn : null };
}
