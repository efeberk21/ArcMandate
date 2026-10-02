import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import {
  createPublicClient, createWalletClient, defineChain, encodeFunctionData, getAddress, http,
  keccak256, parseAbi, parseAbiItem, parseUnits, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_NETWORKS } from '../packages/core/src/config.js';
import { journalPath, runPayment, type PaymentIntent, type PaymentPort } from './agent-journal.js';

const abi = parseAbi([
  'function agentPay(uint256 expectedSessionId,bytes32 paymentId,address to,uint256 amount)',
  'function usedPaymentIds(uint256,bytes32) view returns (bool)',
  'function sessionId() view returns (uint256)',
  'function active() view returns (bool)',
  'function agent() view returns (address)',
]);
const paidEvent = parseAbiItem('event AgentPaid(uint256 indexed sessionId,bytes32 indexed paymentId,address indexed to,uint256 amount,uint256 spent)');

function option(name: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || !process.argv[at + 1] || process.argv[at + 1].startsWith('--')) throw new Error(`Missing --${name}`);
  return process.argv[at + 1];
}

function optionalOption(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : option(name);
}

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvFile('.env');
  const requestId = option('request');
  const vault = getAddress(option('vault'));
  const to = getAddress(option('to'));
  const amountText = option('amount');
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amountText)) throw new Error('Amount must have at most six decimal places');
  const amount = parseUnits(amountText, 6);
  if (amount === 0n) throw new Error('Amount must be positive');
  const sessionId = BigInt(option('session'));
  const deploymentBlock = BigInt(option('deployment-block'));
  if (sessionId < 0n || deploymentBlock < 0n) throw new Error('Session and deployment block must be nonnegative');
  const keyFile = JSON.parse(readFileSync(option('key-file'), 'utf8')) as unknown;
  if (typeof keyFile !== 'object' || keyFile === null || Array.isArray(keyFile)
    || Object.keys(keyFile).join(',') !== 'privateKey'
    || typeof (keyFile as { privateKey?: unknown }).privateKey !== 'string'
    || !/^0x[0-9a-fA-F]{64}$/.test((keyFile as { privateKey: string }).privateKey)) {
    throw new Error('Agent key file must contain only a privateKey field');
  }
  const agent = privateKeyToAccount((keyFile as { privateKey: Hex }).privateKey);
  const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? ARC_NETWORKS.testnet.rpcUrl;
  const chain = defineChain({
    id: ARC_NETWORKS.testnet.chainId, name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  if (await publicClient.getChainId() !== chain.id) throw new Error('Refusing a non-testnet RPC');
  const wallet = createWalletClient({ account: agent, chain, transport: http(rpcUrl, { timeout: 60_000 }) });
  const intended = {
    requestId, chainId: chain.id, vault, sessionId: sessionId.toString(), to,
    amount: amount.toString(), deploymentBlock: deploymentBlock.toString(),
  };
  const journalDirectory = optionalOption('journal-dir') ?? 'private/agent-journal';
  const path = journalPath(journalDirectory, requestId);
  const port: PaymentPort = {
    async sign(intent: PaymentIntent) {
      const [active, currentSession, currentAgent] = await Promise.all([
        publicClient.readContract({ address: vault, abi, functionName: 'active' }),
        publicClient.readContract({ address: vault, abi, functionName: 'sessionId' }),
        publicClient.readContract({ address: vault, abi, functionName: 'agent' }),
      ]);
      if (!active || currentSession !== BigInt(intent.sessionId) || currentAgent.toLowerCase() !== agent.address.toLowerCase()) {
        throw new Error('Session changed or agent is not authorized; request remains in its original session');
      }
      const data = encodeFunctionData({ abi, functionName: 'agentPay', args: [BigInt(intent.sessionId), intent.paymentId, intent.to, BigInt(intent.amount)] });
      const prepared = await wallet.prepareTransactionRequest({ account: agent, chain, to: vault, data, value: 0n });
      const signedTx = await wallet.signTransaction(prepared);
      return { signedTx, txHash: keccak256(signedTx) };
    },
    async receipt(hash) {
      try {
        const result = await publicClient.getTransactionReceipt({ hash });
        return { status: result.status, blockNumber: result.blockNumber };
      } catch (error) {
        if (error instanceof Error && error.name === 'TransactionReceiptNotFoundError') return null;
        throw error;
      }
    },
    used(intent) {
      return publicClient.readContract({ address: intent.vault, abi, functionName: 'usedPaymentIds', args: [BigInt(intent.sessionId), intent.paymentId] });
    },
    async paymentEvent(intent) {
      const head = await publicClient.getBlockNumber();
      for (let from = BigInt(intent.deploymentBlock); from <= head; from += 10_000n) {
        const logs = await publicClient.getLogs({
          address: intent.vault, event: paidEvent,
          args: { sessionId: BigInt(intent.sessionId), paymentId: intent.paymentId, to: intent.to },
          fromBlock: from, toBlock: from + 9_999n < head ? from + 9_999n : head,
        });
        const match = logs.find((log) => log.args.amount === BigInt(intent.amount));
        if (match) return { txHash: match.transactionHash, blockNumber: match.blockNumber };
      }
      return null;
    },
    async broadcast(signedTx) { await wallet.sendRawTransaction({ serializedTransaction: signedTx }); },
  };
  const result = await runPayment(journalDirectory, intended, port);
  console.log(JSON.stringify({ status: result.status, requestId, paymentId: result.journal.paymentId,
    txHash: result.journal.txHash, blockNumber: result.journal.receipt?.blockNumber, journal: path }, null, 2));
  if (result.status === 'reverted') process.exitCode = 2;
  if (result.status === 'pending' || result.status === 'used') process.exitCode = 3;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
