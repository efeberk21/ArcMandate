import { assertAuthority, dueAt, paymentFor, pendingPayment, type Payment, type Plan, type RecordState, type Vault } from './model.js';
import type { Hex } from 'viem';

export interface ExecutionPort {
  read(): Promise<Vault>;
  sign(plan: Plan, payment: Payment): Promise<{ signedTx: Hex; hash: Hex; nonce: number }>;
  reconcile(plan: Plan, payment: Payment): Promise<'pending' | 'confirmed' | 'reverted' | 'nonce-conflict'>;
  broadcast(signed: Hex): Promise<void>;
  save(state: RecordState): Promise<void>;
}

/** Caller serializes all mutations per vault/agent. Save signed bytes before any broadcast. */
export async function tick(state: RecordState, port: ExecutionPort, now = Date.now()): Promise<void> {
  const p = state.plan;
  if (!p) return;
  state.lastCheckedAt = now;
  state.lastError = undefined;
  p.updatedAt = now;
  let item = pendingPayment(p);
  if (item?.status === 'signed') {
    const result = await port.reconcile(p, item);
    if (result === 'confirmed' || result === 'reverted') {
      item.status = result === 'confirmed' ? 'confirmed' : 'failed';
      item.message = result === 'confirmed' ? 'Confirmed onchain.' : 'Transaction reverted. Plan paused; no automatic replacement.';
      p.nextIndex = item.index + 1;
      if (result === 'reverted') p.status = 'paused';
      if (p.nextIndex === p.count && result === 'confirmed') p.status = 'completed';
      p.message = item.message;
      await port.save(state);
      return;
    }
    if (result === 'nonce-conflict') {
      p.status = 'paused'; p.message = 'Agent nonce changed without matching payment proof. Review required; no new transaction will be signed.';
      await port.save(state); return;
    }
  }
  if (p.status !== 'running') { await port.save(state); return; }
  if (!item && p.nextIndex >= p.count) {
    p.status = 'completed'; p.message = 'All scheduled times processed.'; await port.save(state); return;
  }
  if (!item && dueAt(p, p.nextIndex) > now) { await port.save(state); return; }
  // A missed time is recorded, never caught up in a burst after downtime.
  while (!item && p.nextIndex < p.count && now >= dueAt(p, p.nextIndex) + 60_000) {
    p.payments.push({ ...paymentFor(p, p.nextIndex), status: 'missed', message: 'Time missed; no payment sent.' });
    p.nextIndex++;
  }
  if (!item && p.nextIndex >= p.count) {
    p.status = 'completed'; p.message = 'Schedule ended; missed times were not charged.'; await port.save(state); return;
  }
  if (!item && dueAt(p, p.nextIndex) > now) { await port.save(state); return; }
  try { assertAuthority(await port.read(), p.agent, p.sessionId, p.recipient, BigInt(p.amount)); }
  catch (error) {
    p.status = 'paused'; p.message = error instanceof Error && error.constructor === Error ? error.message : 'Unable to verify spending authority. Check the network and resume.';
    if (item?.status === 'intent') { item.status = 'failed'; item.message = p.message; p.nextIndex = item.index + 1; }
    await port.save(state); return;
  }
  if (!item) { item = paymentFor(p, p.nextIndex); p.payments.push(item); await port.save(state); }
  if (item.status === 'intent') {
    if (now >= item.dueAt + 60_000) { item.status = 'missed'; item.message = 'Time missed before signing.'; p.nextIndex++; await port.save(state); return; }
    Object.assign(item, await port.sign(p, item), { status: 'signed' });
    p.message = 'Payment signed; waiting for confirmation.';
    await port.save(state);
  }
  // Only identical saved bytes can be rebroadcast; never make a new ID or nonce on a timeout.
  await port.broadcast(item.signedTx!);
  await port.save(state);
}

export function nextWake(state: RecordState, now = Date.now()): number | null {
  if (state.feeReturn?.status === 'signed') return now + 30_000;
  const p = state.plan;
  if (!p) return null;
  if (pendingPayment(p)?.status === 'signed') return now + 30_000;
  if (p.status !== 'running') return null;
  return Math.max(now + 1_000, dueAt(p, p.nextIndex));
}
