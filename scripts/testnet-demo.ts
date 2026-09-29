import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_NETWORKS, USDC_ADDRESS } from '../packages/core/src/config.js';
import {
  freezeDigest,
  startSessionDigest,
  withdrawDigest,
  type Authorization,
  type Policy,
} from '../packages/core/src/digest.js';

// This script uses disposable local accounts and the Arc testnet only.
const keyPath = 'private/arc-testnet-keys.json';
const manifestPath = 'deployments/arc-testnet.json';
const artifactPath = 'contracts/out/ArcMandateVault.sol/ArcMandateVault.json';
const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? ARC_NETWORKS.testnet.rpcUrl;
const chain = defineChain({
  id: ARC_NETWORKS.testnet.chainId,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 60_000 }) });
const usdcAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
]);

type StoredAccount = { address: Address; privateKey: Hex };
type Keys = {
  chainId: number;
  owner: StoredAccount;
  agent: StoredAccount;
  relay: StoredAccount;
  pq: { publicKey: Hex; secretKey: Hex };
};
type Evidence = {
  label: string;
  expectedOutcome: 'success' | 'revert';
  evidenceType: 'receipt' | 'simulation';
  txHash?: Hex;
  blockNumber?: string;
  blockHash?: Hex;
  receiptStatus?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  from?: Address;
  to?: Address;
  calldata?: Hex;
  block?: string;
  decodedError?: string;
};
type Manifest = {
  schemaVersion: number;
  chainId: number;
  vault?: Address;
  deploymentBlock?: string;
  deploymentTxHash?: Hex;
  sourceCommit: string;
  compiler: string;
  createdAt: string;
  status: 'in_progress' | 'complete';
  steps: Evidence[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function save(manifest: Manifest): void {
  mkdirSync('deployments', { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function recordReceipt(manifest: Manifest, label: string, receipt: TransactionReceipt): void {
  assert(receipt.status === 'success', `${label} transaction reverted: ${receipt.transactionHash}`);
  manifest.steps.push({
    label,
    expectedOutcome: 'success',
    evidenceType: 'receipt',
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    receiptStatus: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
  });
  save(manifest);
  console.log(`${label}: ${receipt.transactionHash} (block ${receipt.blockNumber})`);
}

function errorName(error: unknown, abi: Abi): string {
  if (error instanceof BaseError) {
    const revert = error.walk((cause) =>
      typeof cause === 'object' && cause !== null && 'data' in cause &&
      typeof cause.data === 'string' && cause.data.startsWith('0x'),
    ) as { data?: Hex } | null;
    if (revert?.data) {
      try {
        return decodeErrorResult({ abi, data: revert.data }).errorName;
      } catch {
        return revert.data;
      }
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvFile('.env');
  assert(existsSync(keyPath), `Missing ${keyPath}; run npm run accounts:testnet`);
  const keys = JSON.parse(readFileSync(keyPath, 'utf8')) as Keys;
  assert(keys.chainId === ARC_NETWORKS.testnet.chainId, 'Key file is not for Arc testnet');
  assert(await publicClient.getChainId() === ARC_NETWORKS.testnet.chainId, 'Refusing a non-testnet RPC');
  const owner = privateKeyToAccount(keys.owner.privateKey);
  const agent = privateKeyToAccount(keys.agent.privateKey);
  const relay = privateKeyToAccount(keys.relay.privateKey);
  assert(owner.address === keys.owner.address && agent.address === keys.agent.address && relay.address === keys.relay.address, 'Key file address mismatch');
  const balances = await Promise.all([owner, agent, relay].map(async (account) => ({
    address: account.address,
    native: await publicClient.getBalance({ address: account.address }),
    usdc: await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [account.address] }),
  })));
  for (const balance of balances) {
    console.log(`${balance.address}: native=${formatEther(balance.native)}, ERC20 USDC=${formatUnits(balance.usdc, 6)}`);
  }
  if (process.argv.includes('--balances')) return;

  assert(!existsSync(manifestPath), `${manifestPath} already exists; inspect the prior run before retrying`);
  assert(balances[0].native >= parseEther('3'), 'Owner needs at least 3 native testnet USDC for gas');
  assert(balances[0].usdc >= 1_000_000n, 'Owner needs at least 1 ERC20 testnet USDC');
  assert(existsSync(artifactPath), `Missing ${artifactPath}; run npm run build:contracts`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi; bytecode: { object: Hex }; metadata: string };
  const vaultAbi = artifact.abi;
  const metadata = JSON.parse(artifact.metadata) as { compiler: { version: string }; settings: { optimizer: unknown; evmVersion: string } };
  const manifest: Manifest = {
    schemaVersion: 1,
    chainId: ARC_NETWORKS.testnet.chainId,
    sourceCommit: process.env.SOURCE_COMMIT ?? 'working-tree',
    compiler: `${metadata.compiler.version}; ${metadata.settings.evmVersion}; optimizer ${JSON.stringify(metadata.settings.optimizer)}`,
    createdAt: new Date().toISOString(),
    status: 'in_progress',
    steps: [],
  };
  const ownerClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const agentClient = createWalletClient({ account: agent, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const relayClient = createWalletClient({ account: relay, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const receipt = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_000 });
  const sign = (digest: Hex): Hex => {
    const signature = slh_dsa_sha2_128s.sign(hexToBytes(digest), hexToBytes(keys.pq.secretKey));
    assert(signature.length === 7856, 'Invalid PQ signature length');
    return toHex(signature);
  };

  const deployment = await receipt(await ownerClient.deployContract({
    abi: vaultAbi,
    bytecode: artifact.bytecode.object,
    args: [owner.address, keys.pq.publicKey],
  }));
  assert(deployment.contractAddress, 'Deployment receipt has no contract address');
  const vault = deployment.contractAddress;
  manifest.vault = vault;
  manifest.deploymentBlock = deployment.blockNumber.toString();
  manifest.deploymentTxHash = deployment.transactionHash;
  recordReceipt(manifest, 'deploy-vault', deployment);
  assert(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }) === owner.address, 'Vault owner mismatch');

  recordReceipt(manifest, 'fund-vault-1-usdc', await receipt(await ownerClient.writeContract({
    address: USDC_ADDRESS, abi: usdcAbi, functionName: 'transfer', args: [vault, 1_000_000n],
  })));
  assert(await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [vault] }) === 1_000_000n, 'Vault funding mismatch');
  for (const [label, recipient] of [['fund-agent-gas', agent.address], ['fund-relay-gas', relay.address]] as const) {
    recordReceipt(manifest, label, await receipt(await ownerClient.sendTransaction({ to: recipient, value: parseEther('0.2') })));
  }

  const context = { chainId: BigInt(ARC_NETWORKS.testnet.chainId), vault, owner: owner.address };
  const auth = async (deadlineSeconds = 600): Promise<Authorization> => {
    const [nonce, sessionId, block] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'controlNonce' }) as Promise<bigint>,
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'sessionId' }) as Promise<bigint>,
      publicClient.getBlock(),
    ]);
    return { nonce, sessionId, deadline: block.timestamp + BigInt(deadlineSeconds) };
  };
  const policy = async (): Promise<Policy> => ({
    agent: agent.address,
    totalBudget: 150_000n,
    perTxCap: 50_000n,
    expiresAt: (await publicClient.getBlock()).timestamp + 900n,
    recipients: [relay.address],
  });
  const verifyDigest = async (functionName: 'startSessionDigest' | 'freezeDigest' | 'withdrawDigest', args: readonly unknown[], local: Hex): Promise<void> => {
    const onchain = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName, args }) as Hex;
    assert(onchain === local, `${functionName} TS/Solidity digest mismatch`);
  };
  const start = async (label: string): Promise<bigint> => {
    const p = await policy();
    const a = await auth();
    const digest = startSessionDigest(context, p, a);
    await verifyDigest('startSessionDigest', [p, a], digest);
    recordReceipt(manifest, label, await receipt(await ownerClient.writeContract({
      address: vault, abi: vaultAbi, functionName: 'startSession', args: [p, a, sign(digest)],
    })));
    const id = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'sessionId' }) as bigint;
    assert(id === a.sessionId + 1n, 'Session ID failed to advance');
    return id;
  };
  const paymentId = (label: string) => keccak256(toHex(label));
  const pay = async (label: string, id: bigint, amount = 50_000n): Promise<void> => {
    recordReceipt(manifest, label, await receipt(await agentClient.writeContract({
      address: vault, abi: vaultAbi, functionName: 'agentPay', args: [id, paymentId(label), relay.address, amount],
    })));
  };
  const rejectPay = async (label: string, id: bigint, amount: bigint, expectedError: string): Promise<void> => {
    const args = [id, paymentId(label), relay.address, amount] as const;
    const calldata = encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay', args });
    const block = await publicClient.getBlockNumber();
    try {
      await publicClient.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: 'agentPay', args, blockNumber: block });
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      const decodedError = errorName(error, vaultAbi);
      assert(decodedError === expectedError, `${label}: expected ${expectedError}, got ${decodedError}`);
      manifest.steps.push({ label, expectedOutcome: 'revert', evidenceType: 'simulation', from: agent.address, to: vault, calldata, block: block.toString(), decodedError });
      save(manifest);
      console.log(`${label}: ${decodedError} at block ${block}`);
    }
  };

  const firstSession = await start('start-session-s');
  await pay('agent-pay-s-0.05', firstSession);
  await rejectPay('over-cap-0.20', firstSession, 200_000n, 'PerPaymentLimitExceeded');
  const freezeAuth = await auth();
  const freezeHash = freezeDigest(context, freezeAuth);
  await verifyDigest('freezeDigest', [freezeAuth], freezeHash);
  recordReceipt(manifest, 'pq-freeze-s', await receipt(await relayClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'freezeByPQ', args: [freezeAuth, sign(freezeHash)],
  })));
  await rejectPay('old-session-after-freeze', firstSession, 50_000n, 'SessionInactive');
  const secondSession = await start('start-session-s2-same-agent');
  await rejectPay('old-session-after-restart', firstSession, 50_000n, 'SessionMismatch');
  await pay('agent-pay-s2-0.05', secondSession);
  recordReceipt(manifest, 'owner-freeze-s2', await receipt(await ownerClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'freezeByOwner', args: [secondSession],
  })));
  const remaining = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [vault] }) as bigint;
  assert(remaining === 900_000n, `Expected 0.9 USDC in vault, got ${remaining}`);
  const withdrawAuth = await auth();
  const withdrawHash = withdrawDigest(context, owner.address, remaining, withdrawAuth);
  await verifyDigest('withdrawDigest', [owner.address, remaining, withdrawAuth], withdrawHash);
  recordReceipt(manifest, 'hybrid-withdraw-remaining', await receipt(await ownerClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'withdraw', args: [owner.address, remaining, withdrawAuth, sign(withdrawHash)],
  })));
  assert(await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [vault] }) === 0n, 'Vault balance remains after withdrawal');
  assert(await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [relay.address] }) === 100_000n, 'Agent payments mismatch');
  manifest.status = 'complete';
  save(manifest);
  console.log(`Arc testnet P2 demo complete: ${vault}; evidence: ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
