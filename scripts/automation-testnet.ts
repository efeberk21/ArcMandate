// Developer acceptance harness only. End users use the hosted web UI.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { createPublicClient, createWalletClient, defineChain, hexToBytes, http, parseAbi, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { vaultAbi, vaultBytecode } from '../packages/core/src/generated/vault.js';
import { startSessionDigest, withdrawDigest } from '../packages/core/src/digest.js';
const network = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } } });
const keys = JSON.parse(readFileSync('private/arc-testnet-keys.json', 'utf8'));
if (keys.chainId !== network.id) throw new Error('Only disposable testnet keys are allowed.');
const account = privateKeyToAccount(keys.owner.privateKey);
const client = createPublicClient({ chain: network, transport: http(undefined, { timeout: 20_000 }) });
const wallet = createWalletClient({ chain: network, account, transport: http(undefined, { timeout: 20_000 }) });
if (await client.getChainId() !== network.id) throw new Error('Refusing non-testnet RPC.');
const path = 'private/automation/testnet-acceptance.json';
let evidence: { vault: Address; token?: string; agent?: Address; planId?: string; startAt?: number; receipts: { label: string; hash: Hex; block: string }[] } = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { vault: '0x0000000000000000000000000000000000000000', receipts: [] };
const save = () => writeFileSync(path, JSON.stringify(evidence, null, 2));
const service = 'https://arcmandate-automation-testnet.arcmandate.workers.dev';
async function api(action: string, body: unknown = {}) {
  const response = await fetch(`${service}/v1/5042002/${evidence.vault}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(evidence.token ? { Authorization: `Bearer ${evidence.token}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json() as any;
  if (!response.ok) throw new Error(`${action}: ${result.error}`);
  return result;
}
async function receipt(label: string, hash: Hex) {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  evidence.receipts.push({ label, hash, block: r.blockNumber.toString() }); save(); console.log(JSON.stringify({ label, hash })); return r;
}
const token = '0x3600000000000000000000000000000000000000';
const tokenAbi = parseAbi(['function transfer(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)']);
async function login() { const c = await api('challenge'); evidence.token = (await api('login', { nonce: c.nonce, signature: await account.signMessage({ message: c.message }) })).token; save(); }
const action = process.argv[2];
if (action === 'prepare') {
  if (evidence.vault !== '0x0000000000000000000000000000000000000000') throw new Error('Existing acceptance must be inspected; not redeploying.');
  const deployed = await receipt('deploy', await wallet.deployContract({ abi: vaultAbi, bytecode: vaultBytecode, args: [account.address, keys.pq.publicKey] }));
  evidence.vault = deployed.contractAddress!; save();
  await login(); evidence.agent = (await api('agent')).agent; save();
  await receipt('agent-gas', await wallet.writeContract({ address: token, abi: tokenAbi, functionName: 'transfer', args: [evidence.agent!, 20000n] }));
  await receipt('vault-funding', await wallet.writeContract({ address: token, abi: tokenAbi, functionName: 'transfer', args: [evidence.vault, 30000n] }));
  const block = await client.getBlock(); const auth = { nonce: 0n, sessionId: 0n, deadline: block.timestamp + 300n };
  const policy = { agent: evidence.agent!, totalBudget: 30000n, perTxCap: 10000n, expiresAt: block.timestamp + 1800n, recipients: [account.address] };
  const signature = toHex(slh_dsa_sha2_128s.sign(hexToBytes(startSessionDigest({ chainId: 5042002n, vault: evidence.vault, owner: account.address }, policy, auth)), hexToBytes(keys.pq.secretKey)));
  await receipt('start-session', await wallet.writeContract({ address: evidence.vault, abi: vaultAbi, functionName: 'startSession', args: [policy, auth, signature] }));
  evidence.startAt = Date.now() + 90_000;
  const state = await api('plan', { recipient: account.address, amount: '10000', startAt: evidence.startAt, intervalSeconds: 90, count: 3 });
  evidence.planId = state.plan.id; save();
  console.log(JSON.stringify({ vault: evidence.vault, agent: evidence.agent, planId: evidence.planId, startAt: new Date(evidence.startAt).toISOString(), service }));
} else if (action === 'inspect') {
  await login(); const state = await api('state'); console.log(JSON.stringify(state));
  writeFileSync('private/automation/testnet-latest-state.json', JSON.stringify(state, null, 2));
} else if (action === 'freeze') {
  const sessionId = await client.readContract({ address: evidence.vault, abi: vaultAbi, functionName: 'sessionId' });
  await receipt('owner-freeze', await wallet.writeContract({ address: evidence.vault, abi: vaultAbi, functionName: 'freezeByOwner', args: [sessionId] }));
} else if (action === 'cleanup') {
  const [active, sessionId, nonce, balance, block] = await Promise.all([
    client.readContract({ address: evidence.vault, abi: vaultAbi, functionName: 'active' }), client.readContract({ address: evidence.vault, abi: vaultAbi, functionName: 'sessionId' }),
    client.readContract({ address: evidence.vault, abi: vaultAbi, functionName: 'controlNonce' }), client.readContract({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [evidence.vault] }), client.getBlock(),
  ]);
  if (active) throw new Error('Freeze first.');
  if (balance) {
    const auth = { nonce, sessionId, deadline: block.timestamp + 300n };
    const signature = toHex(slh_dsa_sha2_128s.sign(hexToBytes(withdrawDigest({ chainId: 5042002n, vault: evidence.vault, owner: account.address }, account.address, balance, auth)), hexToBytes(keys.pq.secretKey)));
    await receipt('withdraw', await wallet.writeContract({ address: evidence.vault, abi: vaultAbi, functionName: 'withdraw', args: [account.address, balance, auth, signature] }));
  }
  await login(); const state = await api('state');
  writeFileSync('deployments/automation-testnet-2026-10-10.json', JSON.stringify({ chainId: 5042002, service, vault: evidence.vault, agent: evidence.agent, receipts: evidence.receipts, state, scope: 'Hosted server scheduled transactions; developer harness used for setup. Not interactive browser acceptance.' }, null, 2));
  console.log('Testnet public evidence saved.');
} else throw new Error('Use prepare, inspect, freeze or cleanup.');
