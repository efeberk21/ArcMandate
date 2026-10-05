import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { encodeDeployData, encodeFunctionData, formatUnits, getAddress, isAddress, type Address, type Hex } from 'viem';
import { ARC_NETWORKS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi, vaultBytecode } from '@arcmandate/core/contracts';
import { addressInput, buildPolicy, usdcInput } from '@arcmandate/core/policy';
import { freezeDigest, startSessionDigest, withdrawDigest, type Policy } from '@arcmandate/core/digest';
import manifest from '../../../deployments/arc-testnet.json';
import { KeyPanel } from './components/KeyPanel';
import { RecentEvents } from './components/RecentEvents';
import { SessionPlate, StatusBadge, TechnicalIcon } from './components/SessionPlate';
import { arcClient, DEMO_VAULT, readVault, simulate, usdcAbi, type ArcClient, type Network, type VaultSnapshot } from './lib/chain';
import { assertWallet, ContextChanged, sendWalletTransaction, switchNetwork, walletContext } from './lib/wallet';
import { broadcastTransaction, errorMessage, prepareTransaction, trackReceipt, type Quote, type Receipt, type TransactionInput, type TransactionPort, type TransactionState } from './lib/transactions';
import { canSubmitOperation, loadOperations, operationFromInput, operationReceipt, saveOperation, unresolvedOperation, type Action, type Operation } from './lib/operations';
import { usePqKey } from './lib/use-pq-key';
import type { SigningIntent } from './worker/pq.worker';

type Review = {
  action: Action; title: string; network: Network; account: Address; epoch: number;
  snapshot?: VaultSnapshot; intent?: SigningIntent; input?: TransactionInput;
  publicKey?: Hex; amount?: bigint; to?: Address; policy?: Policy;
};
type Ready = { review: Review; input: TransactionInput; quote: Quote; port: TransactionPort };
const usd = (value: bigint) => `${formatUnits(value, 6)} USDC`;
const date = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString();
const initialUrl = new URL(window.location.href);
const initialNetwork: Network = initialUrl.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'testnet';
const initialAddress = initialUrl.searchParams.get('vault');

function PolicySummary({ policy }: { policy: Policy }) {
  return <dl className="summary">
    <dt>Agent</dt><dd className="mono">{policy.agent}</dd>
    <dt>Session budget</dt><dd className="mono">{usd(policy.totalBudget)}</dd>
    <dt>Per payment cap</dt><dd className="mono">{usd(policy.perTxCap)}</dd>
    <dt>Expires</dt><dd>{date(policy.expiresAt)}</dd>
    <dt>Recipients</dt><dd>{policy.recipients.map((address) => <div className="mono" key={address}>{address}</div>)}</dd>
  </dl>;
}

