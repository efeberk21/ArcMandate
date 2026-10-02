import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import {
  createPublicClient, defineChain, encodeDeployData, formatUnits, http, keccak256,
  type Abi, type Address, type Hex,
} from 'viem';
import { ARC_NETWORKS } from '../packages/core/src/config.js';

if (process.env.ARC_MAINNET_RPC_URL === undefined) {
  try { loadEnvFile('.env'); } catch { /* Public default RPC remains available. */ }
}

const artifact = JSON.parse(readFileSync('contracts/out/ArcMandateVault.sol/ArcMandateVault.json', 'utf8')) as {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: string | { compiler: { version: string }; settings: { evmVersion: string; optimizer: unknown } };
};
const manifest = JSON.parse(readFileSync('deployments/arc-testnet-p5.json', 'utf8')) as {
  chainId: number; vault: Address; deploymentTxHash: Hex;
  steps: Array<{ label: string; evidenceType: string; gasUsed?: string; effectiveGasPrice?: string }>;
};
const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) as Exclude<typeof artifact.metadata, string> : artifact.metadata;

async function main(): Promise<void> {
  const testnet = defineChain({ id: ARC_NETWORKS.testnet.chainId, name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [ARC_NETWORKS.testnet.rpcUrl] } } });
  const mainnet = defineChain({ id: ARC_NETWORKS.mainnet.chainId, name: 'Arc Mainnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [process.env.ARC_MAINNET_RPC_URL ?? ARC_NETWORKS.mainnet.rpcUrl] } } });
  const testClient = createPublicClient({ chain: testnet, transport: http(testnet.rpcUrls.default.http[0], { timeout: 60_000 }) });
  const mainClient = createPublicClient({ chain: mainnet, transport: http(mainnet.rpcUrls.default.http[0], { timeout: 60_000 }) });
  const [testChainId, mainChainId, owner, pqPublicKey, deployment, onchainCode, gasPrice, mainBlock] = await Promise.all([
    testClient.getChainId(), mainClient.getChainId(),
    testClient.readContract({ address: manifest.vault, abi: artifact.abi, functionName: 'owner' }) as Promise<Address>,
    testClient.readContract({ address: manifest.vault, abi: artifact.abi, functionName: 'pqPublicKey' }) as Promise<Hex>,
    testClient.getTransaction({ hash: manifest.deploymentTxHash }),
    testClient.getBytecode({ address: manifest.vault }),
    mainClient.getGasPrice(), mainClient.getBlockNumber(),
  ]);
  if (testChainId !== manifest.chainId || mainChainId !== mainnet.id) throw new Error('Unexpected RPC chain ID');
  if (!onchainCode || !/^0x[0-9a-f]+$/i.test(artifact.bytecode.object)) throw new Error('Missing deployment code');
  const expectedDeployData = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [owner, pqPublicKey] });
  if (deployment.input.toLowerCase() !== expectedDeployData.toLowerCase()) throw new Error('P5 deployment input differs from pinned artifact and constructor arguments');
  const mined = manifest.steps.filter((step) => step.evidenceType === 'mined_success' && step.gasUsed);
  const gasUsed = mined.reduce((sum, step) => sum + BigInt(step.gasUsed!), 0n);
  const actualFees = mined.reduce((sum, step) => sum + BigInt(step.gasUsed!) * BigInt(step.effectiveGasPrice!), 0n);
  const estimatedFees = gasUsed * gasPrice;
  const snapshot = {
    capturedAt: new Date().toISOString(),
    scope: 'Read-only release preparation; no mainnet transaction or source verification was performed',
    artifact: {
      compiler: metadata.compiler.version, evmVersion: metadata.settings.evmVersion,
      optimizer: metadata.settings.optimizer,
      creationBytecodeKeccak256: keccak256(artifact.bytecode.object),
      deployedBytecodeTemplateKeccak256: keccak256(artifact.deployedBytecode.object),
    },
    p5Testnet: {
      vault: manifest.vault, deploymentTxHash: manifest.deploymentTxHash,
      constructorArgs: { owner, pqPublicKey },
      deploymentInputMatchesArtifact: true,
      onchainRuntimeCodeKeccak256: keccak256(onchainCode),
      minedTransactionCount: mined.length,
      totalGasUsed: gasUsed.toString(),
      actualFeesNativeUsdc: formatUnits(actualFees, 18),
    },
    mainnetFeeSnapshot: {
      chainId: mainChainId, blockNumber: mainBlock.toString(),
      gasPriceWei: gasPrice.toString(),
      estimatedSameSequenceFeesNativeUsdc: formatUnits(estimatedFees, 18),
      estimatedFeesWithTwentyPercentBufferNativeUsdc: formatUnits(estimatedFees * 120n / 100n, 18),
      vaultFundingUsdc: '1.0',
      note: 'Uses P5 testnet gas quantities at one mainnet RPC gas-price snapshot; not a fee guarantee or funding authorization.',
    },
  };
  writeFileSync('deployments/p6-release-snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
