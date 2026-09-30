import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { encodeDeployData, encodeFunctionData, formatUnits, getAddress, isAddress, type Address, type Hex } from 'viem';
import { ARC_NETWORKS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi, vaultBytecode } from '@arcmandate/core/contracts';
import { addressInput, buildPolicy, usdcInput } from '@arcmandate/core/policy';
import { freezeDigest, startSessionDigest, withdrawDigest, type Policy } from '@arcmandate/core/digest';
import manifest from '../../../deployments/arc-testnet.json';
import { KeyPanel } from './components/KeyPanel';
import { arcClient, DEMO_VAULT, readVault, simulate, usdcAbi, type ArcClient, type Network, type VaultSnapshot } from './lib/chain';
import { assertWallet, ContextChanged, sendWalletTransaction, switchNetwork, walletContext } from './lib/wallet';
import { errorMessage, prepareTransaction, submitTransaction, trackReceipt, type Quote, type Receipt, type TransactionInput, type TransactionPort, type TransactionState } from './lib/transactions';
import { usePqKey } from './lib/use-pq-key';
import type { SigningIntent } from './worker/pq.worker';

type Action = 'deploy' | 'fund' | 'start' | 'owner-freeze' | 'pq-freeze' | 'withdraw';
type Review = {
  action: Action; title: string; network: Network; account: Address; epoch: number;
  snapshot?: VaultSnapshot; intent?: SigningIntent; input?: TransactionInput;
  publicKey?: Hex; amount?: bigint; to?: Address; policy?: Policy;
};
type Ready = { review: Review; input: TransactionInput; quote: Quote; port: TransactionPort };
type Tracked = { review: Review; port: TransactionPort; hash?: Hex };
const usd = (value: bigint) => `${formatUnits(value, 6)} USDC`;
const date = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString();
const initialUrl = new URL(window.location.href);
const initialNetwork: Network = initialUrl.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'testnet';
const initialAddress = initialUrl.searchParams.get('vault');

function PolicySummary({ policy }: { policy: Policy }) {
  return <dl className="summary">
    <dt>Agent</dt><dd className="mono">{policy.agent}</dd>
    <dt>Total budget</dt><dd>{usd(policy.totalBudget)}</dd>
    <dt>Per-payment cap</dt><dd>{usd(policy.perTxCap)}</dd>
    <dt>Expires</dt><dd>{date(policy.expiresAt)}</dd>
    <dt>Recipients</dt><dd>{policy.recipients.map((address) => <div className="mono" key={address}>{address}</div>)}</dd>
  </dl>;
}

