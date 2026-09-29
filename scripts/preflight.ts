import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createPublicClient, http, parseAbi } from 'viem';
import { ARC_NETWORKS, USDC_ADDRESS, USDC_DECIMALS } from '../packages/core/src/config.js';

if (existsSync('.env')) loadEnvFile('.env');
const erc20 = parseAbi(['function decimals() view returns (uint8)']);

for (const [name, config] of Object.entries(ARC_NETWORKS)) {
  const rpcUrl = process.env[name === 'testnet' ? 'ARC_TESTNET_RPC_URL' : 'ARC_MAINNET_RPC_URL'] ?? config.rpcUrl;
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 15_000 }) });
  try {
    const [chainId, block, decimals] = await Promise.all([
      client.getChainId(),
      client.getBlock(),
      client.readContract({ address: USDC_ADDRESS, abi: erc20, functionName: 'decimals' }),
    ]);
    if (chainId !== config.chainId) throw new Error(`chain ID ${chainId}, expected ${config.chainId}`);
    if (decimals !== USDC_DECIMALS) throw new Error(`USDC decimals ${decimals}, expected ${USDC_DECIMALS}`);
    console.log(`${name}: chain=${chainId} block=${block.number} timestamp=${block.timestamp} USDC decimals=${decimals}`);
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log('Run the PQ probe as the next preflight step. This network check alone does not certify PQ support.');
