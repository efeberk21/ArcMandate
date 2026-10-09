import { ARC_NETWORKS } from '@arcmandate/core';
export function publicRpcUrl(network: keyof typeof ARC_NETWORKS, env: Record<string, unknown>): string {
  const configured = env[network === 'testnet' ? 'VITE_ARC_TESTNET_RPC_URL' : 'VITE_ARC_MAINNET_RPC_URL'];
  if (configured !== undefined && (typeof configured !== 'string' || !configured.trim())) throw new Error('Empty public RPC override');
  const url = new URL(typeof configured === 'string' ? configured : ARC_NETWORKS[network].rpcUrl);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Public RPC requires HTTPS (or loopback HTTP), without credentials, query parameters or fragments');
  return url.href;
}

export function publicRpcUrls(network: keyof typeof ARC_NETWORKS, env: Record<string, unknown>): string[] {
  const primary = publicRpcUrl(network, env);
  const override = env[network === 'testnet' ? 'VITE_ARC_TESTNET_RPC_URL' : 'VITE_ARC_MAINNET_RPC_URL'];
  // Explicit overrides remain exclusive; no hidden fallback changes a chosen provider.
  if (override !== undefined) return [primary];
  // Public providers listed at https://docs.arc.io/arc/references/connect-to-arc.
  if (network === 'mainnet') return [primary, 'https://rpc.blockdaemon.mainnet.arc.io/', 'https://rpc.drpc.mainnet.arc.io/'];
  return [primary, 'https://rpc.blockdaemon.testnet.arc.io/', 'https://rpc.drpc.testnet.arc.io/'];
}