export default function App() {
  const [network, setNetwork] = useState<Network>(initialNetwork);
  const [vault, setVault] = useState<Address | null>(initialAddress && isAddress(initialAddress) ? getAddress(initialAddress) : initialNetwork === 'testnet' ? getAddress(DEMO_VAULT) : null);
  const [vaultInput, setVaultInput] = useState(vault ?? '');
  const [vaultError, setVaultError] = useState('');
  const [mode, setMode] = useState<'read' | 'manage'>('read');
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletError, setWalletError] = useState('');
  const [busy, setBusy] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [signingMs, setSigningMs] = useState<number | null>(null);
  const [signingElapsed, setSigningElapsed] = useState(0);
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
  const selection = useRef({ network, vault });
  selection.current = { network, vault };
  const minBlock = useRef(new Map<string, bigint>());
  const activeOperation = useRef<string | null>(null);
  const checking = useRef(new Set<string>());
  const refreshLatest = useRef<(at?: bigint) => Promise<void>>(async () => {});

  function recordOperation(op: Operation) {
    try { setOperations(saveOperation(op)); }
    catch (error) { setHistoryError(errorMessage(error)); throw error; }
  }
  async function reconcileOperation(op: Operation, item?: Review) {
    if (!op.hash || checking.current.has(op.id)) return;
    checking.current.add(op.id);
    try {
      const receipt = await trackReceipt({ receipt: (hash) => operationReceipt(arcClient(op.network), op, hash) }, op.hash, (state) => {
        op = { ...op, stage: state.stage, hash: state.hash ?? op.hash, message: state.message };
        recordOperation(op);
        if (activeOperation.current === op.id) { setTransaction(state); setTransactionNetwork(op.network); }
      });
      if (receipt && item) await afterReceipt(item, receipt);
      if (receipt) recordOperation({ ...op, blockNumber: receipt.blockNumber.toString(), deployedVault: receipt.contractAddress ?? undefined });
      if (receipt && selection.current.network === op.network && selection.current.vault === op.vault) await refreshLatest.current(receipt.blockNumber);
    } catch (error) { setHistoryError(errorMessage(error)); }
    finally { checking.current.delete(op.id); }
  }
  useEffect(() => {
    try {
      const saved = loadOperations(); setOperations(saved);
      for (const op of saved) {
        const address = op.deployedVault ?? op.vault;
        if (address && op.blockNumber && /^[0-9]+$/.test(op.blockNumber)) {
          const key = `${op.network}:${address}`;
          const prior = minBlock.current.get(key) ?? 0n;
          if (BigInt(op.blockNumber) > prior) minBlock.current.set(key, BigInt(op.blockNumber));
        }
      }
      for (const op of saved.filter(unresolvedOperation)) void reconcileOperation(op);
    } catch (error) { setHistoryError(errorMessage(error)); }
    const sync = () => { try { setOperations(loadOperations()); } catch (error) { setHistoryError(errorMessage(error)); } };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const invalidate = useCallback(() => {
    epoch.current++;
    setSigningMs(null);
    setReview(null); setReady(null);
    setTransaction((state) => ['preparing', 'review', 'signing', 'simulating', 'ready'].includes(state.stage)
      ? { stage: 'cancelled', message: 'The form or context changed. Review the action again.' } : state);
  }, []);
  useEffect(() => {
    if (transaction.stage !== 'signing') return;
    const start = performance.now(); setSigningElapsed(0);
    const timer = setInterval(() => setSigningElapsed(performance.now() - start), 250);
    return () => clearInterval(timer);
  }, [transaction.stage]);
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
  refreshLatest.current = refresh;

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
      invalidate(); pq.lock(); setVault(next); setVaultError('');
      const url = new URL(window.location.href); url.searchParams.set('network', network); url.searchParams.set('vault', next);
      window.history.replaceState(null, '', url);
      if (next === vault) void refresh();
    } catch (error) { setVaultError(errorMessage(error)); }
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
    if (running.current || historyError || !account || !canSubmitOperation(action, network, account, vault ?? undefined, loadOperations())) return;
    activeOperation.current = null;
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
      const titles: Record<Action, string> = { deploy: 'Deploy a personal vault', fund: 'Fund the vault', start: next?.active ? 'Replace the spending session' : 'Open a spending session', 'owner-freeze': 'Lock out with owner wallet', 'pq-freeze': 'Lock out with PQ key', withdraw: 'Withdraw USDC' };
      const result: Review = { action, title: titles[action], network, account, epoch: ticket, snapshot: next, publicKey: pq.publicKey ?? undefined };
      if (action === 'deploy') {
        if (vault) throw new Error('Choose “New vault” before deploying');
        if (pq.phase !== 'restored' || !pq.publicKey) throw new Error('Restore your backup before deploying');
        result.input = { from: account, data: encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args: [account, pq.publicKey] }) };
      } else {
        if (!next) throw new Error('Open a vault first');
        if (!next.trusted) throw new Error('Vault runtime identity is unverified. Management and funding are disabled.');
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
        if (item.snapshot) {
          const identity = await currentVault(rpc, item.snapshot.address, item.network);
          if (!identity.trusted) throw new ContextChanged('Vault runtime identity changed or is unverified');
        }
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
        if (item.epoch === epoch.current) setSigningMs(signed.signingMs);
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
    void exclusive(async () => {
      if (!navigator.locks) throw new Error('This browser needs Web Locks support to safely submit wallet operations.');
      await navigator.locks.request('arcmandate-wallet-submit', { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Another tab is submitting a wallet action');
        const item = current.review;
        if (!canSubmitOperation(item.action, item.network, item.account, item.snapshot?.address, loadOperations())) throw new Error('Reconcile the existing operation first. For an emergency PQ freeze, connect a distinct funded relay wallet.');
        let op: Operation = { id: crypto.randomUUID(), network: item.network, action: item.action,
          ...operationFromInput(current.input), vault: item.snapshot?.address, stage: 'wallet', createdAt: new Date().toISOString(),
          sessionId: item.snapshot?.sessionId.toString(), nonce: item.snapshot?.nonce.toString(), amount: item.amount?.toString(),
          recipient: item.to, publicKey: item.publicKey };
        const port = { ...current.port, async send(input: TransactionInput, gas: bigint) {
          recordOperation(op); // Durable non-secret intent before requesting wallet submission.
          activeOperation.current = op.id;
          return current.port.send(input, gas);
        } };
        const hash = await broadcastTransaction(port, current.input, current.quote, (state) => {
          setTransaction(state);
          if (activeOperation.current === op.id) {
            op = { ...op, stage: state.stage, hash: state.hash ?? op.hash, message: state.message };
            recordOperation(op);
          }
        });
        if (hash) void reconcileOperation(op, item);
      });
    });
  }

  const unresolved = operations.some((op) => op.network === network && unresolvedOperation(op) && (op.account === account || op.vault === vault));
  const baseDisabled = busy || pq.busy || !canManage || !!historyError || !!readError || (!!vault && !snapshot?.trusted);
  const controlsDisabled = baseDisabled || unresolved;
  const freezeDisabled = baseDisabled || !account || !canSubmitOperation('pq-freeze', network, account, vault ?? undefined, operations);
  const transactionTone = ['simulation-rejected', 'wallet-rejected', 'reverted', 'unknown'].includes(transaction.stage) ? 'overload' : transaction.stage === 'confirmed' ? 'verified' : 'neutral';
  return <main>
    <a className="skip-link" href="#vault">Skip to vault</a>
    <header className="masthead"><a className="brand" href="#vault"><span className="brand-mark"><TechnicalIcon kind="orbit" /></span><span>ArcMandate<small>Agent spending control</small></span></a><div className="masthead-meta"><span>Arc / USDC</span><StatusBadge label={network === 'testnet' ? 'Testnet prototype' : 'Mainnet / read only'} /></div></header>
    <div className="workspace">
    <aside className="sidebar" aria-label="Workspace navigation"><nav><a className="nav-item" href="#vault"><span>01</span>Vault & session</a>{mode === 'manage' && <><a className="nav-item" href="#key-backup"><span>02</span>Authorization key</a><a className="nav-item" href="#controls"><span>03</span>Session controls</a></>}<a className="nav-item" href="#records"><span>04</span>Testnet records</a></nav><div className="sidebar-note"><TechnicalIcon /><p>Bounded authority.<br />Defined recipients.<br />Revocable sessions.</p><span className="plate-label">OWNER + PQ CONTROL</span></div></aside>
    <div className="workspace-content">
    <div className="page-heading"><div><h1>Your authority, anchored.</h1><p>A defined budget. A connected agent. Control stays with you.</p></div><span className="workspace-mode">{mode === 'read' ? 'Observer workspace' : 'Management workspace'}</span></div>
    <section className="panel connection" aria-label="Network and wallet">
      <div><label>Network<select aria-label="Network" value={network} onChange={(e) => { invalidate(); pq.lock(); setNetwork(e.target.value as Network); setVault(null); setVaultInput(''); setVaultError(''); setMode('read'); }}><option value="testnet">Arc Testnet</option><option value="mainnet">Arc Mainnet / read only</option></select></label>
        <p className="muted">Chain <span className="mono">{ARC_NETWORKS[network].chainId}</span></p></div>
      <div className="wallet-info">{account ? <><p className="mono">{account}</p><p>Wallet chain: <span className="mono">{walletChain}</span>{walletChain !== ARC_NETWORKS[network].chainId && <StatusBadge label="WRONG NETWORK" tone="overload" />}</p>
        {walletBalance !== null && <p>Wallet USDC available for gas: <span className="mono">{formatUnits(walletBalance, 18)}</span>. This is the native view of the same wallet USDC balance.</p>}
        <div className="actions"><button className="secondary" onClick={() => { connected.current = false; invalidate(); pq.lock(); setAccount(null); setWalletChain(null); }}>Disconnect</button>
          {walletChain !== ARC_NETWORKS[network].chainId && <button onClick={() => { if (provider) void switchNetwork(provider, network).then(connect).catch((error) => setWalletError(errorMessage(error))); }}>Switch wallet network</button>}</div></>
        : <><span className="plate-label">Owner wallet disconnected</span><p className="muted">Read the vault freely. Connect to manage authority.</p><button onClick={() => void connect()}>Connect wallet</button></>}</div>
      {walletError && <p className="error" role="alert">{walletError}</p>}
    </section>
    <section className="panel vault-panel" id="vault" aria-labelledby="vault-heading">
      <div className="section-heading"><h2 id="vault-heading">Vault & session</h2><StatusBadge label={mode === 'read' ? 'Read only' : 'Management'} /></div>
      <div className="vault-toolbar">
      <details className="vault-address-editor" open={!vault || !!vaultError}><summary>{vault ? 'Open another vault' : 'Open a vault by address'}</summary>
      <div className="address-row"><label>Vault address<input value={vaultInput} placeholder="0x…" aria-invalid={!!vaultError} aria-describedby={vaultError ? 'vault-error' : undefined} onChange={(e) => { invalidate(); setVaultError(''); setVaultInput(e.target.value); }} /></label><button onClick={openVault}>Open vault</button></div>
      {vaultError && <p className="error" id="vault-error" role="alert">{vaultError}</p>}
      </details>
      <div className="actions"><button className="secondary" disabled={network !== 'testnet'} onClick={() => { setVault(getAddress(DEMO_VAULT)); setVaultInput(DEMO_VAULT); setVaultError(''); setMode('read'); invalidate(); pq.lock(); }}>View demo</button>
        <button className="secondary" disabled={network !== 'testnet'} onClick={() => { invalidate(); pq.lock(); setMode(mode === 'read' ? 'manage' : 'read'); }}>{mode === 'read' ? 'Enter management mode' : 'Return to read only'}</button>
        {mode === 'manage' && <button className="secondary" disabled={busy} onClick={() => { invalidate(); pq.lock(); setVault(null); setVaultInput(''); setVaultError(''); }}>New vault</button>}
        {vault && <button className="secondary" disabled={reading} onClick={() => void refresh()}>Refresh state</button>}</div>
      </div>
      {readError && <p className="error" role="alert">Live state unavailable: {readError}</p>}
      {historyError && <p className="error" role="alert">Operation history unavailable: {historyError}. Reconcile wallet activity before submitting.</p>}
      {reading && !snapshot && <div className="loading-state" role="status"><TechnicalIcon /><p>Reading vault state…</p><span className="muted">Loading session limits and authorization register.</span></div>}
      {snapshot && <>
        <p className={snapshot.trusted ? 'muted' : 'warning'}>{snapshot.trusted ? 'Vault runtime and all immutable fields verified.' : 'Unverified contract: read only. Funding and management are disabled.'}</p>
        <div className="vault-serial"><span className="plate-label">Vault</span><a className="mono" href={`${ARC_NETWORKS[network].explorerUrl}/address/${snapshot.address}`} target="_blank" rel="noreferrer">{snapshot.address}</a></div>
        <SessionPlate snapshot={snapshot}
          onManage={mode === 'read' && network === 'testnet' ? () => { invalidate(); pq.lock(); setMode('manage'); } : undefined}
          onLockOut={mode === 'manage' ? () => prepare(ownerConnected ? 'owner-freeze' : 'pq-freeze') : undefined}
          lockDisabled={freezeDisabled || (!ownerConnected && !matchingKey)} />
      </>}
      {!vault && <div className="empty-state"><TechnicalIcon kind="plate" /><h3>NO VAULT SELECTED</h3><p>{mode === 'manage' ? 'Restore an authorization key below, then deploy a vault.' : 'Enter a vault address above or open the testnet demo.'}</p></div>}
      {network === 'mainnet' && <p>Mainnet management opens after the release checks are complete.</p>}
    </section>
    {mode === 'manage' && <>
      <KeyPanel key={`${network}:${vault}:${account}:${walletChain}`} pq={pq} expectedKey={snapshot?.publicKey} disabled={busy || (!!vault && !snapshot)} onChange={invalidate} />
      <div id="controls" className="controls-heading"><h2><span className="section-index">03</span>Session controls</h2><p className="muted">Each action requires review before wallet submission.</p>{!canManage && <p className="notice">Connect the owner wallet on Arc testnet to enable management controls.</p>}{canManage && vault && snapshot && !ownerConnected && <p className="notice">This wallet is not the vault owner. A matching PQ key can still authorize lock out.</p>}{canManage && !matchingKey && vault && <p className="notice">Restore the matching PQ backup to enable funding, session authorization and withdrawal.</p>}</div>
      {!vault ? <section className="panel"><h2>Create your vault</h2><p>Your connected wallet becomes the immutable owner. The restored PQ key becomes the second management key.</p><button disabled={controlsDisabled || pq.phase !== 'restored'} onClick={() => prepare('deploy')}>Review deployment</button></section> : <div className="management-grid">
        <section className="panel session-form"><h2>{snapshot?.active ? 'Replace session' : 'Open session'}</h2><p>Owner wallet + PQ approval. A new session replaces the previous authority and resets spent to zero.</p>
          <div className="fields">{(['agent', 'budget', 'cap', 'minutes'] as const).map((field) => <label key={field}>{({ agent: 'Agent wallet', budget: 'Session budget (USDC)', cap: 'Per payment cap (USDC)', minutes: 'Hold window (minutes)' })[field]}<input inputMode={field === 'agent' ? 'text' : field === 'minutes' ? 'numeric' : 'decimal'} value={sessionForm[field]} onChange={(e) => { invalidate(); setSessionForm((previous) => ({ ...previous, [field]: e.target.value })); }} /></label>)}</div>
          <label>Allowed recipients (1–5 addresses)<textarea value={sessionForm.recipients} placeholder="One address per line" onChange={(e) => { invalidate(); setSessionForm((previous) => ({ ...previous, recipients: e.target.value })); }} /></label>
          <button disabled={controlsDisabled || !ownerConnected || !matchingKey} onClick={() => prepare('start')}>{snapshot?.active ? 'Review replacement' : 'Review open session'}</button>
        </section>
        <section className="panel"><h2>Fund with USDC</h2><p>Funding adds balance without changing spending authority. Keep enough USDC in your wallet for network fees.</p><label>Funding amount (USDC)<input inputMode="decimal" value={fundAmount} onChange={(e) => { invalidate(); setFundAmount(e.target.value); }} /></label><button disabled={controlsDisabled || !matchingKey} onClick={() => prepare('fund')}>Review funding</button></section>
        <section className="panel lock-panel"><h2><TechnicalIcon kind="lock" />Lock out</h2><p>Either management key can revoke the session. Transfers ordered before freeze may still execute. Expired or exhausted sessions must also be frozen before withdrawal.</p>
          <div className="actions"><button className="danger" disabled={freezeDisabled || !ownerConnected || !snapshot?.active} onClick={() => prepare('owner-freeze')}>Review owner lock out</button><button className="danger" disabled={freezeDisabled || !matchingKey || !snapshot?.active} onClick={() => prepare('pq-freeze')}>Review PQ lock out</button></div>
          {unresolved && <p className="warning">A pending sender nonce can delay freeze. Connect a distinct funded relay wallet, restore the matching PQ backup, then review PQ lock out. Reconcile or cancel the original action in its wallet; funding remains protected against duplicate submission.</p>}
          <p className="muted">PQ freeze can be submitted by a wallet other than the owner.</p>
        </section>
        <section className="panel"><h2>Withdraw</h2><p>Requires the owner wallet, restored PQ key, and an inactive session.</p><div className="fields"><label>Withdrawal recipient<input value={withdrawTo} placeholder={account ?? '0x…'} onChange={(e) => { invalidate(); setWithdrawTo(e.target.value); }} /></label><label>Withdrawal amount (USDC)<input inputMode="decimal" value={withdrawAmount} onChange={(e) => { invalidate(); setWithdrawAmount(e.target.value); }} /></label></div>
          <button disabled={controlsDisabled || !ownerConnected || !matchingKey || !!snapshot?.active} onClick={() => prepare('withdraw')}>Review withdrawal</button>
        </section>
      </div>}
    </>}
    {(review || transaction.stage !== 'idle') && <section className="panel transaction" aria-label="Transaction review">
      <div className="section-heading"><h2>{review?.title ?? 'Transaction status'}</h2><StatusBadge label={transaction.stage.replaceAll('-', ' ').toUpperCase()} tone={transactionTone} /></div>
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
        <button className="secondary" onClick={() => { invalidate(); if (transaction.stage === 'signing') pq.lock(); }}>Cancel review</button>
      </>}
      <p role="status">{transaction.message}</p>
      {transaction.stage === 'signing' && signingMs === null && <p>Signing elapsed: {(signingElapsed / 1000).toFixed(1)} seconds.</p>}
      {signingMs !== null && <p>PQ signing took {(signingMs / 1000).toFixed(2)} seconds.</p>}
      {transaction.hash && <p className="mono"><a target="_blank" rel="noreferrer" href={`${ARC_NETWORKS[transactionNetwork].explorerUrl}/tx/${transaction.hash}`}>View transaction {transaction.hash}</a></p>}
    </section>}
    {snapshot && <RecentEvents key={`${network}:${snapshot.address}`} snapshot={snapshot} network={network} deploymentBlock={network === 'testnet' && snapshot.address.toLowerCase() === DEMO_VAULT.toLowerCase() ? BigInt(manifest.deploymentBlock) : (() => { const op = operations.find((op) => op.deployedVault?.toLowerCase() === snapshot.address.toLowerCase() && op.network === network); return op?.blockNumber ? BigInt(op.blockNumber) : undefined; })()} />}
    <section className="panel" aria-label="Saved wallet operations"><h2>Wallet operations</h2>
      {operations.filter((op) => op.network === network && (op.vault === vault || op.action === 'deploy')).slice(-30).reverse().map((op) => <div key={op.id}>
        <p>{op.action} · {op.stage} · {op.createdAt} {op.hash && <a href={`${ARC_NETWORKS[op.network].explorerUrl}/tx/${op.hash}`} target="_blank" rel="noreferrer">Transaction</a>}</p>
        {op.message && <p>{op.message}</p>}
        {unresolvedOperation(op) && op.hash && <button onClick={() => void reconcileOperation(op)}>Recheck saved receipt</button>}
        {unresolvedOperation(op) && !op.hash && <><p className="warning">Check this sender’s wallet activity. Attach the submitted hash, or explicitly attest the wallet never submitted this action.</p>
          <button onClick={() => { const hash = window.prompt('Submitted transaction hash from wallet activity'); if (hash && /^0x[0-9a-f]{64}$/i.test(hash)) { const next = { ...op, hash: hash as Hex, stage: 'submitted' as const }; recordOperation(next); void reconcileOperation(next); } }}>Attach transaction hash</button>
          <button className="secondary" onClick={() => { if (window.confirm('I checked this account on this chain and the wallet did not submit this action.')) recordOperation({ ...op, stage: 'cancelled', message: 'User reconciled wallet activity: not submitted.' }); }}>Wallet did not submit</button>
        </>}
      </div>)}
    </section>
    <section className="panel evidence" id="records"><div className="section-heading"><h2><span className="section-index">04</span>Historical demo records</h2><StatusBadge label="HISTORICAL" /></div><p>The recorded P2 demo funded its own vault with 1 USDC, paid twice, froze both sessions and withdrew 0.9 USDC. The demo vault was emptied. These are historical demo receipts, separate from the selected vault.</p>
      <details><summary>Transaction and simulation log <span className="record-count">{manifest.steps.length} records</span></summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Historical testnet records"><table><thead><tr><th>Step</th><th>Evidence</th><th>Result</th></tr></thead><tbody>{manifest.steps.map((step) => <tr key={step.label}><td>{step.label}</td><td>{step.txHash ? <a href={`${ARC_NETWORKS.testnet.explorerUrl}/tx/${step.txHash}`} target="_blank" rel="noreferrer">Mined receipt</a> : `Simulation at block ${step.block}`}</td><td><span className="log-result">{step.decodedError ?? step.receiptStatus}</span></td></tr>)}</tbody></table></div></details>
    </section>
    <footer><span>ArcMandate / Testnet prototype</span><p>No key recovery or rotation. PQ protects application authorization, not the wallet transaction or the whole network.</p></footer>
    </div></div>
  </main>;
}
