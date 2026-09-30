import { BaseError, ExecutionRevertedError, createPublicClient, decodeErrorResult, defineChain, getAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { ARC_NETWORKS, PQ_VERIFIER_ADDRESS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi } from '@arcmandate/core/contracts';
import type { Policy } from '@arcmandate/core/digest';
import { SimulationRejected, type TransactionInput } from './transactions';

export type Network = keyof typeof ARC_NETWORKS;
export const DEMO_VAULT = '0x91e4467997d28ad3443f910261f4d65b4c867bbd' as const;
export const usdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export function arcChain(network: Network) {
  const config = ARC_NETWORKS[network];
  return defineChain({
    id: config.chainId, name: network === 'testnet' ? 'Arc Testnet' : 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: 'Arc Explorer', url: config.explorerUrl } },
  });
}

export function arcClient(network: Network) {
  return createPublicClient({ chain: arcChain(network), transport: http(ARC_NETWORKS[network].rpcUrl, { timeout: 20_000, retryCount: 1 }) });
}

export type ArcClient = ReturnType<typeof arcClient>;
export type VaultSnapshot = {
  address: Address; owner: Address; publicKey: Hex; sessionId: bigint; nonce: bigint;
  active: boolean; policy: Policy; spent: bigint; balance: bigint;
  blockNumber: bigint; timestamp: bigint;
};

export async function readVault(client: ArcClient, address: Address, blockNumber?: bigint): Promise<VaultSnapshot> {
  if (await client.getChainId() !== client.chain.id) throw new Error('RPC chain does not match the selected network');
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
  return {
    address, owner, publicKey, sessionId, nonce, active,
    policy: { ...policy, recipients: [...policy.recipients] }, spent, balance,
    blockNumber: block.number, timestamp: block.timestamp,
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
