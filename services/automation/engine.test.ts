import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPlan, parseSchedule, pendingPayment, publicState, type Vault, type RecordState, type Schedule } from './model';
import { tick, nextWake, type ExecutionPort } from './engine';
import { seal, unseal } from './crypto';

const owner = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const address = '0x3333333333333333333333333333333333333333';
const key = `0x${'ab'.repeat(32)}` as const;
const now = 1_800_000_000_000;
const vault: Vault = { chainId: 5042, address, owner, agent, active: true, sessionId: '1', expiresAt: now + 600_000,
  budget: '100000', spent: '0', cap: '20000', balance: '100000', recipients: [owner] };
const schedule: Schedule = { recipient: owner, amount: '10000', startAt: now + 60_000, intervalSeconds: 60, count: 3 };
function fixture() {
  const state: RecordState = { vault: address, owner, chainId: 5042, agent: { address: agent, sealedKey: 'secret' }, history: [], plan: createPlan(schedule, vault, agent, now) };
  let disk = structuredClone(state);
  const port: ExecutionPort = {
    read: vi.fn(async () => vault),
    sign: vi.fn(async () => ({ signedTx: '0x1234', hash: key, nonce: 4 })),
    reconcile: vi.fn(async () => 'pending'),
    broadcast: vi.fn(async () => {}),
    save: vi.fn(async s => { disk = structuredClone(s); }),
  };
  return { state, port, disk: () => structuredClone(disk) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe('scheduled payments', () => {
  it('validates the entire cost, expiry, count and recipient before activation', () => {
    expect(parseSchedule(schedule, vault, agent)).toEqual(schedule);
    expect(() => parseSchedule({ ...schedule, count: 11 }, vault, agent)).toThrow();
    expect(() => parseSchedule({ ...schedule, recipient: agent }, vault, agent)).toThrow('Recipient');
    expect(() => parseSchedule({ ...schedule, startAt: now }, vault, agent)).toThrow('First');
    expect(() => parseSchedule({ ...schedule, count: 100 }, vault, agent)).toThrow();
    expect(() => parseSchedule({ ...schedule, amount: '1e4' }, vault, agent)).toThrow();
    expect(() => parseSchedule({ ...schedule, count: 1.5 }, vault, agent)).toThrow();
    expect(() => parseSchedule({ ...schedule, extra: 'field' }, vault, agent)).toThrow();
  });
  it('does not sign or send before the scheduled time', async () => {
    const f = fixture(); await tick(f.state, f.port, now);
    expect(f.port.sign).not.toHaveBeenCalled(); expect(nextWake(f.state, now)).toBe(schedule.startAt);
  });
  it('persists signed bytes and identity before broadcast', async () => {
    const f = fixture();
    f.port.broadcast = vi.fn(async raw => { expect(f.disk().plan!.payments[0].signedTx).toBe(raw); expect(f.disk().plan!.payments[0].status).toBe('signed'); });
    await tick(f.state, f.port, schedule.startAt);
    expect(f.port.sign).toHaveBeenCalledOnce(); expect(f.port.broadcast).toHaveBeenCalledOnce();
  });
  it('recovers a crash after signing without a new identity, nonce or signature', async () => {
    const f = fixture(); f.port.broadcast = vi.fn(async () => { throw new Error('crash'); });
    await expect(tick(f.state, f.port, schedule.startAt)).rejects.toThrow('crash');
    const restored = f.disk(), original = restored.plan!.payments[0];
    f.port.broadcast = vi.fn(async () => {});
    await tick(restored, f.port, schedule.startAt + 1000);
    expect(f.port.sign).toHaveBeenCalledOnce(); expect(f.port.broadcast).toHaveBeenCalledWith(original.signedTx);
    expect(restored.plan!.payments).toHaveLength(1);
  });
  it('reconciles a mined payment after crash instead of broadcasting again', async () => {
    const f = fixture(); await tick(f.state, f.port, schedule.startAt);
    f.port.reconcile = vi.fn(async () => 'confirmed');
    await tick(f.disk(), f.port, schedule.startAt + 1000);
    expect(f.port.broadcast).toHaveBeenCalledOnce(); expect(f.disk().plan!.nextIndex).toBe(1);
  });
  it('never pays several missed times in a catch-up burst', async () => {
    const f = fixture(); await tick(f.state, f.port, now + 190_000);
    expect(f.state.plan!.payments.map(x => x.status)).toEqual(['missed', 'missed', 'signed']);
    expect(f.port.broadcast).toHaveBeenCalledOnce();
  });
  it('finishes an entirely missed schedule without spending', async () => {
    const f = fixture(); await tick(f.state, f.port, now + 400_000);
    expect(f.state.plan!.status).toBe('completed'); expect(f.port.sign).not.toHaveBeenCalled(); expect(nextWake(f.state)).toBeNull();
  });
  for (const change of [{ active: false }, { sessionId: '3' }, { agent: owner }, { expiresAt: now }, { spent: '100000' }, { cap: '1' }, { balance: '0' }, { recipients: [] }]) {
    it(`blocks revoked, replaced, expired or invalid authority: ${JSON.stringify(change)}`, async () => {
      const f = fixture(); f.port.read = vi.fn(async () => ({ ...vault, ...change }));
      await tick(f.state, f.port, schedule.startAt);
      expect(f.port.sign).not.toHaveBeenCalled(); expect(f.port.broadcast).not.toHaveBeenCalled(); expect(f.state.plan!.status).toBe('paused');
    });
  }
  it('pauses on a nonce conflict and never silently replaces the transaction', async () => {
    const f = fixture(); await tick(f.state, f.port, schedule.startAt);
    f.port.reconcile = vi.fn(async () => 'nonce-conflict');
    await tick(f.state, f.port, schedule.startAt + 1000);
    expect(f.state.plan!.status).toBe('paused'); expect(f.port.broadcast).toHaveBeenCalledOnce(); expect(f.port.sign).toHaveBeenCalledOnce();
  });
  it('does not rebroadcast a pending transaction while paused or stopped', async () => {
    const f = fixture(); await tick(f.state, f.port, schedule.startAt);
    f.state.plan!.status = 'paused'; await tick(f.state, f.port, schedule.startAt + 1000);
    f.state.plan!.status = 'stopped'; await tick(f.state, f.port, schedule.startAt + 2000);
    expect(f.port.broadcast).toHaveBeenCalledOnce(); expect(f.port.reconcile).toHaveBeenCalledTimes(2);
  });
  it('reverts stop automatic continuation; confirmed items cannot be sent twice', async () => {
    const f = fixture(); await tick(f.state, f.port, schedule.startAt);
    f.port.reconcile = vi.fn(async () => 'reverted'); await tick(f.state, f.port, schedule.startAt + 1000);
    expect(f.state.plan!.status).toBe('paused'); expect(pendingPayment(f.state.plan)).toBeUndefined();
    await tick(f.state, f.port, now + 130_000); expect(f.port.sign).toHaveBeenCalledOnce();
  });
  it('public output excludes agent secrets and signed transactions', async () => {
    const f = fixture(); await tick(f.state, f.port, schedule.startAt);
    const publicJson = JSON.stringify(publicState(f.state)); expect(publicJson).not.toContain('sealedKey'); expect(publicJson).not.toContain('secret'); expect(publicJson).not.toContain('signedTx');
  });
  it('encrypts each key with authenticated vault/network binding', async () => {
    const secret = 'ef'.repeat(32); const encrypted = await seal(key, secret, '5042:vault1');
    expect(encrypted).not.toContain(key); expect(await unseal(encrypted, secret, '5042:vault1')).toBe(key);
    await expect(unseal(encrypted, secret, '5042:vault2')).rejects.toThrow();
    await expect(unseal(encrypted, '12'.repeat(32), '5042:vault1')).rejects.toThrow();
  });
});
