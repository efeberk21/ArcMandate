import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_NETWORKS, USDC_ADDRESS } from '../../packages/core/src/config.js';
import { vaultAbi } from '../../packages/core/src/generated/vault.js';
import { matchesVaultRuntime } from '../../packages/core/src/runtime.js';
import { publicRpcTransport } from '../../packages/core/src/rpc-transport.js';
import { same, type FeeReturn, type Payment, type Plan, type Vault } from './model.js';

const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
export function chainAccess(network: 'testnet' | 'mainnet', rpcUrl?: string) {
  const config = ARC_NETWORKS[network];
  const chain = defineChain({ id: config.chainId, name: `Arc ${network}`, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl || config.rpcUrl] } } });
  const urls = rpcUrl ? [rpcUrl] : [config.rpcUrl, `https://rpc.blockdaemon.${network}.arc.io`, `https://rpc.drpc.${network}.arc.io`];
  const transport = publicRpcTransport(urls, chain.id, { timeout: 2_000, retryCount: 0 });
  const rpc = createPublicClient({ chain, transport });
  async function read(address: Address): Promise<Vault> {
    if (await rpc.getChainId() !== chain.id) throw new Error('RPC network mismatch.');
    const block = await rpc.getBlock();
    if (Math.abs(Date.now() - Number(block.timestamp) * 1000) > 120_000) throw new Error('RPC block is stale.');
    const at = { address, abi: vaultAbi, blockNumber: block.number } as const;
    const [owner, publicKey, active, sessionId, policy, spent, balance, code] = await Promise.all([
      rpc.readContract({ ...at, functionName: 'owner' }), rpc.readContract({ ...at, functionName: 'pqPublicKey' }),
      rpc.readContract({ ...at, functionName: 'active' }), rpc.readContract({ ...at, functionName: 'sessionId' }),
      rpc.readContract({ ...at, functionName: 'currentPolicy' }), rpc.readContract({ ...at, functionName: 'spent' }),
      rpc.readContract({ address: USDC_ADDRESS, abi: tokenAbi, functionName: 'balanceOf', args: [address], blockNumber: block.number }),
      rpc.getBytecode({ address, blockNumber: block.number }),
    ]);
    if (!matchesVaultRuntime(code, owner, publicKey)) throw new Error('Unsupported vault contract.');
    return { chainId: chain.id, address, owner, active, sessionId: sessionId.toString(), agent: policy.agent,
      expiresAt: Number(policy.expiresAt) * 1000, budget: policy.totalBudget.toString(), spent: spent.toString(),
      cap: policy.perTxCap.toString(), balance: balance.toString(), recipients: [...policy.recipients] };
  }
  return { chain, rpc, read,
    async signFeeReturn(key: Hex, owner: Address, maxFeeWei: bigint): Promise<FeeReturn> {
      const account = privateKeyToAccount(key);
      const wallet = createWalletClient({ account, chain, transport });
      const [nonce, pending, balance, gasPrice] = await Promise.all([rpc.getTransactionCount({ address: account.address }), rpc.getTransactionCount({ address: account.address, blockTag: 'pending' }), rpc.getBalance({ address: account.address }), rpc.getGasPrice()]);
      if (nonce !== pending) throw new Error('Resolve the agent’s pending transaction first.');
      const estimate = await rpc.estimateGas({ account, to: owner, value: 1n });
      const gas = (estimate * 120n + 99n) / 100n, fee = gas * gasPrice;
      if (maxFeeWei <= 0n || maxFeeWei > 10_000_000_000_000_000n || fee > maxFeeWei) throw new Error('Fee return exceeds the network fee cap.');
      if (balance <= fee) throw new Error('Remaining fee balance is too small to return after network fees.');
      const amount = balance - fee;
      const signedTx = await wallet.signTransaction({ chain, to: owner, value: amount, nonce, gas, gasPrice, type: 'legacy' });
      return { signedTx, hash: keccak256(signedTx), nonce, amount: amount.toString(), status: 'signed', message: 'Fee return signed; waiting for confirmation. A small gas reserve may remain.' };
    },
    async reconcileFeeReturn(agent: Address, owner: Address, item: FeeReturn): Promise<'pending' | 'confirmed' | 'failed'> {
      if (keccak256(item.signedTx) !== item.hash) throw new Error('Fee return journal is invalid.');
      let receipt;
      try { receipt = await rpc.getTransactionReceipt({ hash: item.hash }); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'TransactionReceiptNotFoundError') throw error; }
      if (!receipt) {
        if (await rpc.getTransactionCount({ address: agent }) > item.nonce) throw new Error('Fee return nonce changed. Review the original hash.');
        return 'pending';
      }
      if (!same(receipt.from, agent) || !receipt.to || !same(receipt.to, owner)) throw new Error('Fee return receipt mismatch.');
      return receipt.status === 'success' ? 'confirmed' : 'failed';
    },
    async sign(vault: Address, key: Hex, plan: Plan, payment: Payment, maxFeeWei: bigint) {
      if (maxFeeWei <= 0n || maxFeeWei > 10_000_000_000_000_000n) throw new Error('Invalid service fee cap.');
      const account = privateKeyToAccount(key);
      if (!same(account.address, plan.agent)) throw new Error('Agent key does not match this plan.');
      const wallet = createWalletClient({ account, chain, transport });
      const data = encodeFunctionData({ abi: vaultAbi, functionName: 'agentPay', args: [BigInt(plan.sessionId), payment.paymentId, plan.recipient, BigInt(plan.amount)] });
      const [mined, pending] = await Promise.all([rpc.getTransactionCount({ address: account.address }), rpc.getTransactionCount({ address: account.address, blockTag: 'pending' })]);
      if (mined !== pending) throw new Error('Agent already has a pending transaction.');
      // Legacy fee explicitly capped: no surprise gas expenditure and identical-byte retries.
      const [gasEstimate, gasPrice, balance] = await Promise.all([
        rpc.estimateGas({ account, to: vault, data }), rpc.getGasPrice(), rpc.getBalance({ address: account.address }),
      ]);
      const gas = (gasEstimate * 120n + 99n) / 100n;
      if (gas * gasPrice > maxFeeWei) throw new Error('Network fee exceeds the service safety cap. Plan paused.');
      if (balance < gas * gasPrice) throw new Error('Add USDC to the agent for network fees, then resume.');
      const signedTx = await wallet.signTransaction({ chain, to: vault, data, gas, gasPrice, nonce: mined, type: 'legacy', value: 0n });
      return { signedTx, hash: keccak256(signedTx), nonce: mined };
    },
    async reconcile(vault: Address, plan: Plan, payment: Payment): Promise<'pending' | 'confirmed' | 'reverted' | 'nonce-conflict'> {
      if (!payment.hash || !payment.signedTx || keccak256(payment.signedTx) !== payment.hash) throw new Error('Payment journal is invalid.');
      let receipt;
      try { receipt = await rpc.getTransactionReceipt({ hash: payment.hash }); }
      catch (error) { if (!(error instanceof Error) || error.name !== 'TransactionReceiptNotFoundError') throw error; }
      if (receipt) {
        if (!same(receipt.from, plan.agent) || !receipt.to || !same(receipt.to, vault)) throw new Error('Receipt does not match the agent and vault.');
        if (receipt.status === 'reverted') return 'reverted';
        const event = receipt.logs.some(log => {
          if (!same(log.address, vault)) return false;
          try {
            const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
            return decoded.eventName === 'AgentPaid' && decoded.args.sessionId.toString() === plan.sessionId && decoded.args.paymentId === payment.paymentId
              && same(decoded.args.to, plan.recipient) && decoded.args.amount === BigInt(plan.amount);
          } catch { return false; }
        });
        if (!event || !await rpc.readContract({ address: vault, abi: vaultAbi, functionName: 'usedPaymentIds', args: [BigInt(plan.sessionId), payment.paymentId] })) throw new Error('Receipt has no matching payment proof.');
        payment.block = receipt.blockNumber.toString();
        return 'confirmed';
      }
      const used = await rpc.readContract({ address: vault, abi: vaultAbi, functionName: 'usedPaymentIds', args: [BigInt(plan.sessionId), payment.paymentId] });
      // Keep polling the known hash if indexing lags; never issue a second payment.
      if (used) return 'pending';
      const mined = await rpc.getTransactionCount({ address: getAddress(plan.agent) });
      return mined > payment.nonce! ? 'nonce-conflict' : 'pending';
    },
    async broadcast(serializedTransaction: Hex) { await rpc.sendRawTransaction({ serializedTransaction }); },
  };
}