export default function App() {
  const [network, setNetwork] = useState<Network>(initialNetwork);
  const [vault, setVault] = useState<Address | null>(initialAddress && isAddress(initialAddress) ? getAddress(initialAddress) : initialNetwork === 'testnet' ? getAddress(DEMO_VAULT) : null);
  const [vaultInput, setVaultInput] = useState(vault ?? '');
  const [mode, setMode] = useState<'read' | 'manage'>('read');
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletError, setWalletError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [transaction, setTransaction] = useState<TransactionState>({ stage: 'idle', message: 'Review an action to begin.' });
  const [transactionNetwork, setTransactionNetwork] = useState<Network>('testnet');
  const [sessionForm, setSessionForm] = useState({ agent: '', budget: '0.15', cap: '0.05', minutes: '15', recipients: '' });
  const [fundAmount, setFundAmount] = useState('1');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawTo, setWithdrawTo] = useState('');
  const pq = usePqKey();
  const provider = window.ethereum;
  const client = useMemo(() => arcClient(network), [network]);
  const epoch = useRef(0);
  const readEpoch = useRef(0);
  const connected = useRef(false);
  const running = useRef(false);
  const tracked = useRef<Tracked | null>(null);
  const selection = useRef({ network, vault });
  selection.current = { network, vault };
  const minBlock = useRef(new Map<string, bigint>());

  const invalidate = useCallback(() => {
    epoch.current++;
    setReview(null); setReady(null);
    setTransaction((state) => ['preparing', 'review', 'signing', 'simulating', 'ready'].includes(state.stage)
      ? { stage: 'cancelled', message: 'The form or context changed. Review the action again.' } : state);
  }, []);
  useEffect(() => { invalidate(); pq.lock(); }, [network, vault, account, walletChain, mode, invalidate, pq.lock]);

  const refresh = useCallback(async (at?: bigint) => {
    if (!vault) { setSnapshot(null); setReadError(''); setReading(false); return; }
    const ticket = ++readEpoch.current;
    setReading(true);
    try {
      const minimum = minBlock.current.get(`${network}:${vault}`);
      const latest = at === undefined ? await client.getBlockNumber({ cacheTime: 0 }) : at;
      const target = minimum && latest < minimum ? minimum : latest;
      const next = await readVault(client, vault, target);
      if (ticket !== readEpoch.current) return;
      setSnapshot(next); setReadError('');
    } catch (error) {
      if (ticket === readEpoch.current) { setReadError(errorMessage(error)); setSnapshot(null); }
    } finally { if (ticket === readEpoch.current) setReading(false); }
  }, [client, network, vault]);

  useEffect(() => {
    setSnapshot(null); setReadError('');
    void refresh(vault ? minBlock.current.get(`${network}:${vault}`) : undefined);
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { readEpoch.current++; clearInterval(timer); };
  }, [refresh, network, vault]);
  useEffect(() => {
    let current = true;
    setWalletBalance(null);
    if (account) void client.getBalance({ address: account }).then((value) => { if (current) setWalletBalance(value); }).catch(() => {});
    return () => { current = false; };
  }, [account, client, transaction.stage]);

  useEffect(() => {
    if (!provider) return;
    const changed = () => {
      invalidate(); pq.lock();
      if (connected.current) void walletContext(provider).then((next) => { setAccount(next.account); setWalletChain(next.chainId); }).catch((error) => { setWalletError(errorMessage(error)); setAccount(null); });
    };
    const disconnected = () => { connected.current = false; invalidate(); pq.lock(); setAccount(null); setWalletChain(null); };
    provider.on?.('accountsChanged', changed); provider.on?.('chainChanged', changed); provider.on?.('disconnect', disconnected);
    return () => {
      provider.removeListener?.('accountsChanged', changed); provider.removeListener?.('chainChanged', changed); provider.removeListener?.('disconnect', disconnected);
    };
  }, [provider, invalidate, pq.lock]);

  async function connect() {
    try {
      if (!provider) throw new Error('Open this page in a browser with an EVM wallet extension.');
      await provider.request({ method: 'eth_requestAccounts' });
      const next = await walletContext(provider);
      connected.current = true; setAccount(next.account); setWalletChain(next.chainId); setWalletError('');
    } catch (error) { setWalletError(errorMessage(error)); }
  }

  function openVault() {
    try {
      const next = addressInput(vaultInput, 'Vault');
      invalidate(); pq.lock(); setVault(next); setWalletError('');
      const url = new URL(window.location.href); url.searchParams.set('network', network); url.searchParams.set('vault', next);
      window.history.replaceState(null, '', url);
      if (next === vault) void refresh();
    } catch (error) { setWalletError(errorMessage(error)); }
  }

  async function exclusive(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await task(); }
    catch (error) { setTransaction({ stage: 'cancelled', message: errorMessage(error) }); }
    finally { running.current = false; setBusy(false); }
  }

  const canManage = mode === 'manage' && network === 'testnet' && !!account && walletChain === ARC_NETWORKS[network].chainId;
  const matchingKey = pq.phase === 'restored' && !!snapshot && pq.publicKey?.toLowerCase() === snapshot.publicKey.toLowerCase();
  const ownerConnected = !!snapshot && account === getAddress(snapshot.owner);

  async function currentVault(rpc: ArcClient, address: Address, net: Network) {
    const head = await rpc.getBlockNumber({ cacheTime: 0 });
    const minimum = minBlock.current.get(`${net}:${address}`);
    return readVault(rpc, address, minimum && head < minimum ? minimum : head);
  }

  function prepare(action: Action) {
    if (running.current || (transaction.stage === 'unknown' && (transaction.hash || transaction.walletRequested))) return;
    invalidate();
    const ticket = epoch.current;
    void exclusive(async () => {
      if (!canManage || !account || !provider) throw new Error('Connect a wallet on Arc testnet and enter management mode.');
      setTransaction({ stage: 'preparing', message: 'Reading current chain authorization…' });
      await assertWallet(provider, account, ARC_NETWORKS[network].chainId);
      if (await client.getChainId() !== ARC_NETWORKS[network].chainId) throw new Error('RPC network mismatch');
      const next = vault ? await currentVault(client, vault, network) : undefined;
      if (ticket !== epoch.current) throw new ContextChanged('Context changed during preparation');
      if (next) setSnapshot(next);
      const titles: Record<Action, string> = { deploy: 'Deploy a personal vault', fund: 'Fund the vault', start: next?.active ? 'Replace the spending session' : 'Start a spending session', 'owner-freeze': 'Freeze with owner wallet', 'pq-freeze': 'Freeze with PQ key', withdraw: 'Withdraw USDC' };
      const result: Review = { action, title: titles[action], network, account, epoch: ticket, snapshot: next, publicKey: pq.publicKey ?? undefined };
      if (action === 'deploy') {
        if (vault) throw new Error('Choose “New vault” before deploying');
        if (pq.phase !== 'restored' || !pq.publicKey) throw new Error('Restore your backup before deploying');
        result.input = { from: account, data: encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args: [account, pq.publicKey] }) };
      } else {
        if (!next) throw new Error('Open a vault first');
        if (action !== 'pq-freeze' && action !== 'fund' && getAddress(next.owner) !== account) throw new Error('This action requires the vault owner wallet');
        if (action !== 'owner-freeze' && (pq.phase !== 'restored' || pq.publicKey?.toLowerCase() !== next.publicKey.toLowerCase())) throw new Error('Restore a backup matching this vault’s PQ key');
        const context = { chainId: BigInt(ARC_NETWORKS[network].chainId), vault: next.address, owner: next.owner };
        const auth = { nonce: next.nonce, sessionId: next.sessionId, deadline: next.timestamp + 600n };
        if (action === 'fund') {
          result.amount = usdcInput(fundAmount);
          result.input = { from: account, to: USDC_ADDRESS, data: encodeFunctionData({ abi: usdcAbi, functionName: 'transfer', args: [next.address, result.amount] }) };
        } else if (action === 'start') {
          result.policy = buildPolicy(sessionForm, next.owner, next.address, next.timestamp);
          result.intent = { action: 'START_SESSION', context, auth, policy: result.policy };
        } else if (action === 'owner-freeze') {
          if (!next.active) throw new Error('The vault has no active session');
          result.input = { from: account, to: next.address, data: encodeFunctionData({ abi: vaultAbi, functionName: 'freezeByOwner', args: [next.sessionId] }) };
        } else if (action === 'pq-freeze') {
          if (!next.active) throw new Error('The vault has no active session');
          result.intent = { action: 'FREEZE', context, auth };
        } else {
          if (next.active) throw new Error('Freeze the session and wait for its receipt before preparing a withdrawal');
          result.to = addressInput(withdrawTo, 'Withdrawal recipient'); result.amount = usdcInput(withdrawAmount);
          if (result.to === getAddress(next.address)) throw new Error('Withdrawal recipient cannot be the vault');
          if (result.amount > next.balance) throw new Error('Withdrawal amount exceeds the vault balance');
          result.intent = { action: 'WITHDRAW', context, auth, to: result.to, amount: result.amount };
        }
      }
      if (ticket !== epoch.current) throw new ContextChanged('Context changed during preparation');
      setTransactionNetwork(network); setReview(result); setTransaction({ stage: 'review', message: 'Confirm the exact action below.' });
    });
  }

  function portFor(item: Review, rpc: ArcClient): TransactionPort {
    return {
      async assertContext() {
        if (item.epoch !== epoch.current || !provider) throw new ContextChanged('The form, key, wallet, network or vault changed. Review again.');
        await assertWallet(provider, item.account, ARC_NETWORKS[item.network].chainId);
        if (await rpc.getChainId() !== ARC_NETWORKS[item.network].chainId) throw new ContextChanged('RPC network mismatch');
        // Owner/key are immutable and were checked during preparation. Read only
        // changing authorization fields here, at one block, to limit RPC load.
        if (item.snapshot && (item.intent || item.action === 'owner-freeze')) {
          const head = await rpc.getBlockNumber({ cacheTime: 0 });
          const minimum = minBlock.current.get(`${item.network}:${item.snapshot.address}`);
          const block = await rpc.getBlock({ blockNumber: minimum && head < minimum ? minimum : head });
          const at = { address: item.snapshot.address, abi: vaultAbi, blockNumber: block.number } as const;
          const [nonce, sessionId, active] = await Promise.all([
            rpc.readContract({ ...at, functionName: 'controlNonce' }),
            rpc.readContract({ ...at, functionName: 'sessionId' }),
            rpc.readContract({ ...at, functionName: 'active' }),
          ]);
          if (item.intent && (nonce !== item.intent.auth.nonce || sessionId !== item.intent.auth.sessionId || block.timestamp >= item.intent.auth.deadline)) {
            throw new ContextChanged('Authorization changed or expired. Review the current state again.');
          }
          if (item.action === 'owner-freeze' && (!active || sessionId !== item.snapshot.sessionId)) throw new ContextChanged('The session changed before freeze');
        }
        if (item.epoch !== epoch.current) throw new ContextChanged('Context changed while reading the chain');
      },
      simulate: (input) => simulate(rpc, input),
      async quote(input) {
        const [estimate, gasPrice] = await Promise.all([rpc.estimateGas({ account: input.from, to: input.to, data: input.data }), rpc.getGasPrice()]);
        return { gas: (estimate * 120n + 99n) / 100n, gasPrice };
      },
      send: (input, gas) => sendWalletTransaction(provider!, { ...input, gas, chainId: ARC_NETWORKS[item.network].chainId }),
      receipt: (hash) => rpc.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1500 }),
    };
  }

  function approve() {
    if (!review) return;
    const item = review;
    void exclusive(async () => {
      const rpc = arcClient(item.network);
      const port = portFor(item, rpc);
      await port.assertContext();
      let input = item.input;
      if (item.intent) {
        setTransaction({ stage: 'signing', message: 'Signing the reviewed intent with your PQ key…' });
        const signed = await pq.sign(item.intent);
        await port.assertContext();
        const intent = item.intent;
        let expected: Hex;
        let onchain: Hex;
        if (intent.action === 'START_SESSION') {
          expected = startSessionDigest(intent.context, intent.policy, intent.auth);
          onchain = await rpc.readContract({ address: intent.context.vault, abi: vaultAbi, functionName: 'startSessionDigest', args: [intent.policy, intent.auth] });
          input = { from: item.account, to: intent.context.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'startSession', args: [intent.policy, intent.auth, signed.signature] }) };
        } else if (intent.action === 'FREEZE') {
          expected = freezeDigest(intent.context, intent.auth);
          onchain = await rpc.readContract({ address: intent.context.vault, abi: vaultAbi, functionName: 'freezeDigest', args: [intent.auth] });
          input = { from: item.account, to: intent.context.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'freezeByPQ', args: [intent.auth, signed.signature] }) };
        } else {
          expected = withdrawDigest(intent.context, intent.to, intent.amount, intent.auth);
          onchain = await rpc.readContract({ address: intent.context.vault, abi: vaultAbi, functionName: 'withdrawDigest', args: [intent.to, intent.amount, intent.auth] });
          input = { from: item.account, to: intent.context.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw', args: [intent.to, intent.amount, intent.auth, signed.signature] }) };
        }
        if (signed.digest !== expected || onchain !== expected) throw new Error('Worker and vault disagree about the authorization digest');
      }
      if (!input) throw new Error('Missing transaction');
      const quote = await prepareTransaction(port, input, setTransaction);
      if (quote && item.epoch === epoch.current) setReady({ review: item, input, quote, port });
    });
  }

  async function afterReceipt(item: Review, receipt: Receipt) {
    if (receipt.status !== 'success') return;
    if (item.action === 'deploy' && receipt.contractAddress) {
      if (selection.current.network === item.network && selection.current.vault === null) {
        minBlock.current.set(`${item.network}:${getAddress(receipt.contractAddress)}`, receipt.blockNumber);
        setVault(getAddress(receipt.contractAddress)); setVaultInput(getAddress(receipt.contractAddress));
        const url = new URL(window.location.href);
        url.searchParams.set('network', item.network); url.searchParams.set('vault', receipt.contractAddress);
        window.history.replaceState(null, '', url);
      }
    } else if (item.snapshot && selection.current.network === item.network && selection.current.vault === item.snapshot.address) {
      minBlock.current.set(`${item.network}:${item.snapshot.address}`, receipt.blockNumber);
      await refresh(receipt.blockNumber);
    }
  }

  function send() {
    if (!ready) return;
    const current = ready;
    setReady(null); setReview(null);
    tracked.current = { review: current.review, port: current.port };
    void exclusive(async () => {
      const receipt = await submitTransaction(current.port, current.input, current.quote, (state) => {
        if (state.hash && tracked.current) tracked.current.hash = state.hash;
        setTransaction(state);
      });
      if (receipt) await afterReceipt(current.review, receipt);
    });
  }

  function retryReceipt() {
    const current = tracked.current;
    if (!current?.hash) return;
    void exclusive(async () => {
      setTransaction({ stage: 'submitted', hash: current.hash, message: 'Checking the submitted transaction receipt…' });
      const receipt = await trackReceipt(current.port, current.hash!, setTransaction);
      if (receipt) await afterReceipt(current.review, receipt);
    });
  }

  const unresolved = transaction.stage === 'unknown' && (!!transaction.hash || !!transaction.walletRequested);
  const controlsDisabled = busy || pq.busy || !canManage || unresolved || !!readError || (!snapshot && !!vault);
  return <main>
    <header><div><p className="eyebrow">ARC · BOUNDED AGENT SPENDING</p><h1>ArcMandate</h1><p>Give an agent a defined USDC budget. Keep control of every new session.</p></div><span className="badge">Testnet prototype</span></header>
    <section className="panel connection">
      <div><label>Network<select value={network} onChange={(e) => { invalidate(); pq.lock(); setNetwork(e.target.value as Network); setVault(null); setVaultInput(''); setMode('read'); }}><option value="testnet">Arc Testnet</option><option value="mainnet">Arc Mainnet · read only</option></select></label>
        <p className="muted">Chain {ARC_NETWORKS[network].chainId}</p></div>
      <div className="wallet-info">{account ? <><p className="mono">{account}</p><p>Wallet chain: {walletChain}{walletChain !== ARC_NETWORKS[network].chainId && <strong className="error"> · wrong network</strong>}</p>
        {walletBalance !== null && <p>Wallet USDC available for gas: {formatUnits(walletBalance, 18)}. This is the native view of the same wallet USDC balance.</p>}
        <div className="actions"><button className="secondary" onClick={() => { connected.current = false; invalidate(); pq.lock(); setAccount(null); setWalletChain(null); }}>Disconnect</button>
          {walletChain !== ARC_NETWORKS[network].chainId && <button onClick={() => { if (provider) void switchNetwork(provider, network).then(connect).catch((error) => setWalletError(errorMessage(error))); }}>Switch wallet network</button>}</div></>
        : <button onClick={() => void connect()}>Connect wallet</button>}</div>
      {walletError && <p className="error" role="alert">{walletError}</p>}
    </section>
    <section className="panel">
      <div className="section-heading"><h2>Vault</h2><span className="badge">{mode === 'read' ? 'Read only' : 'Management'}</span></div>
      <div className="address-row"><label>Vault address<input value={vaultInput} placeholder="0x…" onChange={(e) => { invalidate(); setVaultInput(e.target.value); }} /></label><button onClick={openVault}>Open vault</button></div>
      <div className="actions"><button className="secondary" disabled={network !== 'testnet'} onClick={() => { setVault(getAddress(DEMO_VAULT)); setVaultInput(DEMO_VAULT); setMode('read'); invalidate(); pq.lock(); }}>View demo</button>
        <button className="secondary" disabled={network !== 'testnet'} onClick={() => { invalidate(); pq.lock(); setMode(mode === 'read' ? 'manage' : 'read'); }}>{mode === 'read' ? 'Enter management mode' : 'Return to read only'}</button>
        {mode === 'manage' && <button className="secondary" disabled={busy} onClick={() => { invalidate(); pq.lock(); setVault(null); setVaultInput(''); }}>New vault</button>}
        {vault && <button className="secondary" disabled={reading} onClick={() => void refresh()}>Refresh state</button>}</div>
      {readError && <p className="error" role="alert">Live state unavailable: {readError}</p>}
      {reading && !snapshot && <p role="status">Reading vault state…</p>}
      {snapshot && <>
        <p className="mono"><a href={`${ARC_NETWORKS[network].explorerUrl}/address/${snapshot.address}`} target="_blank" rel="noreferrer">{snapshot.address}</a></p>
        <div className="metrics"><div><span>Vault balance</span><strong>{usd(snapshot.balance)}</strong></div><div><span>Remaining authority</span><strong>{usd(snapshot.policy.totalBudget - snapshot.spent)}</strong></div><div><span>Session</span><strong>{snapshot.sessionId.toString()}</strong></div><div><span>Status</span><strong>{!snapshot.active ? 'Frozen / inactive' : snapshot.timestamp >= snapshot.policy.expiresAt ? 'Expired · active onchain' : snapshot.spent >= snapshot.policy.totalBudget ? 'Budget used · active onchain' : 'Active'}</strong></div></div>
        <p className="mono">Owner: {snapshot.owner}</p><p className="mono">PQ public key: {snapshot.publicKey}</p>
        {snapshot.active && <PolicySummary policy={snapshot.policy} />}
        <p className="muted">State at block {snapshot.blockNumber.toString()} · control nonce {snapshot.nonce.toString()}. New deposits do not increase the session budget.</p>
      </>}
      {network === 'mainnet' && <p>Mainnet management opens after the release checks are complete.</p>}
    </section>
    {mode === 'manage' && <>
      <KeyPanel key={`${network}:${vault}:${account}:${walletChain}`} pq={pq} expectedKey={snapshot?.publicKey} disabled={busy || (!!vault && !snapshot)} onChange={invalidate} />
      {!vault ? <section className="panel"><h2>Create your vault</h2><p>Your connected wallet becomes the immutable owner. The restored PQ key becomes the second management key.</p><button disabled={controlsDisabled || pq.phase !== 'restored'} onClick={() => prepare('deploy')}>Review deployment</button></section> : <>
        <section className="panel"><h2>Fund with USDC</h2><p>Funding adds balance without changing spending authority. Keep enough USDC in your wallet for network fees.</p><label>Funding amount (USDC)<input inputMode="decimal" value={fundAmount} onChange={(e) => { invalidate(); setFundAmount(e.target.value); }} /></label><button disabled={controlsDisabled || !matchingKey} onClick={() => prepare('fund')}>Review funding</button></section>
        <section className="panel"><h2>{snapshot?.active ? 'Replace session' : 'Authorize a session'}</h2><p>Owner wallet + PQ approval. A new session replaces the previous authority and resets spent to zero.</p>
          <div className="fields">{(['agent', 'budget', 'cap', 'minutes'] as const).map((field) => <label key={field}>{({ agent: 'Agent wallet', budget: 'Total budget (USDC)', cap: 'Per-payment cap (USDC)', minutes: 'Duration (minutes)' })[field]}<input value={sessionForm[field]} onChange={(e) => { invalidate(); setSessionForm((previous) => ({ ...previous, [field]: e.target.value })); }} /></label>)}</div>
          <label>Allowed recipients (1–5 addresses)<textarea value={sessionForm.recipients} placeholder="One address per line" onChange={(e) => { invalidate(); setSessionForm((previous) => ({ ...previous, recipients: e.target.value })); }} /></label>
          <button disabled={controlsDisabled || !ownerConnected || !matchingKey} onClick={() => prepare('start')}>Review session</button>
        </section>
        <section className="panel"><h2>Freeze spending</h2><p>Either management key can revoke the session. Transfers ordered before freeze may still execute. Expired or exhausted sessions must also be frozen before withdrawal.</p>
          <div className="actions"><button disabled={controlsDisabled || !ownerConnected || !snapshot?.active} onClick={() => prepare('owner-freeze')}>Review owner freeze</button><button disabled={controlsDisabled || !matchingKey || !snapshot?.active} onClick={() => prepare('pq-freeze')}>Review PQ freeze</button></div>
          <p className="muted">PQ freeze can be submitted by a wallet other than the owner.</p>
        </section>
        <section className="panel"><h2>Withdraw</h2><p>Requires the owner wallet, restored PQ key, and an inactive session.</p><div className="fields"><label>Withdrawal recipient<input value={withdrawTo} placeholder={account ?? '0x…'} onChange={(e) => { invalidate(); setWithdrawTo(e.target.value); }} /></label><label>Withdrawal amount (USDC)<input inputMode="decimal" value={withdrawAmount} onChange={(e) => { invalidate(); setWithdrawAmount(e.target.value); }} /></label></div>
          <button disabled={controlsDisabled || !ownerConnected || !matchingKey || !!snapshot?.active} onClick={() => prepare('withdraw')}>Review withdrawal</button>
        </section>
      </>}
    </>}
    {(review || transaction.stage !== 'idle') && <section className="panel transaction" aria-label="Transaction review">
      <div className="section-heading"><h2>{review?.title ?? 'Transaction status'}</h2><span className="badge">{transaction.stage}</span></div>
      {review && <>
        <dl className="summary"><dt>Network</dt><dd>Arc {review.network} · {ARC_NETWORKS[review.network].chainId}</dd><dt>Sender</dt><dd className="mono">{review.account}</dd>{review.snapshot && <><dt>Vault</dt><dd className="mono">{review.snapshot.address}</dd><dt>Session / nonce</dt><dd>{review.snapshot.sessionId.toString()} / {review.snapshot.nonce.toString()}</dd></>}{review.amount !== undefined && <><dt>Amount</dt><dd>{usd(review.amount)}</dd></>}{review.to && <><dt>Recipient</dt><dd className="mono">{review.to}</dd></>}{review.action === 'deploy' && <><dt>PQ public key</dt><dd className="mono">{review.publicKey}</dd></>}{review.intent && <><dt>Authorization deadline</dt><dd>{date(review.intent.auth.deadline)}</dd></>}</dl>
        {review.policy && <>
          {review.snapshot?.active && <details open><summary>Current session being replaced</summary><PolicySummary policy={review.snapshot.policy} /></details>}
          <h3>New session</h3><PolicySummary policy={review.policy} />
          {review.policy.recipients.includes(getAddress(review.policy.agent)) && <p className="warning">The agent is an allowed recipient and can transfer funds to its own wallet.</p>}
          {review.snapshot && review.policy.totalBudget > review.snapshot.balance && <p className="warning">The budget exceeds the current balance. Future deposits may make the remaining authority spendable.</p>}
        </>}
        {ready ? <><p>Estimated network fee with gas buffer: <strong>{formatUnits(ready.quote.gas * ready.quote.gasPrice, 18)} USDC</strong>. Your wallet confirms the final fee.</p><button disabled={busy} onClick={send}>Send wallet transaction</button></>
          : <button disabled={busy || transaction.stage !== 'review'} onClick={approve}>{review.intent ? 'Approve intent and sign with PQ key' : 'Approve and simulate'}</button>}
        <button className="secondary" onClick={invalidate}>Cancel review</button>
      </>}
      <p role="status">{transaction.message}</p>
      {transaction.hash && <p className="mono"><a target="_blank" rel="noreferrer" href={`${ARC_NETWORKS[transactionNetwork].explorerUrl}/tx/${transaction.hash}`}>View transaction {transaction.hash}</a></p>}
      {transaction.stage === 'unknown' && transaction.hash && <button disabled={busy} onClick={retryReceipt}>Check receipt again</button>}
      {transaction.stage === 'unknown' && transaction.walletRequested && !transaction.hash && <><p className="warning">The wallet request may have been submitted. Check your wallet activity before starting another action.</p><button onClick={() => setTransaction({ stage: 'idle', message: 'Wallet activity checked. Review a new action when ready.' })}>I checked wallet activity</button></>}
    </section>}
    <section className="panel evidence"><h2>Testnet evidence</h2><p>The recorded P2 demo funded the vault with 1 USDC, paid twice, froze both sessions and withdrew 0.9 USDC. The demo vault was emptied. Open the demo vault to compare its current state with these historical receipts.</p>
      <details><summary>Open transaction and simulation records</summary><table><thead><tr><th>Step</th><th>Evidence</th><th>Result</th></tr></thead><tbody>{manifest.steps.map((step) => <tr key={step.label}><td>{step.label}</td><td>{step.txHash ? <a href={`${ARC_NETWORKS.testnet.explorerUrl}/tx/${step.txHash}`} target="_blank" rel="noreferrer">Mined receipt</a> : `Simulation at block ${step.block}`}</td><td>{step.decodedError ?? step.receiptStatus}</td></tr>)}</tbody></table></details>
    </section>
    <footer>Prototype · no key recovery or rotation · PQ protects application authorization, not the wallet transaction or the whole network.</footer>
  </main>;
}
