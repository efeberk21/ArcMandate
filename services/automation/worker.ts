import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { ARC_NETWORKS } from '../../packages/core/src/config.js';
import { chainAccess } from './chain.js';
import { digest, seal, unseal } from './crypto.js';
import { nextWake, tick } from './engine.js';
import { assertAuthority, createPlan, parseSchedule, paymentFor, pendingPayment, publicState, same, type RecordState } from './model.js';

export interface Env {
  VAULTS: DurableObjectNamespace; APP_ORIGIN: string; NETWORK: 'testnet' | 'mainnet';
  AGENT_ENCRYPTION_KEY: string; MAX_PAYMENT_FEE_WEI: string; RPC_URL?: string;
}
type Challenge = { nonce: string; message: string; expiresAt: number };
type Login = { tokenHash: string; expiresAt: number };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const safeError = (error: unknown) => {
  if (error instanceof Error && error.constructor === Error && error.name === 'Error') return error.message;
  // Only controlled exception names and numeric codes: RPC errors can contain keys,
  // serialized transactions, request headers or credential-bearing URLs in messages.
  const types: string[] = [];
  let cause = error;
  for (let i = 0; i < 6 && cause instanceof Error; i++) {
    if (/^[A-Za-z]{1,70}Error$/.test(cause.name)) types.push(cause.name);
    const code = (cause as Error & { code?: unknown }).code;
    if (typeof code === 'number' && Number.isSafeInteger(code)) types.push(`code ${code}`);
    cause = cause.cause;
  }
  return `Service or network unavailable${types.length ? ` (${types.join(', ')})` : ''}. Your saved payment identity is preserved; refresh or resume after checking the status.`;
};
function pathInfo(url: string) {
  const match = new URL(url).pathname.match(/^\/v1\/(5042|5042002)\/(0x[0-9a-fA-F]{40})\/(challenge|login|state|agent|plan|pause|resume|stop|return-fees)$/);
  if (!match) throw new Error('Unknown automation endpoint.');
  return { chainId: Number(match[1]), vault: getAddress(match[2]), action: match[3] };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.APP_ORIGIN) return json({ error: 'Origin not allowed.' }, 403);
    let response: Response;
    try {
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (new URL(request.url).pathname === '/health') response = json({ configured: /^[a-f0-9]{64}$/i.test(env.AGENT_ENCRYPTION_KEY ?? ''), chainId: ARC_NETWORKS[env.NETWORK].chainId, version: 1 });
      else {
        if (!/^[a-f0-9]{64}$/i.test(env.AGENT_ENCRYPTION_KEY ?? '')) throw new Error('Automation service is not configured.');
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
        if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json({ error: 'JSON required.' }, 415);
        const { vault, chainId } = pathInfo(request.url);
        if (chainId !== ARC_NETWORKS[env.NETWORK].chainId) throw new Error('Automation service is on another network.');
        const text = await request.text();
        if (text.length > 8192) return json({ error: 'Request too large.' }, 413);
        const stub = env.VAULTS.get(env.VAULTS.idFromName(`${chainId}:${vault.toLowerCase()}`));
        response = await stub.fetch(new Request(request.url, { method: 'POST', headers: request.headers, body: text }));
      }
    } catch (error) { response = json({ error: safeError(error) }, 400); }
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', env.APP_ORIGIN);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  },
};

