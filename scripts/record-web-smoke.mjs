// Read-only collector for real receipts submitted from the local smoke page.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sourceProvenance } from './provenance.mjs';
import { createPublicClient, decodeAbiParameters, decodeFunctionData, getAddress, http, keccak256, parseAbi } from 'viem';

const log = JSON.parse(readFileSync('private/web-smoke-transactions.json', 'utf8'));
const artifact = JSON.parse(readFileSync('contracts/out/ArcMandateVault.sol/ArcMandateVault.json', 'utf8'));
const backup = JSON.parse(readFileSync('private/web-smoke-keyfile.json', 'utf8'));
const rpc = createPublicClient({ transport: http('https://rpc.testnet.arc.io', { timeout: 30_000 }) });
if (await rpc.getChainId() !== 5042002) throw new Error('Testnet required');
const labels = ['deploy', 'fund', 'start-1', 'pq-freeze-by-relay', 'start-2', 'owner-freeze', 'withdraw'];
const functions = [null, 'transfer', 'startSession', 'freezeByPQ', 'startSession', 'freezeByOwner', 'withdraw'];
if (log.length !== labels.length) throw new Error(`Expected ${labels.length} submitted smoke transactions, found ${log.length}`);
const usdcAbi = parseAbi(['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)']);
const steps = [];
let vault;
let owner;
for (const [index, item] of log.entries()) {
  const receipt = await rpc.getTransactionReceipt({ hash: item.hash });
  const transaction = await rpc.getTransaction({ hash: item.hash });
  if (receipt.status !== 'success') throw new Error(`${labels[index]} did not succeed`);
  if (index === 0) {
    vault = getAddress(receipt.contractAddress); owner = getAddress(transaction.from);
    if (!transaction.input.startsWith(artifact.bytecode.object)) throw new Error('Deployment does not match the compiled creation bytecode');
    const [constructorOwner, constructorKey] = decodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], `0x${transaction.input.slice(artifact.bytecode.object.length)}`);
    if (getAddress(constructorOwner) !== owner || constructorKey !== backup.publicKey) throw new Error('Deployment constructor mismatch');
  }
  else {
    const decoded = decodeFunctionData({ abi: index === 1 ? usdcAbi : artifact.abi, data: transaction.input });
    if (decoded.functionName !== functions[index]) throw new Error(`Unexpected action at ${labels[index]}`);
    const target = index === 1 ? '0x3600000000000000000000000000000000000000' : vault;
    if (getAddress(transaction.to) !== getAddress(target)) throw new Error('Unexpected target');
    if (index === 1 && (getAddress(decoded.args[0]) !== vault || decoded.args[1] !== 1_000_000n)) throw new Error('Expected 1 USDC funding');
    if (index === 3 && getAddress(transaction.from) === owner) throw new Error('PQ freeze must use the relay');
    if (index !== 1 && index !== 3 && getAddress(transaction.from) !== owner) throw new Error('Management action must use the owner');
    if (index === 6 && (getAddress(decoded.args[0]) !== owner || decoded.args[1] !== 1_000_000n)) throw new Error('Expected 1 USDC withdrawal to owner');
  }
  steps.push({ label: labels[index], expectedOutcome: 'success', evidenceType: 'mined_success', txHash: item.hash,
    from: transaction.from, to: transaction.to, calldataHash: keccak256(transaction.input),
    blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, receiptStatus: receipt.status,
    gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString() });
}
const blockNumber = BigInt(steps.at(-1).blockNumber);
const read = (functionName) => rpc.readContract({ address: vault, abi: artifact.abi, functionName, blockNumber });
const active = await read('active');
const sessionId = await read('sessionId');
const controlNonce = await read('controlNonce');
const publicKey = await read('pqPublicKey');
const balance = await rpc.readContract({ address: '0x3600000000000000000000000000000000000000', abi: usdcAbi, functionName: 'balanceOf', args: [vault], blockNumber });
if (active || balance !== 0n || sessionId !== 4n || controlNonce !== 5n || publicKey !== backup.publicKey) throw new Error('Unexpected final vault state');
const manifest = { schemaVersion: 1, chainId: 5042002, vault, owner, pqPublicKey: publicKey,
  provenance: sourceProvenance(),
  deploymentBlock: steps[0].blockNumber, deploymentTxHash: steps[0].txHash,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  compiler: 'solc 0.8.28; Paris EVM; optimizer 200', creationBytecodeHash: keccak256(artifact.bytecode.object),
  createdAt: new Date().toISOString(), status: 'complete',
  walletAdapter: 'localhost development EIP-1193 bridge; disposable Arc testnet accounts',
  keyRestore: 'Browser Worker export captured unchanged to ignored disk file; clean page imports the same file and proves a fresh signature. OS Downloads picker and real wallet extensions were not tested.',
  browserChecks: ['wrong password rejected', 'onchain public key mismatch rejected', 'form change during signing cancelled', 'account change cancelled review and locked Worker', 'wrong wallet network disabled management and locked Worker', 'synthetic wallet rejection had no transaction hash'],
  unitOnlyChecks: ['mined revert UI lifecycle', 'receipt timeout keeps hash and rechecks without resending'],
  finalState: { blockNumber: blockNumber.toString(), active, sessionId: sessionId.toString(), controlNonce: controlNonce.toString(), erc20UsdcBalance: balance.toString() },
  steps };
writeFileSync(process.env.ARC_SMOKE_EVIDENCE_PATH ?? 'deployments/browser-smoke-latest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Recorded ${steps.length} successful receipts; ${vault} inactive with zero ERC20 USDC.`);
