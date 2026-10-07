import { describe, expect, it } from 'vitest';
import { assertWallet, pendingWalletNonce, rememberWalletAccount, rememberWalletDisconnect, resumeWalletContext, sendWalletTransaction, walletContext, WalletRequestNotSent, type BrowserWallet } from './wallet';

const owner = '0x1111111111111111111111111111111111111111';
function authorizedWallet(accounts: string[] = [owner], chain = '0x4cef52') {
  const calls: string[] = [];
  const provider: BrowserWallet = { async request({ method }) {
    calls.push(method);
    if (method === 'eth_accounts') return accounts;
    if (method === 'eth_chainId') return chain;
    throw new Error(`Unexpected permission or transaction request: ${method}`);
  } };
  return { provider, calls };
}
function preferences() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
describe('wallet connection recovery', () => {
  it('normalizes hexadecimal and exact numeric pending nonces without sending a transaction', async () => {
    for (const raw of ['0x0', '0xA', 0, 10, Number.MAX_SAFE_INTEGER]) {
      const calls: unknown[] = [];
      const provider: BrowserWallet = { async request(args) { calls.push(args); return raw; } };
      expect(await pendingWalletNonce(provider, owner)).toBe(typeof raw === 'number' ? raw : Number(BigInt(raw)));
      expect(calls).toEqual([{ method: 'eth_getTransactionCount', params: [owner, 'pending'] }]);
    }
  });
  it('rejects unsafe, fractional, malformed and unavailable nonces before wallet submission', async () => {
    for (const raw of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0x20000000000000', '12', '0x', null, {}, undefined]) {
      await expect(pendingWalletNonce({ request: async () => raw }, owner)).rejects.toBeInstanceOf(WalletRequestNotSent);
    }
    await expect(pendingWalletNonce({ request: async () => { throw new Error('RPC failed'); } }, owner)).rejects.toThrow('No wallet transaction was requested');
  });
  it('submits the nonce recorded before wallet approval instead of letting the wallet silently choose another', async () => {
    let sent: unknown;
    const hash = `0x${'ab'.repeat(32)}`;
    const provider: BrowserWallet = { async request({ method, params }) {
      if (method === 'eth_accounts') return [owner];
      if (method === 'eth_chainId') return '0x4cef52';
      if (method === 'eth_sendTransaction') { sent = params?.[0]; return hash; }
      throw new Error(`Unexpected request ${method}`);
    } };
    expect(await sendWalletTransaction(provider, { from: owner, data: '0x1234', gas: 21000n, chainId: 5042002, walletNonce: 9 })).toBe(hash);
    expect(sent).toMatchObject({ nonce: '0x9', chainId: '0x4cef52' });
  });
  it('resumes only previously authorized accounts without requesting permission or sending a transaction', async () => {
    const { provider, calls } = authorizedWallet();
    expect(await resumeWalletContext(provider, preferences())).toEqual({ account: owner, accounts: [owner], chainId: 5042002 });
    expect(calls.sort()).toEqual(['eth_accounts', 'eth_chainId']);
  });
  it('does not reconnect after explicit disconnect, including on a later page load', async () => {
    const storage = preferences();
    const { provider, calls } = authorizedWallet();
    rememberWalletDisconnect(true, storage);
    expect(await resumeWalletContext(provider, storage)).toBeNull();
    expect(calls).toEqual([]);
    rememberWalletDisconnect(false, storage);
    expect((await resumeWalletContext(provider, storage))?.account).toBe(owner);
  });
  it('selects and resumes a second exposed account without relying on account ordering or requesting permission', async () => {
    const agent = '0x2222222222222222222222222222222222222222';
    const { provider, calls } = authorizedWallet([owner, agent]);
    const storage = preferences(); rememberWalletAccount(agent, storage);
    expect((await walletContext(provider, agent)).account).toBe(agent);
    expect((await resumeWalletContext(provider, storage))?.account).toBe(agent);
    await expect(assertWallet(provider, agent, 5042002)).resolves.toBeUndefined();
    expect(calls.every(method => ['eth_accounts', 'eth_chainId'].includes(method))).toBe(true);
  });
  it('does not fall back to the owner or send after the selected agent permission is removed', async () => {
    const agent = '0x2222222222222222222222222222222222222222';
    const storage = preferences(); rememberWalletAccount(agent, storage);
    const { provider, calls } = authorizedWallet([owner]);
    expect((await walletContext(provider, agent)).account).toBeNull();
    expect(await resumeWalletContext(provider, storage)).toBeNull();
    await expect(sendWalletTransaction(provider, { from: agent, data: '0x1234', gas: 21000n, chainId: 5042002 })).rejects.toThrow('account changed');
    expect(calls).not.toContain('eth_sendTransaction');
  });
  it('does not invent a connection when the wallet is locked or the site is unauthorized', async () => {
    const { provider, calls } = authorizedWallet([]);
    expect(await resumeWalletContext(provider, preferences())).toBeNull();
    expect(calls).not.toContain('eth_requestAccounts');
  });
  it('preserves the actual wallet chain so an incompatible network remains blocked', async () => {
    const { provider } = authorizedWallet([owner], '0x1');
    expect((await resumeWalletContext(provider, preferences()))?.chainId).toBe(1);
  });
  it('fails closed on unavailable preferences and tolerates storage failure during manual connection', async () => {
    const storage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
    const { provider, calls } = authorizedWallet();
    expect(await resumeWalletContext(provider, storage)).toBeNull();
    expect(calls).toEqual([]);
    expect(() => rememberWalletDisconnect(false, storage)).not.toThrow();
  });
});