/** One durable actor per chain/vault; all API mutations and alarms share its serialization gate. */
export class VaultScheduler {
  constructor(private ctx: DurableObjectState, private env: Env) {}
  fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try { return await this.handle(request); }
      catch (error) { return json({ error: safeError(error) }, 400); }
    });
  }
  private async store(state: RecordState, alarm: number | null) {
    await this.ctx.storage.transaction(async tx => {
      await tx.put('state', state);
      if (alarm === null) await tx.deleteAlarm(); else await tx.setAlarm(alarm);
    });
  }
  private async handle(request: Request): Promise<Response> {
    const { vault, chainId, action } = pathInfo(request.url);
    const body = await request.json() as Record<string, unknown>;
    const access = chainAccess(this.env.NETWORK, this.env.RPC_URL);
    let state = await this.ctx.storage.get<RecordState>('state');
    if (action === 'challenge') {
      const now = Date.now();
      const challenges = (await this.ctx.storage.get<Challenge[]>('challenges') ?? []).filter(x => x.expiresAt > now);
      if (challenges.length >= 8) throw new Error('Too many sign-in attempts. Try again in five minutes.');
      if (!state) {
        const v = await access.read(vault);
        state = { vault, owner: v.owner, chainId, history: [] };
        await this.ctx.storage.put('state', state);
      }
      const challenge: Challenge = { nonce: crypto.randomUUID(), expiresAt: now + 300_000, message: '' };
      challenge.message = `${this.env.APP_ORIGIN}\nArcMandate scheduled payments\nSign in to manage this vault's payment plans. This signature sends no transaction and grants no new onchain spending authority.\nOwner: ${state.owner}\nVault: ${vault}\nChain ID: ${chainId}\nNonce: ${challenge.nonce}\nIssued at: ${new Date(now).toISOString()}\nExpires at: ${new Date(challenge.expiresAt).toISOString()}`;
      await this.ctx.storage.put('challenges', [...challenges, challenge]);
      return json({ ...challenge, owner: state.owner });
    }
    if (!state || state.chainId !== chainId || !same(state.vault, vault)) throw new Error('Sign in to this vault first.');
    if (action === 'login') {
      const challenges = await this.ctx.storage.get<Challenge[]>('challenges') ?? [];
      const challenge = challenges.find(c => c.nonce === body.nonce);
      if (!challenge || challenge.expiresAt <= Date.now() || typeof body.signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(body.signature)) throw new Error('Sign-in expired or invalid. Request a new sign-in.');
      if (!await verifyMessage({ address: state.owner, message: challenge.message, signature: body.signature as Hex })) throw new Error('Sign with this vault’s owner account.');
      await this.ctx.storage.delete('challenges');
      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const expiresAt = Date.now() + 1_800_000;
      await this.ctx.storage.put('login', { tokenHash: await digest(token), expiresAt } satisfies Login);
      return json({ token, expiresAt });
    }
    const login = await this.ctx.storage.get<Login>('login');
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (!login || login.expiresAt <= Date.now() || await digest(token) !== login.tokenHash) return json({ error: 'Sign in again with the vault owner.' }, 401);
    if (action === 'state') return json(publicState(state));
    if (state.feeReturn?.status === 'signed') throw new Error('Fee return is pending. Wait for its receipt before changing the plan.');
    // Every mutation revalidates immutable ownership and exact supported bytecode.
    const v = await access.read(vault);
    if (!same(v.owner, state.owner)) throw new Error('Vault ownership changed.');
    if (action === 'return-fees') {
      if (Object.keys(body).length) throw new Error('Fee returns only go to the verified vault owner.');
      if (!state.agent || v.active || state.plan?.status === 'running' || pendingPayment(state.plan)) throw new Error('Freeze the session, stop the plan and resolve payments before returning fees.');
      state.feeReturn = await access.signFeeReturn(await unseal(state.agent.sealedKey, this.env.AGENT_ENCRYPTION_KEY, `${chainId}:${vault.toLowerCase()}`), state.owner, BigInt(this.env.MAX_PAYMENT_FEE_WEI));
      await this.store(state, Date.now() + 1000);
    } else if (action === 'agent') {
      if (!state.agent) {
        const key = generatePrivateKey();
        state.agent = { address: privateKeyToAccount(key).address, sealedKey: await seal(key, this.env.AGENT_ENCRYPTION_KEY, `${chainId}:${vault.toLowerCase()}`) };
        await this.ctx.storage.put('state', state);
      }
    } else if (action === 'plan') {
      if (!state.agent) throw new Error('Prepare your automatic payment account first.');
      if (pendingPayment(state.plan) || state.plan && !['stopped', 'completed'].includes(state.plan.status)) throw new Error('Stop the existing plan and resolve pending payments before creating another.');
      const schedule = parseSchedule(body, v, state.agent.address);
      const nextPlan = createPlan(schedule, v, state.agent.address);
      // Check protected-key access, nonce and gas before accepting a schedule.
      // This only estimates: no transaction is signed or broadcast before its due time.
      try {
        await access.preflight(vault, await unseal(state.agent.sealedKey, this.env.AGENT_ENCRYPTION_KEY, `${chainId}:${vault.toLowerCase()}`), nextPlan, paymentFor(nextPlan, 0), BigInt(this.env.MAX_PAYMENT_FEE_WEI));
      } catch (error) {
        state.lastError = safeError(error);
        await this.ctx.storage.put('state', state);
        throw error;
      }
      if (state.plan) state.history = [...state.history, state.plan].slice(-10);
      state.plan = nextPlan;
      state.lastError = undefined;
      await this.store(state, nextWake(state));
    } else {
      const plan = state.plan;
      if (!plan || body.planId !== plan.id) throw new Error('Payment plan changed. Refresh before trying again.');
      if (action === 'pause') {
        if (plan.status !== 'running') throw new Error('Only a running plan can be paused.');
        plan.status = 'paused'; plan.message = 'Paused. A transaction already sent may still confirm.';
      } else if (action === 'stop') {
        plan.status = 'stopped'; plan.message = 'Plan stopped. Freeze the session to revoke all spending authority. A transaction already sent may still confirm.';
        const pending = pendingPayment(plan);
        if (pending?.status === 'intent') { pending.status = 'missed'; pending.message = 'Stopped before signing.'; }
      } else if (action === 'resume') {
        if (plan.status !== 'paused') throw new Error('Only a paused plan can resume.');
        assertAuthority(v, plan.agent, plan.sessionId, plan.recipient, BigInt(plan.amount));
        if (plan.nextIndex >= plan.count) throw new Error('This schedule has ended.');
        plan.status = 'running'; plan.message = 'Resumed. Missed times will not be charged.'; state.lastError = undefined;
      }
      plan.updatedAt = Date.now();
      await this.store(state, nextWake(state));
    }
    return json(publicState(state));
  }
  alarm(): Promise<void> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.ctx.storage.get<RecordState>('state');
      if (!state?.agent || !state.plan && state.feeReturn?.status !== 'signed') return;
      // Persist a watchdog before any external I/O, including retries after an isolate crash.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      const access = chainAccess(this.env.NETWORK, this.env.RPC_URL);
      try {
        if (state.feeReturn?.status === 'signed') {
          const result = await access.reconcileFeeReturn(state.agent.address, state.owner, state.feeReturn);
          if (result === 'pending') await access.broadcast(state.feeReturn.signedTx);
          else { state.feeReturn.status = result; state.feeReturn.message = result === 'confirmed' ? 'Returned to the vault owner. A small network-fee reserve may remain.' : 'Fee return reverted. Check the receipt.'; }
          await this.store(state, nextWake(state)); return;
        }
        await tick(state, {
          read: () => access.read(state.vault),
          sign: async (plan, payment) => access.sign(state.vault,
            await unseal(state.agent!.sealedKey, this.env.AGENT_ENCRYPTION_KEY, `${state.chainId}:${state.vault.toLowerCase()}`), plan, payment, BigInt(this.env.MAX_PAYMENT_FEE_WEI)),
          reconcile: (plan, payment) => access.reconcile(state.vault, plan, payment),
          broadcast: signed => access.broadcast(signed),
          save: s => this.ctx.storage.put('state', s),
        });
      } catch (error) {
        state.lastError = safeError(error);
        if (state.plan) state.plan.message = state.lastError;
        // Uncertain signed transactions keep polling their original hash. No new IDs are created.
        if (state.plan && pendingPayment(state.plan)?.status !== 'signed') state.plan.status = 'paused';
      }
      await this.store(state, nextWake(state));
    });
  }
}
