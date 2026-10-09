import { describe, expect, it } from 'vitest';
import { publicRpcUrl, publicRpcUrls } from './rpc-config';
describe('public web RPC overrides (R09)', () => {
  it('selects independent web endpoints, separate from CLI environment', () => {
    const env = { VITE_ARC_TESTNET_RPC_URL: 'https://one.example/rpc', VITE_ARC_MAINNET_RPC_URL: 'https://two.example/rpc', ARC_TESTNET_RPC_URL: 'https://ignored.example' };
    expect(publicRpcUrl('testnet', env)).toBe('https://one.example/rpc');
    expect(publicRpcUrl('mainnet', env)).toBe('https://two.example/rpc');
  });
  it('rejects unsafe or empty endpoint configurations', () => {
    for (const endpoint of ['http://remote.example', 'https://user:secret@host.example', 'https://host.example/?apiKey=secret', 'https://host.example/#secret', '', 'file:///tmp/rpc']) expect(() => publicRpcUrl('testnet', { VITE_ARC_TESTNET_RPC_URL: endpoint })).toThrow();
  });
  it('uses public Arc failover only when no explicit endpoint is configured', () => {
    expect(publicRpcUrls('testnet', {})).toHaveLength(3);
    expect(publicRpcUrls('testnet', { VITE_ARC_TESTNET_RPC_URL: 'https://one.example/rpc' })).toEqual(['https://one.example/rpc']);
    expect(publicRpcUrls('mainnet', {})).toHaveLength(3);
  });
});
