import { ARC_NETWORKS } from '@arcmandate/core';
export function publicRpcUrl(network: keyof typeof ARC_NETWORKS, env: Record<string, unknown>): string {
  const configured = env[network === 'testnet' ? 'VITE_ARC_TESTNET_RPC_URL' : 'VITE_ARC_MAINNET_RPC_URL'];
  if (configured !== undefined && (typeof configured !== 'string' || !configured.trim())) throw new Error('Empty public RPC override');
  const url = new URL(typeof configured === 'string' ? configured : ARC_NETWORKS[network].rpcUrl);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Public RPC requires HTTPS (or loopback HTTP), without user credentials or fragments');
  return url.href;
}
