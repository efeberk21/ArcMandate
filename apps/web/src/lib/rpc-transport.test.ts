import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient, defineChain } from 'viem';
import { publicRpcTransport } from './rpc-transport';

const primary = 'https://primary.example/';
const secondary = 'https://secondary.example/';
const vault = '0x2222222222222222222222222222222222222222';
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [primary] } } });
type Call = { id: number; method: string; params?: unknown[] };
type Reply = { result: string } | { error: { code: number; message: string; data?: string } };
function setup(reply: (url: string, call: Call) => Reply, urls = [primary, secondary]) {
  const requests: { url: string; calls: Call[]; time: number }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const calls = JSON.parse(init.body as string) as Call[];
    requests.push({ url, calls, time: Date.now() });
    return new Response(JSON.stringify(calls.map((call) => ({ jsonrpc: '2.0', id: call.id, ...reply(url, call) }))), { headers: { 'Content-Type': 'application/json' } });
  }));
  return { requests, client: createPublicClient({ chain, transport: publicRpcTransport(urls, chain.id) }) };
}
const ok = (call: Call): Reply => ({ result: call.method === 'eth_chainId' ? '0x4cef52' : '0x6000' });
afterEach(() => vi.unstubAllGlobals());

describe('public RPC recovery', () => {
  it.each([-32005, -32014, 429])('recovers from RPC error %s at the same pinned block', async (code) => {
    const { client, requests } = setup((url, call) => url === primary && call.method === 'eth_getCode'
      ? { error: { code, message: 'temporary provider failure' } } : ok(call));
    await expect(client.getBytecode({ address: vault, blockNumber: 100n })).resolves.toBe('0x6000');
    const reads = requests.flatMap(({ url, calls }) => calls.filter((call) => call.method === 'eth_getCode').map((call) => ({ url, params: call.params })));
    expect(reads).toEqual([{ url: primary, params: [vault, '0x64'] }, { url: secondary, params: [vault, '0x64'] }]);
  });
  it('rejects a wrong-chain fallback before reading its contract', async () => {
    const { client, requests } = setup((url, call) => url === primary
      ? { error: { code: -32005, message: 'rate limit exceeded' } }
      : { result: call.method === 'eth_chainId' ? '0x1' : '0x6000' });
    await expect(client.getBytecode({ address: vault, blockNumber: 100n })).rejects.toThrow('RPC chain');
    expect(requests.filter(({ url }) => url === secondary).flatMap(({ calls }) => calls).map((call) => call.method)).toEqual(['eth_chainId']);
  });
  it('propagates a contract revert without consulting another provider', async () => {
    const { client, requests } = setup((_url, call) => call.method === 'eth_call'
      ? { error: { code: 3, message: 'execution reverted', data: '0xdeadbeef' } } : ok(call));
    await expect(client.call({ to: vault, data: '0x12345678' })).rejects.toThrow();
    expect(requests.every(({ url }) => url === primary)).toBe(true);
  });
  it('coalesces identity checks and batches concurrent contract reads', async () => {
    const { client, requests } = setup((_url, call) => ok(call));
    await Promise.all([client.getBytecode({ address: vault, blockNumber: 100n }), client.getBytecode({ address: vault, blockNumber: 101n })]);
    expect(requests).toHaveLength(2);
    expect(requests[0].calls.map((call) => call.method)).toEqual(['eth_chainId']);
    expect(requests[1].calls.map((call) => call.method)).toEqual(['eth_getCode', 'eth_getCode']);
  });
  it('backs off and retries a transient error with a single configured endpoint', async () => {
    let limited = true;
    const { client, requests } = setup((_url, call) => {
      if (limited) { limited = false; return { error: { code: -32005, message: 'rate limit exceeded' } }; }
      return ok(call);
    }, [primary]);
    await expect(client.getBytecode({ address: vault, blockNumber: 100n })).resolves.toBe('0x6000');
    expect(requests[1].time - requests[0].time).toBeGreaterThanOrEqual(1_000);
    expect(requests.every(({ url }) => url === primary)).toBe(true);
  });
});
