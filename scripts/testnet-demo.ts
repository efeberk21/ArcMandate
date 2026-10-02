import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  parseAbiItem,
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
import { runPayment, type PaymentIntent, type PaymentPort } from './agent-journal.js';

// This script uses disposable local accounts and the Arc testnet only.
if (existsSync('.env')) loadEnvFile('.env');
const keyPath = 'private/arc-testnet-keys.json';
const manifestPath = process.env.ARC_DEMO_MANIFEST_PATH ?? 'deployments/arc-testnet.json';
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
const paidEvent = parseAbiItem('event AgentPaid(uint256 indexed sessionId,bytes32 indexed paymentId,address indexed to,uint256 amount,uint256 spent)');

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
  evidenceType: 'mined_success' | 'mined_revert' | 'simulation_rejection';
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
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function recordReceipt(manifest: Manifest, label: string, receipt: TransactionReceipt): void {
  assert(receipt.status === 'success', `${label} transaction reverted: ${receipt.transactionHash}`);
  manifest.steps.push({
    label,
    expectedOutcome: 'success',
    evidenceType: 'mined_success',
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

  assert(balances[0].native >= parseEther('3'), 'Owner needs at least 3 native testnet USDC for gas');
  assert(existsSync(artifactPath), `Missing ${artifactPath}; run npm run build:contracts`);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi: Abi; bytecode: { object: Hex }; metadata: string | { compiler: { version: string }; settings: { optimizer: unknown; evmVersion: string } } };
  const vaultAbi = artifact.abi;
  const metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) as Exclude<typeof artifact.metadata, string> : artifact.metadata;
  const freshManifest: Manifest = {
    schemaVersion: 2,
    chainId: ARC_NETWORKS.testnet.chainId,
    sourceCommit: process.env.SOURCE_COMMIT ?? 'working-tree',
    compiler: `${metadata.compiler.version}; ${metadata.settings.evmVersion}; optimizer ${JSON.stringify(metadata.settings.optimizer)}`,
    createdAt: new Date().toISOString(),
    status: 'in_progress',
    steps: [],
  };
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
    : freshManifest;
  assert(manifest.schemaVersion === 2 && manifest.chainId === chain.id && manifest.sourceCommit === freshManifest.sourceCommit,
    'Existing manifest has a different schema, source or chain; set ARC_DEMO_MANIFEST_PATH for a new run');
  assert(manifest.status === 'in_progress', 'This demo has already completed');
  const prior = (label: string): Evidence | undefined => manifest.steps.find((step) => step.label === label);
  const ownerClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const agentClient = createWalletClient({ account: agent, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const relayClient = createWalletClient({ account: relay, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const receipt = (hash: Hex) => publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1_000 });
  const transact = async (label: string, send: () => Promise<Hex>): Promise<void> => {
    if (prior(label)) {
      console.log(`${label}: already recorded`);
      return;
    }
    recordReceipt(manifest, label, await receipt(await send()));
  };
  const lastReceiptBlock = (): bigint => manifest.steps.reduce(
    (latest, step) => step.evidenceType === 'mined_success' && step.blockNumber
      ? (BigInt(step.blockNumber) > latest ? BigInt(step.blockNumber) : latest) : latest,
    0n,
  );
  const sign = (digest: Hex): Hex => {
    const signature = slh_dsa_sha2_128s.sign(hexToBytes(digest), hexToBytes(keys.pq.secretKey));
    assert(signature.length === 7856, 'Invalid PQ signature length');
    return toHex(signature);
  };

  if (!manifest.vault) {
    assert(balances[0].usdc >= 1_000_000n, 'Owner needs at least 1 ERC20 testnet USDC');
    const deployment = await receipt(await ownerClient.deployContract({
      abi: vaultAbi,
      bytecode: artifact.bytecode.object,
      args: [owner.address, keys.pq.publicKey],
    }));
    assert(deployment.contractAddress, 'Deployment receipt has no contract address');
    manifest.vault = deployment.contractAddress;
    manifest.deploymentBlock = deployment.blockNumber.toString();
    manifest.deploymentTxHash = deployment.transactionHash;
    recordReceipt(manifest, 'deploy-vault', deployment);
  }
  const vault = manifest.vault;
  assert(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }) === owner.address, 'Vault owner mismatch');

  await transact('fund-vault-1-usdc', () => ownerClient.writeContract({
    address: USDC_ADDRESS, abi: usdcAbi, functionName: 'transfer', args: [vault, 1_000_000n],
  }));
  for (const [label, recipient] of [['fund-agent-gas', agent.address], ['fund-relay-gas', relay.address]] as const) {
    await transact(label, () => ownerClient.sendTransaction({ to: recipient, value: parseEther('0.2') }));
  }

  const context = { chainId: BigInt(ARC_NETWORKS.testnet.chainId), vault, owner: owner.address };
  const auth = async (deadlineSeconds = 600): Promise<Authorization> => {
    const at = lastReceiptBlock();
    const [nonce, sessionId, block] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'controlNonce', blockNumber: at }) as Promise<bigint>,
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'sessionId', blockNumber: at }) as Promise<bigint>,
      publicClient.getBlock({ blockNumber: at }),
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
    const expectedSession = label === 'start-session-s' ? 1n : 3n;
    if (prior(label)) {
      console.log(`${label}: already recorded`);
      return expectedSession;
    }
    const p = await policy();
    const a = await auth();
    const digest = startSessionDigest(context, p, a);
    await verifyDigest('startSessionDigest', [p, a], digest);
    await transact(label, () => ownerClient.writeContract({
      address: vault, abi: vaultAbi, functionName: 'startSession', args: [p, a, sign(digest)],
    }));
    const id = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'sessionId', blockNumber: lastReceiptBlock() }) as bigint;
    assert(id === a.sessionId + 1n, 'Session ID failed to advance');
    assert(id === expectedSession, 'Unexpected demo session ID');
    return id;
  };
  const paymentId = (label: string) => keccak256(toHex(label));
  const pay = async (label: string, id: bigint, amount = 50_000n): Promise<void> => {
    if (prior(label)) { console.log(`${label}: already recorded`); return; }
    const journalDirectory = `private/agent-journal/demo-${vault.toLowerCase()}`;
    const intended = {
      requestId: label, chainId: chain.id, vault, sessionId: id.toString(),
      to: relay.address, amount: amount.toString(), deploymentBlock: manifest.deploymentBlock!,
    };
    const port: PaymentPort = {
      async sign(intent: PaymentIntent) {
        const data = encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay',
          args: [BigInt(intent.sessionId), intent.paymentId, intent.to, BigInt(intent.amount)] });
        const prepared = await agentClient.prepareTransactionRequest({ account: agent, chain, to: vault, data, value: 0n });
        const signedTx = await agentClient.signTransaction(prepared);
        return { signedTx, txHash: keccak256(signedTx) };
      },
      async receipt(hash) {
        try {
          const found = await publicClient.getTransactionReceipt({ hash });
          return { status: found.status, blockNumber: found.blockNumber };
        } catch (error) {
          if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null;
          throw error;
        }
      },
      used(intent) {
        return publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'usedPaymentIds',
          args: [BigInt(intent.sessionId), intent.paymentId] }) as Promise<boolean>;
      },
      async paymentEvent(intent) {
        const latest = await publicClient.getBlockNumber();
        for (let from = BigInt(intent.deploymentBlock); from <= latest; from += 10_000n) {
          const logs = await publicClient.getLogs({ address: vault, event: paidEvent,
            args: { sessionId: BigInt(intent.sessionId), paymentId: intent.paymentId, to: intent.to },
            fromBlock: from, toBlock: from + 9_999n < latest ? from + 9_999n : latest });
          const match = logs.find((log) => log.args.amount === BigInt(intent.amount));
          if (match) return { txHash: match.transactionHash, blockNumber: match.blockNumber };
        }
        return null;
      },
      async broadcast(signedTx) { await agentClient.sendRawTransaction({ serializedTransaction: signedTx }); },
    };
    const result = await runPayment(journalDirectory, intended, port);
    assert(result.status !== 'reverted' && result.status !== 'used', `${label}: payment ${result.status}; inspect private journal`);
    assert(result.journal.txHash, `${label}: no transaction hash available`);
    recordReceipt(manifest, label, await receipt(result.journal.txHash));
  };
  const rejectPay = async (label: string, id: bigint, amount: bigint, expectedError: string): Promise<void> => {
    if (prior(label)) {
      console.log(`${label}: already recorded`);
      return;
    }
    const args = [id, paymentId(label), relay.address, amount] as const;
    const calldata = encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay', args });
    const block = lastReceiptBlock();
    try {
      await publicClient.simulateContract({ account: agent, address: vault, abi: vaultAbi, functionName: 'agentPay', args, blockNumber: block });
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error) {
      const decodedError = errorName(error, vaultAbi);
      assert(decodedError === expectedError, `${label}: expected ${expectedError}, got ${decodedError}`);
      manifest.steps.push({ label, expectedOutcome: 'revert', evidenceType: 'simulation_rejection', from: agent.address, to: vault, calldata, block: block.toString(), decodedError });
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
  await transact('pq-freeze-s', () => relayClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'freezeByPQ', args: [freezeAuth, sign(freezeHash)],
  }));
  await rejectPay('old-session-after-freeze', firstSession, 50_000n, 'SessionInactive');
  const secondSession = await start('start-session-s2-same-agent');
  await rejectPay('old-session-after-restart', firstSession, 50_000n, 'SessionMismatch');
  await pay('agent-pay-s2-0.05', secondSession);
  await transact('owner-freeze-s2', () => ownerClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'freezeByOwner', args: [secondSession],
  }));
  const remaining = await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [vault], blockNumber: lastReceiptBlock() }) as bigint;
  assert(remaining === 900_000n, `Expected 0.9 USDC in vault, got ${remaining}`);
  const withdrawAuth = await auth();
  const withdrawHash = withdrawDigest(context, owner.address, remaining, withdrawAuth);
  await verifyDigest('withdrawDigest', [owner.address, remaining, withdrawAuth], withdrawHash);
  await transact('hybrid-withdraw-remaining', () => ownerClient.writeContract({
    address: vault, abi: vaultAbi, functionName: 'withdraw', args: [owner.address, remaining, withdrawAuth, sign(withdrawHash)],
  }));
  assert(await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [vault], blockNumber: lastReceiptBlock() }) === 0n, 'Vault balance remains after withdrawal');
  assert(await publicClient.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [relay.address], blockNumber: lastReceiptBlock() }) >= 100_000n, 'Agent payments mismatch');
  manifest.status = 'complete';
  save(manifest);
  console.log(`Arc testnet P2 demo complete: ${vault}; evidence: ${manifestPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
