import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import worker, { VaultScheduler, type Env } from './worker';
const mock = vi.hoisted(() => ({ read: vi.fn(), preflight: vi.fn(), sign: vi.fn(), reconcile: vi.fn(), broadcast: vi.fn(), signFeeReturn: vi.fn(), reconcileFeeReturn: vi.fn() }));
vi.mock('./chain', () => ({ chainAccess: () => mock }));
const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const attacker = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const vault = '0x3333333333333333333333333333333333333333';
const origin = 'https://arcmandate.vercel.app';
function setup() {
  const data = new Map<string, unknown>(); let alarm: number | null = null; let tail = Promise.resolve();
  const storage = { get: async (key: string) => structuredClone(data.get(key)), put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, delete: async (key: string) => data.delete(key),
    setAlarm: async (at: number) => { alarm = at; }, deleteAlarm: async () => { alarm = null; }, transaction: async (fn: (s: unknown) => Promise<unknown>) => fn(storage) };
  const ctx = { storage, blockConcurrencyWhile: <T>(fn: () => Promise<T>) => { const result = tail.then(fn); tail = result.then(() => {}, () => {}); return result; } };
  const env = { APP_ORIGIN: origin, NETWORK: 'mainnet', AGENT_ENCRYPTION_KEY: 'ab'.repeat(32), MAX_PAYMENT_FEE_WEI: '10000000000000000' } as Env;
  const actor = new VaultScheduler(ctx as never, env);
  env.VAULTS = { idFromName: (id: string) => id, get: () => actor } as never;
  async function call(action: string, body: unknown = {}, token = '', requestOrigin = origin) {
    const response = await worker.fetch(new Request(`${origin}/v1/5042/${vault}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  async function login() {
    const challenge = (await call('challenge')).body;
    const signature = await owner.signMessage({ message: challenge.message });
    return (await call('login', { nonce: challenge.nonce, signature })).body.token as string;
  }
  return { data, call, login, actor, env, alarm: () => alarm };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.preflight.mockResolvedValue(undefined);
  mock.read.mockResolvedValue({ chainId: 5042, address: vault, owner: owner.address, active: false, sessionId: '0', agent: attacker.address,
    expiresAt: Date.now() + 600_000, budget: '100000', spent: '0', cap: '20000', balance: '100000', recipients: [owner.address] });
});
describe('hosted authorization and isolation', () => {
  it('rejects untrusted origins before accessing a vault', async () => {
    const f = setup(); expect((await f.call('challenge', {}, '', 'https://attacker.example')).status).toBe(403); expect(mock.read).not.toHaveBeenCalled();
  });
  it('rejects wrong network and unauthenticated mutations', async () => {
    const f = setup();
    expect((await f.call('agent')).status).toBe(400);
    await f.call('challenge'); expect((await f.call('agent')).status).toBe(401);
    const result = await worker.fetch(new Request(`https://api.example/v1/5042002/${vault}/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), f.env);
    expect(result.status).toBe(400);
  });
  it('requires the real owner, binds login to a server challenge, and rejects replay', async () => {
    const f = setup(); const challenge = (await f.call('challenge')).body;
    expect(challenge.message).toContain(origin); expect(challenge.message).toContain(vault); expect(challenge.message).toContain('5042');
    const bad = await attacker.signMessage({ message: challenge.message });
    expect((await f.call('login', { nonce: challenge.nonce, signature: bad })).status).toBe(400);
    const signature = await owner.signMessage({ message: challenge.message });
    const good = await f.call('login', { nonce: challenge.nonce, signature }); expect(good.status).toBe(200);
    expect((await f.call('login', { nonce: challenge.nonce, signature })).status).toBe(400);
    expect((await f.call('state', {}, good.body.token)).status).toBe(200);
  });
  it('creates one encrypted agent even with duplicate requests; public state omits secrets', async () => {
    const f = setup(), token = await f.login();
    const results = await Promise.all([f.call('agent', {}, token), f.call('agent', {}, token)]);
    expect(results[0].body.agent).toBe(results[1].body.agent);
    const state = f.data.get('state') as any;
    expect(state.agent.sealedKey).toMatch(/^v1:/); expect(JSON.stringify(results)).not.toContain('sealedKey');
    expect(JSON.stringify(f.data.get('login'))).not.toContain(token);
  });
  it('activates atomically, rejects duplicate plans, guards stale commands and preserves session identity', async () => {
    const f = setup(), token = await f.login(); const agent = (await f.call('agent', {}, token)).body.agent;
    mock.read.mockResolvedValue({ ...(await mock.read()), active: true, agent, sessionId: '7' });
    const input = { recipient: owner.address, amount: '10000', startAt: Date.now() + 120_000, intervalSeconds: 60, count: 2 };
    const results = await Promise.all([f.call('plan', input, token), f.call('plan', input, token)]);
    expect(results.map(x => x.status)).toEqual([200, 400]); expect(f.alarm()).toBe(input.startAt);
    const id = results[0].body.plan.id;
    expect((await f.call('pause', { planId: 'old' }, token)).status).toBe(400);
    expect((await f.call('pause', { planId: id }, token)).body.plan.status).toBe('paused'); expect(f.alarm()).toBeNull();
    mock.read.mockResolvedValue({ ...(await mock.read()), sessionId: '8' });
    expect((await f.call('resume', { planId: id }, token)).status).toBe(400);
    expect((await f.call('state', {}, token)).body.plan.sessionId).toBe('7');
  });
  it('rejects a plan before persistence or an alarm when payment readiness fails', async () => {
    const f = setup(), token = await f.login(); const agent = (await f.call('agent', {}, token)).body.agent;
    mock.read.mockResolvedValue({ ...(await mock.read()), active: true, agent, sessionId: '7' });
    mock.preflight.mockRejectedValue(new Error('Add USDC to the agent for network fees, then resume.'));
    const result = await f.call('plan', { recipient: owner.address, amount: '10000', startAt: Date.now() + 60_000, intervalSeconds: 60, count: 1 }, token);
    expect(result.status).toBe(400); expect((f.data.get('state') as any).plan).toBeUndefined();
    expect(f.alarm()).toBeNull(); expect(mock.sign).not.toHaveBeenCalled(); expect(mock.broadcast).not.toHaveBeenCalled();
  });
  it('runs an alarm without a browser request and persists the signed transaction before broadcasting', async () => {
    const f = setup(), token = await f.login(); const agent = (await f.call('agent', {}, token)).body.agent;
    mock.read.mockResolvedValue({ ...(await mock.read()), active: true, agent, sessionId: '7' });
    await f.call('plan', { recipient: owner.address, amount: '10000', startAt: Date.now() + 60_000, intervalSeconds: 60, count: 1 }, token);
    const state = f.data.get('state') as any; state.plan.startAt = Date.now() - 1000;
    mock.sign.mockResolvedValue({ signedTx: '0x1234', hash: `0x${'ab'.repeat(32)}` as Hex, nonce: 1 });
    mock.broadcast.mockImplementation(async () => { expect((f.data.get('state') as any).plan.payments[0].signedTx).toBe('0x1234'); });
    await f.actor.alarm(); expect(mock.broadcast).toHaveBeenCalledOnce(); expect(f.alarm()).not.toBeNull();
    mock.reconcile.mockResolvedValue('confirmed'); await f.actor.alarm();
    expect((f.data.get('state') as any).plan.status).toBe('completed'); expect(mock.broadcast).toHaveBeenCalledOnce(); expect(f.alarm()).toBeNull();
  });
  it('returns fees only to the owner after revocation and preserves the signed return before sending', async () => {
    const f = setup(), token = await f.login(); await f.call('agent', {}, token);
    expect((await f.call('return-fees', { recipient: attacker.address }, token)).status).toBe(400);
    mock.read.mockResolvedValue({ ...(await mock.read()), active: true });
    expect((await f.call('return-fees', {}, token)).status).toBe(400);
    mock.read.mockResolvedValue({ ...(await mock.read()), active: false });
    mock.signFeeReturn.mockResolvedValue({ signedTx: '0x1234', hash: `0x${'ab'.repeat(32)}`, nonce: 0, amount: '1000', status: 'signed', message: 'Pending' });
    const result = await f.call('return-fees', {}, token); expect(result.status).toBe(200); expect(result.body.feeReturn.signedTx).toBeUndefined();
    expect(mock.signFeeReturn.mock.calls[0][1]).toBe(owner.address);
    expect((await f.call('return-fees', {}, token)).status).toBe(400);
    mock.reconcileFeeReturn.mockResolvedValue('pending'); await f.actor.alarm(); expect(mock.broadcast).toHaveBeenCalledWith('0x1234');
    mock.reconcileFeeReturn.mockResolvedValue('confirmed'); await f.actor.alarm(); expect(f.alarm()).toBeNull();
    expect((await f.call('state', {}, token)).body.feeReturn.status).toBe('confirmed');
  });
  it('reports signing failure types without exposing RPC messages or signed bytes', async () => {
    const f = setup(), token = await f.login(); const agent = (await f.call('agent', {}, token)).body.agent;
    mock.read.mockResolvedValue({ ...(await mock.read()), active: true, agent, sessionId: '7' });
    await f.call('plan', { recipient: owner.address, amount: '10000', startAt: Date.now() + 60_000, intervalSeconds: 60, count: 1 }, token);
    (f.data.get('state') as any).plan.startAt = Date.now() - 1000;
    const cause = Object.assign(new Error('sensitive-signed-bytes'), { name: 'RpcRequestError', code: -32005 });
    mock.sign.mockRejectedValue(Object.assign(new Error('secret RPC credential', { cause }), { name: 'PaymentEstimationError' }));
    await f.actor.alarm();
    const state = (await f.call('state', {}, token)).body;
    expect(state.lastError).toContain('PaymentEstimationError'); expect(state.lastError).toContain('code -32005');
    expect(JSON.stringify(state)).not.toContain('sensitive-signed-bytes'); expect(JSON.stringify(state)).not.toContain('secret RPC credential');
    expect(state.plan.status).toBe('paused'); expect(mock.broadcast).not.toHaveBeenCalled();
  });
});
