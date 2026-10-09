import { BaseError, ExecutionRevertedError, createPublicClient, decodeErrorResult, defineChain, getAddress, parseAbi, type Address, type Hex } from 'viem';
import { ARC_NETWORKS, PQ_VERIFIER_ADDRESS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi } from '@arcmandate/core/contracts';
import type { Policy } from '@arcmandate/core/digest';
import { matchesVaultRuntime } from '@arcmandate/core/runtime';
import { SimulationRejected, type TransactionInput } from './transactions';
import { networkLabel } from './release';
import { publicRpcUrls } from './rpc-config';
import { publicRpcTransport } from './rpc-transport';

export type Network = keyof typeof ARC_NETWORKS;
export const usdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export function arcChain(network: Network) {
  const config = ARC_NETWORKS[network];
  return defineChain({
    id: config.chainId, name: networkLabel(network),
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: publicRpcUrls(network, {
      VITE_ARC_TESTNET_RPC_URL: import.meta.env.VITE_ARC_TESTNET_RPC_URL,
      VITE_ARC_MAINNET_RPC_URL: import.meta.env.VITE_ARC_MAINNET_RPC_URL,
    }) } },
    blockExplorers: { default: { name: 'Arc Explorer', url: config.explorerUrl } },
  });
}

export function arcClient(network: Network) {
  const chain = arcChain(network);
  return createPublicClient({ chain, transport: publicRpcTransport(chain.rpcUrls.default.http, chain.id) });
}

export type ArcClient = ReturnType<typeof arcClient>;
export type VaultSnapshot = {
  chainId: typeof ARC_NETWORKS[Network]['chainId'];
  address: Address; owner: Address; publicKey: Hex; sessionId: bigint; nonce: bigint;
  active: boolean; policy: Policy; spent: bigint; balance: bigint;
  blockNumber: bigint; timestamp: bigint;
  trusted: boolean;
};

const pendingVaultReads = new WeakMap<ArcClient, Map<string, Promise<VaultSnapshot>>>();

export function readVault(client: ArcClient, address: Address, blockNumber?: bigint): Promise<VaultSnapshot> {
  let pending = pendingVaultReads.get(client);
  if (!pending) { pending = new Map(); pendingVaultReads.set(client, pending); }
  const key = `${address.toLowerCase()}:${blockNumber ?? 'latest'}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = readVaultSnapshot(client, address, blockNumber);
  pending.set(key, request);
  const clear = () => { if (pending.get(key) === request) pending.delete(key); };
  void request.then(clear, clear);
  return request;
}

async function readVaultSnapshot(client: ArcClient, address: Address, blockNumber?: bigint): Promise<VaultSnapshot> {
  if (![ARC_NETWORKS.testnet.chainId, ARC_NETWORKS.mainnet.chainId].includes(client.chain.id as never) || await client.getChainId() !== client.chain.id) throw new Error('RPC chain does not match the selected network');
  const block = await client.getBlock(blockNumber === undefined ? {} : { blockNumber });
  const at = { address, abi: vaultAbi, blockNumber: block.number } as const;
  const [owner, publicKey, sessionId, nonce, active, policy, spent, balance, token, verifier] = await Promise.all([
    client.readContract({ ...at, functionName: 'owner' }),
    client.readContract({ ...at, functionName: 'pqPublicKey' }),
    client.readContract({ ...at, functionName: 'sessionId' }),
    client.readContract({ ...at, functionName: 'controlNonce' }),
    client.readContract({ ...at, functionName: 'active' }),
    client.readContract({ ...at, functionName: 'currentPolicy' }),
    client.readContract({ ...at, functionName: 'spent' }),
    client.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [address], blockNumber: block.number }),
    client.readContract({ ...at, functionName: 'USDC_ADDRESS' }),
    client.readContract({ ...at, functionName: 'PQ_VERIFIER_ADDRESS' }),
  ]);
  if (getAddress(token) !== getAddress(USDC_ADDRESS) || getAddress(verifier) !== getAddress(PQ_VERIFIER_ADDRESS)) {
    throw new Error('This contract does not use the expected Arc USDC and PQ verifier');
  }
  const code = await client.getBytecode({ address, blockNumber: block.number });
  return {
    chainId: client.chain.id as VaultSnapshot['chainId'], address, owner, publicKey, sessionId, nonce, active,
    policy: { ...policy, recipients: [...policy.recipients] }, spent, balance,
    blockNumber: block.number, timestamp: block.timestamp,
    trusted: matchesVaultRuntime(code, owner, publicKey),
  };
}

export async function simulate(client: ArcClient, input: TransactionInput): Promise<void> {
  try { await client.call({ account: input.from, to: input.to, data: input.data }); }
  catch (error) {
    if (error instanceof BaseError) {
      const revert = error.walk((cause) => typeof cause === 'object' && cause !== null && 'data' in cause && typeof cause.data === 'string' && /^0x[0-9a-f]+$/i.test(cause.data)) as { data: Hex } | null;
      if (revert) {
        try { throw new SimulationRejected(decodeErrorResult({ abi: vaultAbi, data: revert.data }).errorName); }
        catch (decoded) { if (decoded instanceof SimulationRejected) throw decoded; }
      }
      if (error.walk((cause) => cause instanceof ExecutionRevertedError)) throw new SimulationRejected(error.shortMessage);
    }
    throw error;
  }
}
