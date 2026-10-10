// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VaultSnapshot } from '../lib/chain';
vi.mock('../lib/chain', () => ({ arcClient: () => ({ getBalance: async () => 10n ** 17n }) }));
vi.stubEnv('VITE_AUTOMATION_API_URL', 'https://service.example');
const { AutomaticPayments } = await import('./AutomaticPayments');
const owner = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const vault = '0x3333333333333333333333333333333333333333';
const snapshot: VaultSnapshot = { address: vault, chainId: 5042, owner, publicKey: `0x${'ab'.repeat(32)}`, sessionId: 1n, nonce: 1n, active: true, trusted: true, timestamp: BigInt(Math.floor(Date.now() / 1000)), blockNumber: 1n, spent: 0n, balance: 100000n,
  policy: { agent, totalBudget: 100000n, perTxCap: 20000n, recipients: [owner], expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400) } };
let root: Root, host: HTMLDivElement;
const request = vi.fn(async () => `0x${'11'.repeat(65)}`);
const fetcher = vi.fn();
const initial = { chainId: 5042, vault, agent, plan: null, history: [], lastCheckedAt: null, lastError: null };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  request.mockClear(); fetcher.mockReset();
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/challenge') ? { owner, nonce: 'challenge', message: 'Sign in to ArcMandate' } : url.endsWith('/login') ? { token: 'token' } : initial), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(account = owner) { await act(async () => root.render(<AutomaticPayments snapshot={snapshot} account={account as typeof owner} walletChain={5042} provider={{ request }} disabled={false} onAgent={() => {}} onLimits={() => {}} onGas={() => {}} onDeposit={() => {}} onFreeze={() => {}}/>)); }
function button(text: string) { const b = [...host.querySelectorAll('button')].find(e => e.textContent?.includes(text)); if (!b) throw new Error(`Missing ${text}`); return b; }
async function click(text: string) { await act(async () => button(text).click()); }
async function input(label: string, value: string) {
  const element = [...host.querySelectorAll('label')].find(e => e.textContent?.startsWith(label))?.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
it('does not request signatures or make API calls on opening a public vault', async () => {
  await render(agent); expect(button('Sign in').disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
it('signs in with a message, shows managed account and never asks for a payment transaction', async () => {
  await render(); await click('Sign in'); expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'personal_sign' }));
  expect(host.textContent).toContain(agent); expect(host.textContent).toContain('Create a payment plan');
  expect(request.mock.calls).toHaveLength(1); expect(fetcher.mock.calls.some(c => c[0].endsWith('/plan'))).toBe(false);
});
it('requires review and explicit activation; edits remove the prior review', async () => {
  await render(); await click('Sign in'); await input('Each payment', '0.01'); await input('Repeat every', '1');
  expect(button('Review payment plan').disabled).toBe(false); await click('Review payment plan');
  expect(button('Activate automatic payments').disabled).toBe(true);
  expect(host.textContent).toContain('0.02 USDC');
  await input('Each payment', '0.02'); expect(host.textContent).not.toContain('Review before activating');
  expect(fetcher.mock.calls.some(c => c[0].endsWith('/plan'))).toBe(false);
});
it('keeps an activation failure visible when the next background status read succeeds', async () => {
  vi.useFakeTimers();
  try {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => url.endsWith('/plan')
      ? new Response(JSON.stringify({ error: 'Payment readiness unavailable.' }), { status: 400 })
      : normal(url));
    await render(); await click('Sign in'); await input('Each payment', '0.01'); await click('Review payment plan');
    await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
    await click('Activate automatic payments'); expect(host.textContent).toContain('Payment readiness unavailable.');
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(host.textContent).toContain('Payment readiness unavailable.');
  } finally { vi.useRealTimers(); }
});
