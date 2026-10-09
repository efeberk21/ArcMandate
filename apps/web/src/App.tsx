import { releaseNetwork, networkLabel } from './lib/release';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { encodeDeployData, encodeFunctionData, formatUnits, getAddress, isAddress, type Address, type Hex } from 'viem';
import { ARC_NETWORKS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi, vaultBytecode } from '@arcmandate/core/contracts';
import { addressInput, buildPolicy, usdcInput } from '@arcmandate/core/policy';
import { freezeDigest, startSessionDigest, withdrawDigest, type Policy } from '@arcmandate/core/digest';
import { KeyPanel } from './components/KeyPanel';
import { OperationRecovery } from './components/OperationRecovery';
import { RecentEvents } from './components/RecentEvents';
import { SessionPlate, StatusBadge, TechnicalIcon } from './components/SessionPlate';
import { arcClient, readVault, simulate, usdcAbi, type ArcClient, type Network, type VaultSnapshot } from './lib/chain';
import { assertWallet, ContextChanged, pendingWalletNonce, rememberWalletAccount, rememberWalletDisconnect, resumeWalletContext, sendWalletTransaction, switchNetwork, walletAccountPreference, walletContext } from './lib/wallet';
import { broadcastTransaction, errorMessage, prepareTransaction, trackReceipt, transactionStageLabels, type Quote, type Receipt, type TransactionInput, type TransactionPort, type TransactionState } from './lib/transactions';
import { canSubmitOperation, loadOperations, operationFromInput, operationReceipt, saveOperation, saveOperationLocked, pendingOperationsFor, validateOperationHash, unresolvedOperation, type Action, type Operation } from './lib/operations';
import { useVaultState, vaultIdentity } from './lib/use-vault-state';
import { usePqKey } from './lib/use-pq-key';
import { initialVaultSelection, latestAccountVault, rememberVaultSelection } from './lib/vault-selection';
import type { SigningIntent } from './worker/pq.worker';
import { capability, walletRole, type CapabilityState } from './lib/capabilities';
import { NextStepCard } from './components/NextStep';
import { TransactionDrawer } from './components/TransactionDrawer';
import { VaultLibrary } from './components/VaultLibrary';
import { AgentSetup } from './components/AgentSetup';
import { AgentConsole } from './components/AgentConsole';
import { Welcome } from './components/Welcome';
import { Starfield } from './components/Starfield';
import { BrandMark } from './components/BrandMark';
import { HistoryRecovery } from './components/HistoryRecovery';
import { PaymentDraftRecovery } from './components/PaymentDraftRecovery';
import { loadRegistry, mergeRegistry, updateRegistry, snapshotBookmark, migrateOperations, findDeployment, bookmarkId, registryJson, REGISTRY_KEY, type VaultBookmark } from './lib/vault-registry';
import { loadPaymentDrafts, savePaymentDraft, newPaymentDraft, validatePayment, type PaymentDraft } from './lib/payment-drafts';
import { downloadText } from './lib/files';
import { explainError } from './lib/errors';
import { diagnostic, DIAGNOSTIC_KEY } from './lib/diagnostics';
import { WorkspaceNav, type WorkspacePanel } from './components/WorkspaceNav';
import { SetupJourney } from './components/SetupJourney';
import { TransactionProgress } from './components/TransactionProgress';
import { AuthorizationNotice } from './components/AuthorizationNotice';

type Review = {
  action: Action; title: string; network: Network; account: Address; epoch: number;
  snapshot?: VaultSnapshot; intent?: SigningIntent; input?: TransactionInput;
  publicKey?: Hex; amount?: bigint; to?: Address; policy?: Policy;
  payment?: PaymentDraft;
};
type Ready = { review: Review; input: TransactionInput; quote: Quote; port: TransactionPort };
const usd = (value: bigint) => `${formatUnits(value, 6)} USDC`;
const date = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString();
const actionLabels: Record<Action, string> = { deploy: 'Vault creation', fund: 'Deposit', start: 'Spending session', 'owner-freeze': 'Freeze with owner', 'pq-freeze': 'Freeze with Vault Key', withdraw: 'Withdrawal', 'agent-gas': 'Agent network fees', 'agent-pay': 'Agent payment' };
const sendLabels: Record<Action, string> = { deploy: 'Create vault in wallet', fund: 'Send deposit in wallet', start: 'Open session in wallet', 'owner-freeze': 'Freeze session in wallet', 'pq-freeze': 'Freeze session in wallet', withdraw: 'Send withdrawal in wallet', 'agent-gas': 'Send agent gas in wallet', 'agent-pay': 'Send payment in wallet' };

function OperationSummary({ operation }: { operation: Operation }) {
  return <><dl className="summary"><dt>Sender wallet</dt><dd className="mono">{operation.account}</dd>
    {operation.action === 'deploy' ? <><dt>USDC transferred</dt><dd>0 USDC · vault creation only</dd>{operation.deployedVault && <><dt>Created vault</dt><dd className="mono">{operation.deployedVault}</dd></>}</>
      : <>{operation.vault && <><dt>Vault</dt><dd className="mono">{operation.vault}</dd></>}{operation.amount !== undefined && <><dt>USDC amount</dt><dd>{usd(BigInt(operation.amount))}</dd></>}{(operation.recipient || operation.action === 'fund') && <><dt>Recipient</dt><dd className="mono">{operation.recipient ?? operation.vault}</dd></>}</>}
  </dl><AuthorizationNotice operation={operation}/></>;
}

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
  const network: Network = releaseNetwork;
  const networkName = networkLabel(network);
  const [initialSelection] = useState(() => initialVaultSelection(new URL(window.location.href), localStorage, network));
  const [showWelcome,setShowWelcome] = useState(() => {const url=new URL(window.location.href);return !url.searchParams.has('vault')&&url.searchParams.get('setup')!=='1';});
  const [vault, setVault] = useState<Address | null>(initialSelection.address);
  const [vaultInput, setVaultInput] = useState(vault ?? '');
  const [vaultError, setVaultError] = useState('');
  const [panel,setPanel]=useState<'overview'|'agent'|'funds'|'key'|'activity'>(initialSelection.setup?'key':'overview');
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [agentView,setAgentView]=useState<'setup'|'limits'|'payment'>('setup');
  const [fundsView,setFundsView]=useState<'deposit'|'withdraw'|'gas'>('deposit');
  const [freezeOpen,setFreezeOpen]=useState(false);
  const [copyMessage,setCopyMessage]=useState('');
  const [vaultToolsOpen,setVaultToolsOpen]=useState(false);
  const [findOpen,setFindOpen]=useState(false);
  const [registry,setRegistry]=useState<VaultBookmark[]>([]);const [registryError,setRegistryError]=useState('');
  const [verifiedCreation,setVerifiedCreation]=useState<{address:Address;block:string}|null>(null);
  const [paymentDraft,setPaymentDraft]=useState<PaymentDraft|null>(null);const [draftError,setDraftError]=useState('');
  const [gasAmount,setGasAmount]=useState('');
  const newRequest=useRef<string|null>(null);const draftBaseline=useRef<string|undefined>(undefined);
  const [account, setAccount] = useState<Address | null>(null);
  const [authorizedAccounts, setAuthorizedAccounts] = useState<Address[]>([]);
  const preferredAccount = useRef<Address | null>(walletAccountPreference());
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletError, setWalletError] = useState('');
  const [walletChecking, setWalletChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [assetLoadError, setAssetLoadError] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [transaction, setTransaction] = useState<TransactionState>({ stage: 'idle', message: 'Review an action to begin.' });
  const [transactionNetwork, setTransactionNetwork] = useState<Network>(network);
  const [sessionForm, setSessionForm] = useState({ agent: '', budget: '', cap: '', minutes: '1440', recipients: '' });
  const [durationPreset, setDurationPreset] = useState('1440');
  const [fundAmount, setFundAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawTo, setWithdrawTo] = useState('');
  const pq = usePqKey();
  const provider = window.ethereum;
  const client = useMemo(() => arcClient(network), [network]);
  const epoch = useRef(0);
  const connected = useRef(false);
  const walletEpoch = useRef(0);
  const recoverSelection = useRef(initialSelection.recover);
  const running = useRef(false);
  const selection = useRef({ network, vault });
  selection.current = { network, vault };
  const walletSelection = useRef({ account, walletChain });
  walletSelection.current = { account, walletChain };
  const verifiedDeployment = useRef<{ address: Address; account: Address; publicKey: Hex } | null>(null);
  const minBlock = useRef(new Map<string, bigint>());
  const { snapshot, readError, reading, refresh, acceptSnapshot } = useVaultState(client, network, vault, minBlock.current);
  const [walletRequestOpen, setWalletRequestOpen] = useState(false);
  const activeOperation = useRef<string | null>(null);
  const checking = useRef(new Set<string>());
  const refreshLatest = useRef<(at?: bigint) => Promise<void>>(async () => {});
  refreshLatest.current = refresh;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('network') && url.searchParams.get('network') !== network) url.searchParams.delete('vault');
    url.searchParams.set('network', network);
    if (initialSelection.address) { if(!showWelcome)url.searchParams.set('vault', initialSelection.address); rememberVaultSelection(initialSelection.address,localStorage,network); }
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(()=>{
    diagnostic('page-load');const hide=()=>diagnostic('page-hide');window.addEventListener('pagehide',hide);
    if(import.meta.hot) import.meta.hot.on('vite:beforeUpdate',()=>diagnostic('hmr'));
    return()=>window.removeEventListener('pagehide',hide);
  },[]);
  useEffect(()=>{
    const sync=()=>{try{setRegistry(loadRegistry());setRegistryError('');}catch(cause){setRegistryError(errorMessage(cause));}};
    sync();window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  useEffect(()=>{
    if(!operations.length)return;
    void updateRegistry(storage=>migrateOperations(operations,storage)).then(setRegistry).catch(cause=>setRegistryError(errorMessage(cause)));
  },[operations]);
  useEffect(()=>{
    if(!snapshot||readError)return;
    const deployment=operations.find(op=>op.network===network&&op.action==='deploy'&&op.stage==='confirmed'&&op.deployedVault?.toLowerCase()===snapshot.address.toLowerCase());
    void updateRegistry(storage=>mergeRegistry([snapshotBookmark(snapshot,deployment)],storage)).then(setRegistry).catch(cause=>setRegistryError(errorMessage(cause)));
  },[snapshot,readError]);
  useEffect(()=>{
    setPaymentDraft(null);setVerifiedCreation(null);
    newRequest.current=null;
    try{const saved=loadPaymentDrafts().filter(d=>d.chainId===ARC_NETWORKS[network].chainId&&d.vault.toLowerCase()===vault?.toLowerCase()&&d.account.toLowerCase()===account?.toLowerCase());setPaymentDraft(saved.at(-1)??null);draftBaseline.current=saved.at(-1)?.requestId;setDraftError('');}catch(cause){setDraftError(errorMessage(cause));}
  },[vault,account]);
  async function changeRegistry(items:VaultBookmark[],remove?:string,editLabel=false){
    const next=await updateRegistry(storage=>{
      if(remove){const kept=loadRegistry(storage).filter(item=>bookmarkId(item)!==remove);storage.setItem(REGISTRY_KEY,registryJson(kept));return kept;}
      return mergeRegistry(items,storage,editLabel);
    });setRegistry(next);setRegistryError('');
  }
  async function locateCreation(hash:Hex){
    const found=await findDeployment(client,hash);
    const bookmark={...snapshotBookmark(found.snapshot),deploymentHash:hash,deploymentBlock:found.block.toString(),source:'deployment' as const};
    await changeRegistry([bookmark]);selectVault(found.snapshot.address);setPanel('overview');setVerifiedCreation({address:found.snapshot.address,block:found.block.toString()});
  }
  useEffect(()=>{
    if(!snapshot||!snapshot.trusted)return;
    const card=registry.find(item=>item.chainId===ARC_NETWORKS[network].chainId&&item.address.toLowerCase()===snapshot.address.toLowerCase()&&item.deploymentHash);
    if(!card?.deploymentHash)return;
    let current=true;void findDeployment(client,card.deploymentHash).then(found=>{if(current&&found.snapshot.address.toLowerCase()===snapshot.address.toLowerCase())setVerifiedCreation({address:snapshot.address,block:found.block.toString()});}).catch(()=>{});
    return()=>{current=false;};
  },[snapshot?.address,registry.find(item=>item.chainId===ARC_NETWORKS[network].chainId&&item.address.toLowerCase()===vault?.toLowerCase())?.deploymentHash]);

  useEffect(() => {
    // Keep the error propagating to transaction handling; never reload or retry a wallet action automatically.
    const updateRequired = () => { diagnostic('asset-error'); setAssetLoadError(true); };
    window.addEventListener('vite:preloadError', updateRequired);
    return () => window.removeEventListener('vite:preloadError', updateRequired);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pq.phase !== 'locked' || walletRequestOpen || operations.some(unresolvedOperation)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pq.phase, walletRequestOpen, operations]);

  async function recordOperation(op: Operation) {
    try { setOperations(await saveOperationLocked(op)); }
    catch (error) { setHistoryError(errorMessage(error)); throw error; }
  }
  async function attachOperationHash(op: Operation, hash: Hex) {
    if (!navigator.locks) throw new Error('Web Locks are required for safe reconciliation.');
    let verified: Operation | undefined;
    await navigator.locks.request('arcmandate-wallet-submit', { ifAvailable: true }, async lock => {
      if (!lock || walletRequestOpen) throw new Error('A wallet submission is still open. Finish it before attaching a hash.');
      const latest = loadOperations().find(item => item.id === op.id);
      if (!latest || !unresolvedOperation(latest) || latest.hash) throw new Error('This operation changed. Refresh its status before attaching a hash.');
      verified = await validateOperationHash(arcClient(op.network), latest, hash);
      await recordOperation(verified);
    });
    if (verified) await reconcileOperation(verified);
  }
  async function acknowledgeNotSubmitted(op: Operation) {
    if (!navigator.locks) throw new Error('Web Locks are required for safe reconciliation.');
    await navigator.locks.request('arcmandate-wallet-submit', { ifAvailable: true }, async lock => {
      if (!lock || walletRequestOpen) throw new Error('A wallet submission is still open in this or another tab. Finish it in your wallet first.');
      await navigator.locks.request('arcmandate-operation-history', async () => {
        const latest = loadOperations().find(item => item.id === op.id);
        if (!latest || latest.hash || !unresolvedOperation(latest)) throw new Error('This operation changed. Recheck its saved receipt.');
        // Submission and journal locks cover the read/attest/write together.
        setOperations(saveOperation({ ...latest, stage: 'cancelled', message: 'User checked wallet activity and attested no transaction was sent. No onchain cancellation was performed.' }));
      });
    });
  }
  async function reconcileOperation(op: Operation, item?: Review) {
    if (!op.hash || checking.current.has(op.id)) return;
    checking.current.add(op.id);
    try {
      const receipt = await trackReceipt({ receipt: (hash) => operationReceipt(arcClient(op.network), op, hash) }, op.hash, async (state, result) => {
        op = { ...op, stage: state.stage, hash: state.hash ?? op.hash, message: state.message,
          ...(result ? { blockNumber: result.blockNumber.toString(), deployedVault: state.stage === 'confirmed' ? result.contractAddress ?? op.deployedVault : op.deployedVault } : {}) };
        await recordOperation(op);
        if (activeOperation.current === op.id) { setTransaction(state); setTransactionNetwork(op.network); }
      });
      if (receipt && item) await afterReceipt(item, receipt);
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
          const key = vaultIdentity(op.network, address);
          const prior = minBlock.current.get(key) ?? 0n;
          if (BigInt(op.blockNumber) > prior) minBlock.current.set(key, BigInt(op.blockNumber));
        }
      }
      for (const op of saved.filter(op => unresolvedOperation(op) || (op.action === 'deploy' && op.stage === 'confirmed' && (!op.deployedVault || !op.blockNumber)))) void reconcileOperation(op);
    } catch (error) { setHistoryError(errorMessage(error)); }
    const sync = () => { try { setOperations(loadOperations()); } catch (error) { setHistoryError(errorMessage(error)); } };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const invalidate = useCallback(() => {
    epoch.current++;
    setReview(null); setReady(null);
    setTransaction((state) => ['preparing', 'review', 'signing', 'simulating', 'ready'].includes(state.stage)
      ? { stage: 'cancelled', message: 'The form or context changed. Review the action again.' } : state);
  }, []);
  useEffect(()=>{invalidate();},[pq.lockVersion,invalidate]);
  const prevContext = useRef({ vault, account, walletChain });
  useEffect(() => {
    invalidate();
    const prev = prevContext.current;
    prevContext.current = { vault, account, walletChain };
    if (account !== prev.account) pq.lock('you switched wallet account');
    else if (walletChain !== prev.walletChain) pq.lock('you switched wallet network');
    else if (vault !== prev.vault) {
      const deployment = verifiedDeployment.current;
      verifiedDeployment.current = null;
      const ownDeployment = prev.vault === null && deployment && vault === deployment.address &&
        account === deployment.account && pq.publicKey?.toLowerCase() === deployment.publicKey.toLowerCase() && pq.phase === 'restored';
      if (!ownDeployment) pq.lock('you switched vault');
    }
  }, [network, vault, account, walletChain, invalidate, pq.lock]);

  useEffect(() => {
    let current = true;
    setWalletBalance(null);
    if (account) void client.getBalance({ address: account }).then((value) => { if (current) setWalletBalance(value); }).catch(() => {});
    return () => { current = false; };
  }, [account, client, transaction.stage]);

  useEffect(() => {
    if (!provider) return;
    let mounted = true;
    const ticket = ++walletEpoch.current;
    void resumeWalletContext(provider).then((next) => {
      if (!mounted || ticket !== walletEpoch.current || !next) return;
      connected.current = true; setAuthorizedAccounts(next.accounts); setAccount(next.account); setWalletChain(next.chainId);
    }).catch(() => { /* A locked or unavailable wallet can still be connected manually. */ });
    const changed = (kind: 'account' | 'chain', payload: unknown) => {
      diagnostic(kind==='account'?'wallet-account':'wallet-chain');
      let unchanged = false;
      try {
        unchanged = kind === 'account' ? Array.isArray(payload) &&
          (payload.length === 0 ? walletSelection.current.account === null : preferredAccount.current ? payload.some(value => getAddress(String(value)) === preferredAccount.current) : getAddress(String(payload[0])) === walletSelection.current.account)
          : typeof payload === 'string' && Number(BigInt(payload)) === walletSelection.current.walletChain;
      } catch { /* Malformed events invalidate authorization until a fresh provider read. */ }
      if (!unchanged) { invalidate(); pq.lock(kind === 'account' ? 'your wallet account changed' : 'your wallet network changed'); }
      setWalletChecking(true);
      const update = ++walletEpoch.current;
      const wasConnected = connected.current;
      const lookup = wasConnected ? walletContext(provider, preferredAccount.current) : resumeWalletContext(provider);
      void lookup.then((next) => {
        if (!mounted || update !== walletEpoch.current) return;
        if (!next) { setWalletChecking(false); return; }
        connected.current = !!next.account; setAuthorizedAccounts(next.accounts); setAccount(next.account); setWalletChain(next.chainId);
        setWalletChecking(false);
      }).catch((error) => { if (mounted && update === walletEpoch.current) {
        invalidate(); pq.lock('the wallet context could not be verified'); setWalletChecking(false);
        if (wasConnected) { connected.current = false; setAuthorizedAccounts([]); setWalletError(errorMessage(error)); setAccount(null); setWalletChain(null); }
      } });
    };
    const accountsChanged = (payload: unknown) => changed('account', payload);
    const chainChanged = (payload: unknown) => changed('chain', payload);
    const disconnected = () => { diagnostic('wallet-disconnect'); invalidate(); pq.lock('your wallet disconnected'); walletEpoch.current++; connected.current = false; setAuthorizedAccounts([]); setAccount(null); setWalletChain(null); setWalletChecking(false); };
    provider.on?.('accountsChanged', accountsChanged); provider.on?.('chainChanged', chainChanged); provider.on?.('disconnect', disconnected);
    return () => {
      mounted = false; walletEpoch.current++;
      provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected);
    };
  }, [provider, invalidate, pq.lock]);

  async function connect() {
    walletEpoch.current++;
    try {
      if (!provider) throw new Error('Open this page in a browser with an EVM wallet extension.');
      await provider.request({ method: 'eth_requestAccounts' });
      const ticket = ++walletEpoch.current;
      const next = await walletContext(provider, preferredAccount.current);
      if (ticket !== walletEpoch.current) return;
      rememberWalletDisconnect(false);
      connected.current = !!next.account; setAuthorizedAccounts(next.accounts); setAccount(next.account); setWalletChain(next.chainId); setWalletChecking(false); setWalletError(next.account ? '' : 'Choose an account currently authorized by your wallet.');
    } catch (error) { setWalletError(errorMessage(error)); }
  }

  async function chooseWalletAccount(value: string) {
    if (!provider || busy || walletRequestOpen || walletChecking) return;
    invalidate(); pq.lock('you selected another connected account');
    const ticket = ++walletEpoch.current;
    setWalletChecking(true);
    try {
      const selected = getAddress(value), next = await walletContext(provider, selected);
      if (ticket !== walletEpoch.current) return;
      setAuthorizedAccounts(next.accounts);
      if (!next.account) throw new ContextChanged('This account is no longer authorized. Select it in your wallet connection permissions.');
      preferredAccount.current = selected; rememberWalletAccount(selected); rememberWalletDisconnect(false);
      connected.current = true; setAccount(selected); setWalletChain(next.chainId); setWalletError('');
    } catch (cause) {
      if (ticket !== walletEpoch.current) return;
      connected.current = false; setAccount(null); setWalletChain(null); setWalletError(errorMessage(cause));
    } finally { if (ticket === walletEpoch.current) setWalletChecking(false); }
  }

  function openVault() {
    try {
      if(/^0x[0-9a-f]{64}$/i.test(vaultInput.trim()))throw new Error('This is 66 characters: a transaction hash or public key, not a vault address. Use Find vault from its creation transaction for a deployment hash.');
      const next = addressInput(vaultInput, 'Vault');
      selectVault(next);
    } catch (error) { setVaultError(errorMessage(error)); }
  }

  function selectVault(next: Address) {
    recoverSelection.current = false; rememberVaultSelection(next,localStorage,network);
    invalidate(); setVault(next); setVaultInput(next); setVaultError('');
    const url = new URL(window.location.href); url.searchParams.set('network', network); url.searchParams.delete('setup'); if(!showWelcome)url.searchParams.set('vault', next);
    window.history.replaceState(null, '', url);
    if (next === vault) void refresh();
  }

  function newVault() {
    setShowWelcome(false);
    recoverSelection.current = false; rememberVaultSelection(null,localStorage,network);
    invalidate();
    setVault(null); setVaultInput(''); setVaultError(''); go('key');
    const url = new URL(window.location.href);
    url.searchParams.set('network', network); url.searchParams.set('setup','1'); url.searchParams.delete('vault'); url.hash = '';
    window.history.replaceState(null, '', url);
  }

  useEffect(() => {
    if (!account || vault || !recoverSelection.current) return;
    const saved = latestAccountVault(operations, account, network);
    if (saved) selectVault(saved);
  }, [account, vault, operations]);

  async function exclusive(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await task(); }
    catch (error) {
      setTransaction(state => state.hash || state.stage === 'wallet' || state.stage === 'submitted'
        ? { ...state, stage: 'unknown', message: `${errorMessage(error)} Check wallet activity before trying this action again.` }
        : { stage: 'cancelled', message: errorMessage(error) });
    }
    finally { running.current = false; setBusy(false); }
  }

  const canManage = !walletChecking && !!account && walletChain === ARC_NETWORKS[network].chainId;
  const capabilities:CapabilityState={network,account,walletChain,provider:!!provider,vault,snapshot,readError,checking:walletChecking,phase:pq.phase,publicKey:pq.publicKey,
    operations,historyError:historyError||draftError,busy,keyBusy:pq.busy,assetsUnavailable:assetLoadError,locksAvailable:!!navigator.locks};
  useEffect(()=>{setSessionForm({agent:'',budget:'',cap:'',minutes:'1440',recipients:''});setDurationPreset('1440');setFundAmount('');setWithdrawAmount('');setWithdrawTo('');setGasAmount('');setAgentView('setup');setFundsView('deposit');setFreezeOpen(false);setCopyMessage('');},[vault]);
  useEffect(()=>{if(snapshot?.active){setAgentView('payment');setSessionForm(previous=>({...previous,agent:snapshot.policy.agent,budget:formatUnits(snapshot.policy.totalBudget,6),cap:formatUnits(snapshot.policy.perTxCap,6),recipients:snapshot.policy.recipients.join('\n')}));}},[snapshot?.address]);
  const ownerConnected = !!snapshot && account === getAddress(snapshot.owner);

  async function currentVault(rpc: ArcClient, address: Address, net: Network) {
    const head = await rpc.getBlockNumber({ cacheTime: 0 });
    const minimum = minBlock.current.get(vaultIdentity(net, address));
    return readVault(rpc, address, minimum && head < minimum ? minimum : head);
  }

  function prepare(action: Action, payment?: {recipient:string;amount:string}) {
    if (running.current) return;
    activeOperation.current = null;
    invalidate();
    setDrawerOpen(true);
    const ticket = epoch.current;
    void exclusive(async () => {
      const gate=capability(action,{...capabilities,operations:loadOperations()});
      if(!gate.allowed)throw new Error(gate.reasons.join(' '));
      if (!canManage || !account || !provider) throw new Error(`Connect your wallet on ${networkName} to continue.`);
      setTransaction({ stage: 'preparing', message: 'Reading current chain authorization…' });
      await assertWallet(provider, account, ARC_NETWORKS[network].chainId);
      if (await client.getChainId() !== ARC_NETWORKS[network].chainId) throw new Error('RPC network mismatch');
      const next = vault ? await currentVault(client, vault, network) : undefined;
      if (ticket !== epoch.current) throw new ContextChanged('Context changed during preparation');
      if (next) acceptSnapshot(next);
      const freshGate=capability(action,{...capabilities,snapshot:next??null,readError:'',operations:loadOperations()});
      if(!freshGate.allowed)throw new Error(freshGate.reasons.join(' '));
      const titles: Record<Action, string> = { deploy: 'Create an empty vault', fund: 'Deposit into the vault', start: next?.active ? 'Replace the spending session' : 'Open a spending session', 'owner-freeze': 'Freeze with owner wallet', 'pq-freeze': 'Freeze with Vault Key', withdraw: 'Withdraw USDC', 'agent-gas':'Transfer network-fee funds to agent', 'agent-pay':'Make an agent payment' };
      const result: Review = { action, title: titles[action], network, account, epoch: ticket, snapshot: next, publicKey: pq.publicKey ?? undefined };
      if (action === 'deploy') {
        if (vault) throw new Error('Choose “Create another vault” before creating a vault');
        if (pq.phase !== 'restored' || !pq.publicKey) throw new Error('Restore your backup before deploying');
        result.input = { from: account, data: encodeDeployData({ abi: vaultAbi, bytecode: vaultBytecode, args: [account, pq.publicKey] }) };
      } else {
        if (!next) throw new Error('Open a vault first');
        if (!next.trusted) throw new Error('Vault runtime identity is unverified. Management and funding are disabled.');
        if (!['pq-freeze','fund','agent-pay'].includes(action) && getAddress(next.owner) !== account) throw new Error('This action requires the vault owner wallet');
        if (!['owner-freeze','agent-pay','agent-gas'].includes(action) && (pq.phase !== 'restored' || pq.publicKey?.toLowerCase() !== next.publicKey.toLowerCase())) throw new Error('Restore a backup matching this vault’s PQ key');
        const context = { chainId: BigInt(ARC_NETWORKS[network].chainId), vault: next.address, owner: next.owner };
        const auth = { nonce: next.nonce, sessionId: next.sessionId, deadline: next.timestamp + 600n };
        if(action==='agent-pay'){
          if(!payment)throw new Error('Choose a recipient and amount.');
          const recipient=addressInput(payment.recipient,'Payment recipient'),amount=usdcInput(payment.amount);
          let draft=paymentDraft;
          if(!draft){
            if(!navigator.locks)throw new Error('Web Locks are required to save a payment request.');
            await navigator.locks.request('arcmandate-payment-drafts',()=>{
              const existing=loadPaymentDrafts().filter(d=>d.chainId===ARC_NETWORKS[network].chainId&&d.vault.toLowerCase()===next.address.toLowerCase()&&d.account.toLowerCase()===account.toLowerCase());
              if(existing.at(-1)?.requestId!==draftBaseline.current)throw new Error('A saved payment request changed in another tab. Reload it before paying.');
              draft=newPaymentDraft(next,account,recipient,amount); if(newRequest.current)draft.requestId=newRequest.current;
              validatePayment(next,draft,loadOperations());
              savePaymentDraft(draft);setPaymentDraft(draft);draftBaseline.current=draft.requestId;newRequest.current=null;
            });
          }
          if(!draft||draft.recipient.toLowerCase()!==recipient.toLowerCase()||BigInt(draft.amount)!==amount)throw new Error('Retry must keep the original recipient and amount. Explicitly start a different payment request for another intent.');
          validatePayment(next,draft,loadOperations());
          if(await client.readContract({address:next.address,abi:vaultAbi,functionName:'usedPaymentIds',args:[BigInt(draft.sessionId),draft.paymentId]}))throw new Error('PaymentAlreadyUsed: check the original payment receipt.');
          result.payment=draft;result.amount=amount;result.to=recipient;
          result.input={from:account,to:next.address,data:encodeFunctionData({abi:vaultAbi,functionName:'agentPay',args:[BigInt(draft.sessionId),draft.paymentId,recipient,amount]})};
        } else if(action==='agent-gas'){
          result.to=addressInput(sessionForm.agent,'Agent');result.amount=usdcInput(gasAmount);
          if(result.to===next.owner||result.to===next.address)throw new Error('Agent network fees must go to a separate agent account.');
          result.input={from:account,to:USDC_ADDRESS,data:encodeFunctionData({abi:usdcAbi,functionName:'transfer',args:[result.to,result.amount]})};
        } else if (action === 'fund') {
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
      if (!result.intent) await authorizeReview(result);
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
          const minimum = minBlock.current.get(vaultIdentity(item.network,item.snapshot.address));
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
        if(item.snapshot&&item.payment){
          const live=await currentVault(rpc,item.snapshot.address,item.network);validatePayment(live,item.payment,loadOperations());
          if(await rpc.readContract({address:live.address,abi:vaultAbi,functionName:'usedPaymentIds',args:[BigInt(item.payment.sessionId),item.payment.paymentId]}))throw new ContextChanged('PaymentAlreadyUsed. Reconcile the original payment.');
        }
        if (item.epoch !== epoch.current) throw new ContextChanged('Context changed while reading the chain');
      },
      simulate: (input) => simulate(rpc, input),
      async quote(input) {
        const [estimate, gasPrice] = await Promise.all([rpc.estimateGas({ account: input.from, to: input.to, data: input.data }), rpc.getGasPrice()]);
        const gas=(estimate*120n+99n)/100n;
        const balance=await rpc.getBalance({address:input.from});
        const transfer=['fund','agent-gas'].includes(item.action)?(item.amount??0n)*10n**12n:0n;
        if(balance<transfer+gas*gasPrice)throw new Error('The sender needs enough USDC for this transfer plus the buffered network fee.');
        return { gas, gasPrice };
      },
      send: (input, gas) => sendWalletTransaction(provider!, { ...input, gas, chainId: ARC_NETWORKS[item.network].chainId }),
      receipt: (hash) => rpc.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1500 }),
    };
  }

  function approve() {
    if (!review) return;
    const item = review;
    void exclusive(() => authorizeReview(item));
  }

  async function authorizeReview(item: Review) {
    const rpc = arcClient(item.network);
    const port = portFor(item, rpc);
    await port.assertContext();
    let input = item.input;
    if (item.intent) {
      setTransaction({ stage: 'signing', message: 'Authorizing this action with your Vault Key…' });
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
  }

  async function afterReceipt(item: Review, receipt: Receipt) {
    if (receipt.status !== 'success') return;
    if (item.action === 'deploy' && receipt.contractAddress) {
      if (selection.current.network === item.network && selection.current.vault === null) {
        if (receipt.effectVerified === true && item.publicKey && pq.phase === 'restored' && pq.publicKey === item.publicKey && account === item.account) {
          verifiedDeployment.current = { address: getAddress(receipt.contractAddress), account: item.account, publicKey: item.publicKey };
        }
        minBlock.current.set(vaultIdentity(item.network, getAddress(receipt.contractAddress)), receipt.blockNumber);
        recoverSelection.current = false; rememberVaultSelection(getAddress(receipt.contractAddress),localStorage,network);
        setVault(getAddress(receipt.contractAddress)); setVaultInput(getAddress(receipt.contractAddress));
        const url = new URL(window.location.href);
        url.searchParams.set('network', item.network); url.searchParams.set('vault', receipt.contractAddress);
        window.history.replaceState(null, '', url);
      }
    } else if (item.snapshot && selection.current.network === item.network && selection.current.vault === item.snapshot.address) {
      minBlock.current.set(vaultIdentity(item.network, item.snapshot.address), receipt.blockNumber);
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
          recipient: item.to, publicKey: item.publicKey, authorizationDeadline: item.intent?.auth.deadline.toString() };
        if(item.payment)op={...op,requestId:item.payment.requestId,paymentId:item.payment.paymentId};
        const port = { ...current.port, async send(input: TransactionInput, gas: bigint) {
          const walletNonce = await pendingWalletNonce(provider!, item.account);
          op = { ...op, walletNonce };
          await recordOperation(op); // Durable non-secret intent before requesting wallet submission.
          activeOperation.current = op.id;
          setWalletRequestOpen(true);
          try { return await current.port.send({ ...input, walletNonce }, gas); }
          finally { setWalletRequestOpen(false); }
        } };
        const hash = await broadcastTransaction(port, current.input, current.quote, async (state) => {
          setTransaction(state);
          if (activeOperation.current === op.id) {
            op = { ...op, stage: state.stage, hash: state.hash ?? op.hash, originalHash: op.originalHash ?? state.hash, message: state.message };
            await recordOperation(op);
          }
        });
        if (hash) void reconcileOperation(op, item);
      });
    });
  }

  const pendingOperations = pendingOperationsFor(network, account, vault, operations);
  const unresolved = pendingOperations.length > 0;
  const selectedOperations = operations.filter(op => op.network === network && ((vault && (op.vault?.toLowerCase() === vault.toLowerCase() || op.deployedVault?.toLowerCase() === vault.toLowerCase())) || (account && op.account.toLowerCase() === account.toLowerCase()))).slice(-50).reverse();
  const displayedOperation = operations.find(op => op.id === activeOperation.current);
  const selectedCard = registry.find(item => item.chainId === ARC_NETWORKS[network].chainId && item.address.toLowerCase() === vault?.toLowerCase());
  const transactionTone = ['simulation-rejected','wallet-rejected','reverted','unknown'].includes(transaction.stage) ? 'overload' : transaction.stage === 'confirmed' ? 'verified' : 'neutral';
  function go(next: typeof panel, targetId = 'workspace-content') {
    setShowWelcome(false); setPanel(next);
    requestAnimationFrame(() => {
      // Retain arrow-key navigation without focus pulling the page back to the menu.
      document.getElementById(`tab-${next}`)?.focus({ preventScroll: true });
      document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  }
  function openWelcome() {
    setShowWelcome(true);setDrawerOpen(false);
    const url=new URL(window.location.href);url.searchParams.delete('vault');url.searchParams.delete('setup');url.hash='';window.history.replaceState(null,'',url);
    requestAnimationFrame(()=>document.getElementById('welcome-heading')?.focus());
  }
  function continueWorkspace() {
    if(vault){const url=new URL(window.location.href);url.searchParams.set('vault',vault);window.history.replaceState(null,'',url);}
    go(unresolved?'activity':'overview');
  }
  function nextAction(id:string) {
    if(id==='connect'){if(provider)void connect();else {const menu=document.getElementById('wallet-menu') as HTMLDetailsElement|null;if(menu){menu.open=true;menu.querySelector('summary')?.focus();}}}
    else if(id==='switch' && provider)void switchNetwork(provider,network).then(connect).catch(cause=>setWalletError(errorMessage(cause)));
    else if(id==='refresh')void refresh();
    else if(id==='deploy')prepare('deploy');
    else if(id==='diagnostics')exportDetails();
    else if(id==='pending')go('activity','pending-operations');
    else if(id==='freeze'){setFreezeOpen(true);requestAnimationFrame(()=>document.getElementById('freeze-session')?.scrollIntoView({block:'center',behavior:'smooth'}));}
    else if(id==='session'){setAgentView('limits');go('agent');}
    else if(id==='fund'){setFundsView('deposit');go('funds');}
    else if(id==='agent'){setAgentView(snapshot?.active?'payment':'setup');go('agent');}
    else go('key');
  }
  function exportDetails() {
    downloadText('arcmandate-public-diagnostics.json',JSON.stringify({chainId:ARC_NETWORKS[network].chainId,address:vault,owner:snapshot?.owner,publicKey:snapshot?.publicKey,trusted:snapshot?.trusted,block:snapshot?.blockNumber.toString(),readError, lifecycle:JSON.parse(sessionStorage.getItem(DIAGNOSTIC_KEY)??'[]'),note:'Public diagnostic metadata only. Not an encrypted Vault Key backup.'},null,2));
  }
  function formError(action:Action):string {
    try {
      if(action==='start' && snapshot)buildPolicy(sessionForm,snapshot.owner,snapshot.address,snapshot.timestamp);
      if(action==='fund')usdcInput(fundAmount);
      if(action==='agent-gas' && snapshot){const target=addressInput(sessionForm.agent,'Agent');if(target===getAddress(snapshot.owner)||target===getAddress(snapshot.address))throw new Error('Use a separate agent account.');usdcInput(gasAmount);}
      if(action==='withdraw'){addressInput(withdrawTo,'Withdrawal recipient');usdcInput(withdrawAmount);}
    }catch(cause){return errorMessage(cause);}return '';
  }
  function actionButton(action:Action,label:string) {
    const gate=capability(action,capabilities);const invalid=formError(action);const reasons=[...gate.reasons,...(invalid?[invalid]:[])];
    const fixes={connect:'Connect the required wallet',switch:`Switch to ${networkName}`,refresh:'Refresh vault state',key:'Unlock Vault Key',pending:'Check pending operations',session:'Review session options'};
    return <div className="action-control"><button className={action.includes('freeze')?'danger':undefined} disabled={reasons.length>0} onClick={()=>prepare(action)}>{label}</button>
      {!!reasons.length&&<div className="action-reasons"><p>{reasons[0]}</p>{gate.fix&&<button className="text-button" onClick={()=>{if(gate.fix)nextAction(gate.fix);}}>{fixes[gate.fix]}</button>}{reasons.length>1&&<details><summary>All requirements ({reasons.length})</summary><ul>{reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}</div>}</div>;
  }
  const consoleGate=capability('agent-pay',capabilities);
  const recipients=sessionForm.recipients.split(/[\s,]+/).filter(Boolean);
  const recipientRows=sessionForm.recipients.split('\n');
  const pageTitles:Record<WorkspacePanel,{title:string;description:string}>={overview:{title:vault?(selectedCard?.label||'Your vault'):'Create your first vault',description:vault?'Your money, spending limits and next step in one place.':'Keep USDC in your own vault. Give a separate agent a spending budget.'},agent:{title:'Agent & spending',description:'Prepare an agent, choose its limits, then make a payment.'},funds:{title:'Move your funds',description:'Choose where the money goes. Every transfer is reviewed before your wallet opens.'},key:{title:'Secure your Vault Key',description:'Your second management key. Keep its encrypted backup and password.'},activity:{title:'Activity & recovery',description:'Track what happened and resolve transactions with an uncertain outcome.'}};
  return <><Starfield/><main>
    <a className="skip-link" href={showWelcome?'#welcome-heading':'#workspace-tabs'}>{showWelcome?'Skip to getting started':'Skip to workspace'}</a>
    <header className="masthead"><a className="brand" href={`/?network=${network}`} onClick={event=>{event.preventDefault();openWelcome();}}><span className="brand-mark"><BrandMark/></span><span>ArcMandate<small>Agent spending control</small></span></a><div className="masthead-meta"><StatusBadge label={networkName}/><details className="wallet-menu" id="wallet-menu" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}}><summary><span className={`wallet-dot ${account?'connected':''}`} aria-hidden="true"/>{account?`${walletRole(capabilities)} · ${account.slice(0,6)}…${account.slice(-4)}`:'Wallet not connected'}<span aria-hidden="true">⌄</span></summary><section className="wallet-popover" aria-label="Network and wallet"><h2>Your wallet</h2>
      {authorizedAccounts.length>0&&<><label>Account for this app<select value={account??''} disabled={busy||walletRequestOpen||walletChecking} onChange={event=>void chooseWalletAccount(event.target.value)}>{!account&&<option value="" disabled>Choose an authorized account</option>}{authorizedAccounts.map(address=><option key={address} value={address}>{address}</option>)}</select></label><p className="field-hint">Only accounts your wallet exposes to this site are listed.</p></>}
      {account?<><p className="mono">{account}</p><p>{walletChecking?'Checking wallet context…':walletChain===ARC_NETWORKS[network].chainId?`Connected to ${networkName}`:'Wrong wallet network'}</p><p>Wallet balance: {walletBalance===null?'unknown':`${formatUnits(walletBalance,18)} USDC`}</p><div className="actions"><button className="secondary" onClick={()=>{invalidate();pq.lock('you disconnected');walletEpoch.current++;rememberWalletDisconnect(true);connected.current=false;setAuthorizedAccounts([]);setAccount(null);setWalletChain(null);setWalletChecking(false);}}>Disconnect</button>{walletChain!==ARC_NETWORKS[network].chainId&&<button onClick={()=>nextAction('switch')}>Switch to {networkName}</button>}</div></>:<><p>You can view and recover a vault without connecting. Use the owner account to manage it or the agent account to pay.</p><button disabled={!provider} onClick={()=>void connect()}>Connect wallet</button>{!provider&&<p className="muted">Open this app in a browser with an EVM wallet extension.</p>}</>}</section></details></div></header>
    {showWelcome&&<><Welcome onCreate={newVault} onOpen={()=>{setVaultToolsOpen(true);go('overview','saved-vault-tools');}} onContinue={continueWorkspace} vaultLabel={vault?(selectedCard?.label||'your saved vault'):undefined} pending={unresolved}/>{historyError&&<div className="notice" role="alert"><p>Your saved transaction history needs recovery.</p><button className="text-button" onClick={()=>go('activity')}>Open recovery</button></div>}</>}
    <div className="workspace" hidden={showWelcome}><aside className="sidebar" aria-label="Workspace navigation"><WorkspaceNav panel={panel} onChange={go}/><div className="sidebar-key"><TechnicalIcon kind="lock"/><span>Vault Key<small>{pq.phase==='restored'?'Unlocked':pq.phase==='generated'?'Backup needed':'Locked locally'}</small></span></div><p className="sidebar-note">Your funds stay in the vault. You stay in control.</p></aside>
    <div className="workspace-content" id="workspace-content"><div className="page-heading" key={panel}><div><span className="eyebrow">{vault?'Vault workspace':'Get started'}</span><h1>{pageTitles[panel].title}</h1><p>{pageTitles[panel].description}</p></div>{snapshot?.active&&<button className="danger" onClick={()=>nextAction('freeze')}>Freeze session</button>}</div>
    {walletError&&<p className="error" role="alert">{walletError}</p>}{account&&walletChain!==ARC_NETWORKS[network].chainId&&<div className="inline-notice" role="alert"><p>Your wallet is on another network.</p><button className="secondary" onClick={()=>nextAction('switch')}>Switch to {networkName}</button></div>}
    {assetLoadError&&<section className="notice" role="alert"><h2>Reload application files</h2><p>Check wallet activity first if submission is uncertain. Reload never cancels an onchain session or transaction.</p><button onClick={()=>window.location.reload()}>Reload app</button></section>}
    {unresolved&&panel!=='activity'&&<div className="inline-notice pending-summary" role="alert"><p>{pendingOperations.length===1?'A saved transaction needs checking.':`${pendingOperations.length} saved transactions need checking.`} Sending remains restricted until resolved.</p><button className="secondary" onClick={()=>go('activity','pending-operations')}>View transaction recovery</button></div>}
    {unresolved&&panel==='activity'&&<section className="panel notice" id="pending-operations" role="alert"><h2>Pending operations</h2><p>Unknown or submitted is not confirmed. Closing a review panel or removing a bookmark does not cancel these transactions.</p>{pendingOperations.map(op=><article key={op.id} className="activity-entry"><h3>{actionLabels[op.action]} · {transactionStageLabels[op.stage]}</h3><OperationSummary operation={op}/><OperationRecovery op={op} walletOpen={walletRequestOpen&&activeOperation.current===op.id} onAttach={attachOperationHash} onAcknowledge={acknowledgeNotSubmitted} onReconcile={reconcileOperation}/></article>)}</section>}
    {historyError&&<><p className="error" role="alert">Operation history unavailable: {historyError}</p><HistoryRecovery onRestored={saved=>{setOperations(saved);setHistoryError('');for(const op of saved.filter(unresolvedOperation))void reconcileOperation(op);}}/></>}
    {draftError&&<PaymentDraftRecovery error={draftError} onRestored={()=>{const saved=loadPaymentDrafts().filter(d=>d.chainId===ARC_NETWORKS[network].chainId&&d.vault.toLowerCase()===vault?.toLowerCase()&&d.account.toLowerCase()===account?.toLowerCase());setPaymentDraft(saved.at(-1)??null);draftBaseline.current=saved.at(-1)?.requestId;newRequest.current=null;setDraftError('');invalidate();}}/>}
    <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={panel!=='overview'}>
      <section className="panel vault-panel" id="vault" aria-labelledby="vault-heading"><div className="vault-context"><div><h2 id="vault-heading">{vault?'Selected vault':'Choose a starting point'}</h2>{vault&&<span className="muted">{vault.slice(0,8)}…{vault.slice(-6)} · {readError?'State unavailable':reading?'Refreshing':snapshot?.trusted?'Verified onchain':'Verification pending'}</span>}</div><div className="vault-switcher">{!!registry.length&&<label>Saved vault<select value={vault??''} onChange={e=>{if(e.target.value)selectVault(getAddress(e.target.value));}}><option value="" disabled>Choose a saved vault</option>{vault&&!registry.some(item=>item.chainId===ARC_NETWORKS[network].chainId&&item.address.toLowerCase()===vault.toLowerCase())&&<option value={vault}>Current vault · {vault.slice(0,8)}…</option>}{registry.filter(item=>item.chainId===ARC_NETWORKS[network].chainId).map(item=><option key={item.address} value={item.address}>{item.label||'USDC vault'} · {item.address.slice(0,8)}…{item.address.slice(-4)}</option>)}</select></label>}{vault&&<button className="text-button" disabled={reading} onClick={()=>void refresh()}>Refresh state</button>}</div></div>
      {snapshot&&<SessionPlate snapshot={snapshot}/>}
      <NextStepCard state={{...capabilities,agentAddress:sessionForm.agent}} onAction={nextAction}/>
      {(!snapshot||snapshot.sessionId===0n)&&<SetupJourney snapshot={snapshot} onAction={nextAction}/>}
      <details className="vault-access" open={!!vaultError}><summary>{vault?'Vault address, backup card & opening another vault':'Already have a vault? Open or recover it'}</summary>
      <details className="vault-address-editor" open={!vault||!!vaultError}><summary>{vault?'Open another vault':'Open an existing vault'}</summary><p>Paste the vault contract address (42 characters including 0x). This is not an owner wallet, public key or transaction hash.</p><div className="address-row"><label>Vault address<input value={vaultInput} placeholder="0x + 40 hex characters" aria-invalid={!!vaultError} aria-describedby="vault-address-help" onChange={e=>{invalidate();setVaultInput(e.target.value);setVaultError('');}}/></label><button onClick={openVault}>Open vault</button></div><p id="vault-address-help">Have a creation transaction hash? Use Find vault below.</p>{vaultError&&<p className="error" role="alert">{vaultError}</p>}</details>
      <div className="actions"><button className="secondary" disabled={busy} onClick={newVault}>{vault?'Create another vault':'Create a new vault'}</button></div>
      <button className="text-button" onClick={()=>{setVaultToolsOpen(true);setFindOpen(true);requestAnimationFrame(()=>document.getElementById('creation-lookup')?.scrollIntoView({block:'start',behavior:'smooth'}));}}>Find a vault using its creation transaction</button>
      {vault&&<div className="vault-serial"><span>Vault contract address</span><a className="mono" href={`${ARC_NETWORKS[network].explorerUrl}/address/${vault}`} target="_blank" rel="noreferrer">{vault}</a><button className="text-button" onClick={()=>void navigator.clipboard.writeText(vault).then(()=>setCopyMessage('Vault address copied.')).catch(()=>setCopyMessage('Copy failed. Select the address above to copy it.'))}>Copy vault address</button>{selectedCard&&<button className="text-button" onClick={()=>downloadText(`arcmandate-vault-${vault.slice(2,10)}.json`,registryJson([selectedCard]))}>Download vault card</button>}{copyMessage&&<p role="status">{copyMessage}</p>}</div>}
      </details>
      {readError&&<div className="notice" role="alert"><h3>Vault state could not be read</h3><p>{/returned no data|not a vault/i.test(readError)?`This address did not return vault data. Check that it is a contract on ${networkName}, or find its creation transaction.`:explainError(new Error(readError)).advice}</p><p>{snapshot?'The last verified state belongs to this same vault and may be stale. Transactions are disabled until refresh succeeds.':'No session or balance from another vault is shown.'}</p><details><summary>Technical error</summary><p>{readError}</p></details><button className="secondary" onClick={()=>void refresh()}>Retry vault read</button></div>}
      {reading&&!snapshot&&<p role="status">Reading the selected vault…</p>}
      {snapshot&&<><p className="state-footnote">{readError?`Stale view at block ${snapshot.blockNumber}`:snapshot.trusted?'Contract verified against the supported build.':'Unknown contract build. Viewing only; deposits and transactions disabled.'}</p>
        <details className="session-help"><summary>What happens when I reload or lock my key?</summary><p>Reloading does not delete this onchain session. Locking the Vault Key closes only your local signer. To revoke spending, freeze the session and wait for its confirmed receipt.</p></details>
        {!snapshot.trusted&&<button className="secondary" onClick={exportDetails}>Export unsupported-build details</button>}
      </>}
      {!vault&&<details className="creation-details"><summary>What creating a vault involves</summary><ol><li>Connect the wallet that will own your vault.</li><li>Create, download and restore your Vault Key to prove the backup works.</li><li>Review creation. Your vault starts empty, with no session.</li></ol><button className="secondary" onClick={()=>go('key')}>Set up Vault Key</button>{actionButton('deploy','Review vault creation')}</details>}
      </section>
      <details className="panel vault-tools" id="saved-vault-tools" open={vaultToolsOpen||!!registryError} onToggle={event=>setVaultToolsOpen(event.currentTarget.open)}><summary><span>My saved vaults & recovery</span><span className="muted">{registry.filter(item=>item.chainId===ARC_NETWORKS[network].chainId).length} saved</span></summary><VaultLibrary network={network} items={registry} account={account} selected={vault} error={registryError} onOpen={selectVault} onChange={changeRegistry} onFind={locateCreation} findOpen={findOpen} onFindToggle={setFindOpen} onRecovered={items=>{setRegistry(items);setRegistryError('');}}/></details>
      <section className="panel role-guide"><div><h2>Your wallet manages. Your agent pays.</h2><p>USDC stays in the vault. You decide who the agent can pay, how much it can spend and for how long.</p></div><details><summary>Understand the wallets and Vault Key</summary><dl className="summary"><dt>Owner wallet</dt><dd>Your management wallet; keep its private key out of the bot.</dd><dt>Vault</dt><dd>The contract holds USDC. A session budget grants permission; it does not transfer the budget to the agent.</dd><dt>Vault Key</dt><dd>Second management signature, stored as an encrypted file. No gas balance. Locking it does not freeze the session.</dd><dt>Agent wallet</dt><dd>A separate account for bounded payments. It needs its own USDC for network fees. Funds in the agent wallet are outside vault limits.</dd><dt>Recipient</dt><dd>An address allowed to receive payment directly from the vault.</dd></dl><p>Example: 10 USDC in the vault, 2 USDC session budget, 0.50 USDC per-payment cap. A 0.25 payment moves vault funds directly to a recipient. The agent pays only its network fee.</p></details></section>
    </div>
    <div id="panel-key" role="tabpanel" aria-labelledby="tab-key" hidden={panel!=='key'}><KeyPanel key={vault??'new-vault'} pq={pq} expectedKey={snapshot?.publicKey} disabled={busy||walletChecking||!!vault&&!snapshot} onChange={invalidate}/>{vault&&pq.phase==='restored'&&<div className="task-footer"><p>Key unlocked. Return to your vault to choose the next action.</p><button onClick={()=>go('overview')}>Continue to your vault</button></div>}{!vault&&<section className="panel"><h2>Create your empty vault</h2>{actionButton('deploy','Review vault creation')}</section>}</div>
    <div id="panel-agent" role="tabpanel" aria-labelledby="tab-agent" hidden={panel!=='agent'}>{snapshot?<>
      <div className="task-switcher" aria-label="Agent tasks">{(['setup','limits','payment'] as const).map(item=><button key={item} className="secondary" aria-pressed={agentView===item} onClick={()=>setAgentView(item)}>{({setup:'1 · Prepare agent',limits:'2 · Set limits',payment:'3 · Make a payment'})[item]}</button>)}</div>
      <div hidden={agentView!=='setup'}><AgentSetup network={network} key={snapshot.address} snapshot={snapshot} agent={sessionForm.agent|| (snapshot.active?snapshot.policy.agent:'')} onAgent={value=>{invalidate();setSessionForm(previous=>({...previous,agent:value}));}} onGas={()=>{setFundsView('gas');go('funds');}} operations={operations} verifiedBlock={verifiedCreation?.address.toLowerCase()===snapshot.address.toLowerCase()?verifiedCreation.block:undefined}/><div className="task-footer"><p>{snapshot.balance===0n?'Add USDC to the vault, then choose spending limits. Open the session last.':'Next, choose where this agent can pay and how much it can spend.'}</p><div>{snapshot.balance===0n&&<button onClick={()=>nextAction('fund')}>Continue to vault deposit</button>}<button className={snapshot.balance===0n?'secondary':undefined} onClick={()=>setAgentView('limits')}>Continue to spending limits</button></div></div></div>
      <div hidden={agentView!=='limits'}>
      <section className="panel session-form" id="session-form"><span className="eyebrow">Spending permission</span><h2>{snapshot.active?'Replace session':'Open session'}</h2><p>Choose the agent’s budget, approved recipients and expiry. Your owner wallet and Vault Key approve these limits.</p><p>Agent: <span className="mono">{sessionForm.agent||'Choose the account in Agent setup'}</span> <button className="text-button" onClick={()=>setAgentView('setup')}>Change agent</button></p>
      <div className="fields">{(['budget','cap'] as const).map(field=><label key={field}>{field==='budget'?'Session budget (USDC)':'Per payment cap (USDC)'}<input inputMode="decimal" value={sessionForm[field]} onChange={e=>{invalidate();setSessionForm(previous=>({...previous,[field]:e.target.value}));}}/><small className="field-hint">{field==='budget'?'Total the agent may spend during this session.':'Maximum allowed in one payment.'}</small></label>)}</div>
      <label>Session duration<select value={durationPreset} onChange={e=>{invalidate();setDurationPreset(e.target.value);if(e.target.value!=='custom')setSessionForm(previous=>({...previous,minutes:e.target.value}));}}><option value="60">1 hour</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="custom">Custom duration</option></select></label>
      {durationPreset==='custom'&&<label>Custom duration (minutes)<input inputMode="numeric" value={sessionForm.minutes} onChange={e=>{invalidate();setSessionForm(previous=>({...previous,minutes:e.target.value}));}}/></label>}
      <p className="field-hint">One budget for this session; it does not renew daily. {snapshot&&/^[1-9]\d*$/.test(sessionForm.minutes)&&Number(sessionForm.minutes)<=525600&&<>Estimated end: {date(snapshot.timestamp+BigInt(sessionForm.minutes)*60n)}.</>}</p>
      <h3>Who can the agent pay?</h3><p className="field-hint">Add 1–5 recipient addresses. Payments go straight from the vault to these recipients.</p>{recipientRows.map((recipient,index)=>{let warning='';if(recipient)try{addressInput(recipient,'Recipient');if(recipients.filter(item=>item.toLowerCase()===recipient.trim().toLowerCase()).length>1)warning='Duplicate recipient';}catch(cause){warning=errorMessage(cause);}return <div className="recipient-row" key={index}><label>Recipient {index+1}<input value={recipient} placeholder="0x… recipient address" aria-invalid={!!warning} onChange={e=>{invalidate();setSessionForm(previous=>({...previous,recipients:recipientRows.map((item,at)=>at===index?e.target.value:item).join('\n')}));}}/></label><button className="secondary" disabled={recipientRows.length===1&&!recipient} onClick={()=>{invalidate();setSessionForm(previous=>({...previous,recipients:recipientRows.filter((_,at)=>at!==index).join('\n')}));}}>Remove recipient {index+1}</button>{warning&&<p className="error">{warning}</p>}</div>;})}
      <button className="secondary" disabled={recipientRows.length>=5} onClick={()=>{invalidate();setSessionForm(previous=>({...previous,recipients:`${previous.recipients}\n`}));}}>Add recipient</button>
      <details><summary>Paste multiple recipient addresses</summary><label>Allowed recipients (one address per line)<textarea value={sessionForm.recipients} placeholder="Paste 1–5 addresses, one per line" onChange={e=>{invalidate();setSessionForm(previous=>({...previous,recipients:e.target.value}));}}/></label></details>
      <details className="session-help"><summary>How duration, deposits and replacement work</summary><p>Open the session after preparing the agent and depositing. The signed expiry uses chain time at review, including time waiting for wallet approval. Deposits add money without renewing the budget. Replacement grants a new budget and resets spent; it does not add to the old budget.</p></details>
      {sessionForm.agent&&recipients.some(to=>to.toLowerCase()===sessionForm.agent.toLowerCase())&&<p className="warning">The agent is also an allowed recipient and can transfer vault funds to its own wallet.</p>}
      {actionButton('start',snapshot.active?'Review replacement':'Review open session')}
      </section>
      </div><div hidden={agentView!=='payment'}><AgentConsole key={`${snapshot.address}:${account}`} snapshot={snapshot} draft={paymentDraft} disabled={!consoleGate.allowed} reasons={consoleGate.reasons} onReview={(recipient,amount)=>prepare('agent-pay',{recipient,amount})} onNew={()=>{invalidate();draftBaseline.current=paymentDraft?.requestId;newRequest.current=crypto.randomUUID();setPaymentDraft(null);}}/></div>
    </>:<p className="notice">Open a vault and read its state before configuring an agent or session.</p>}</div>
    <div id="panel-funds" role="tabpanel" aria-labelledby="tab-funds" hidden={panel!=='funds'}><div className="task-switcher" aria-label="Fund tasks">{(['deposit','withdraw','gas'] as const).map(item=><button key={item} className="secondary" aria-pressed={fundsView===item} onClick={()=>setFundsView(item)}>{({deposit:'Deposit to vault',withdraw:'Withdraw from vault',gas:'Fund agent fees'})[item]}</button>)}</div><div className="funds-layout"><div><section className="panel" hidden={fundsView!=='deposit'}><span className="eyebrow">Wallet → vault</span><h2>Deposit USDC</h2><p>Add money to your vault. The session budget stays the same.</p><label>Deposit amount (USDC)<input inputMode="decimal" placeholder="0.00" value={fundAmount} onChange={e=>{invalidate();setFundAmount(e.target.value);}}/></label><p className="field-hint">Keep enough in your wallet for the network fee. A verified matching Vault Key backup is required by this app before deposit.</p>{actionButton('fund','Review deposit')}</section>
      <section className="panel" id="agent-gas" hidden={fundsView!=='gas'}><span className="eyebrow">Owner wallet → agent</span><h2>Add agent network fees</h2><p>The agent needs its own USDC to pay transaction fees.</p><p className="warning">This money goes to the agent wallet, outside your vault’s spending limits.</p><p className="mono">Agent recipient: {sessionForm.agent||'Not selected'}</p>{!sessionForm.agent&&<button className="text-button" onClick={()=>{setAgentView('setup');go('agent');}}>Choose agent account</button>}<label>Agent fee funding amount (USDC)<input inputMode="decimal" placeholder="0.00" value={gasAmount} onChange={e=>{invalidate();setGasAmount(e.target.value);}}/></label>{actionButton('agent-gas','Review agent fee funding')}<details><summary>About USDC network-fee balances</summary><p>The native (18-decimal) and ERC-20 (6-decimal) views represent the same Arc USDC balance. Do not add them together. This transfer is not a vault deposit.</p></details></section>
      <section className="panel" hidden={fundsView!=='withdraw'}><span className="eyebrow">Vault → recipient</span><h2>Withdraw USDC</h2><p>Return money from the vault to an address you choose.</p>{snapshot?.active&&<div className="inline-notice"><p>Freeze the session and wait for confirmation before withdrawing.</p><button className="secondary" onClick={()=>nextAction('freeze')}>View freeze options</button></div>}<label>Withdrawal recipient<input value={withdrawTo} placeholder={account??'0x…'} onChange={e=>{invalidate();setWithdrawTo(e.target.value);}}/></label><label>Withdrawal amount (USDC)<input inputMode="decimal" placeholder="0.00" value={withdrawAmount} onChange={e=>{invalidate();setWithdrawAmount(e.target.value);}}/></label><p className="field-hint">Requires the owner wallet and matching Vault Key.</p>{actionButton('withdraw','Review withdrawal')}</section></div><aside className="funds-context"><span className="eyebrow">Balance check</span><dl><dt>In the vault</dt><dd>{snapshot?usd(snapshot.balance):'Open a vault first'}</dd><dt>In your connected wallet</dt><dd>{account&&walletBalance!==null?`${formatUnits(walletBalance,18)} USDC`:account?'Balance unavailable':'Wallet not connected'}</dd></dl><p>{fundsView==='gas'?'Agent fees are separate from money held in the vault.':'Transfers change these balances. Setting a session budget does not move money.'}</p></aside></div></div>
    <details className="panel lock-panel" id="freeze-session" open={freezeOpen} onToggle={event=>setFreezeOpen(event.currentTarget.open)}><summary><span>Freeze session</span><span className="muted">{snapshot?.active?'Stop spending permission':'Owner or Vault Key options'}</span></summary><p>Owner freeze needs no Vault Key. If the owner is unavailable, a matching Vault Key and funded relay wallet can freeze. Wait for confirmation; an earlier payment may execute first.</p><div className="freeze-actions"><div><h3>Use the owner wallet</h3><p>The usual way to stop the session.</p>{actionButton('owner-freeze','Review owner freeze')}</div><div><h3>Use your Vault Key</h3><p>Alternative when owner access is unavailable.</p>{actionButton('pq-freeze','Review Vault Key freeze')}</div></div>{unresolved&&<p className="warning">A pending nonce can delay freeze for the same sender. A distinct funded sender can use the Vault Key path.</p>}</details>
    <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={panel!=='activity'}>
      {snapshot&&<RecentEvents key={`${network}:${snapshot.address}`} snapshot={snapshot} network={network} deploymentBlock={verifiedCreation?.address.toLowerCase()===snapshot.address.toLowerCase()?BigInt(verifiedCreation.block):undefined}/>}
      <section className="panel" aria-label="Wallet activity"><h2>Local wallet operations</h2><p>These records include attempts and recovery status. Onchain events above are receipt effects. No bookmark removal clears this journal.</p>{!selectedOperations.length&&<p>No local operations for this selection. Check wallet or explorer activity if you used another browser.</p>}{selectedOperations.map(op=><article className="activity-entry" key={op.id}><h3>{actionLabels[op.action]} · {transactionStageLabels[op.stage]}</h3><p>{new Date(op.createdAt).toLocaleString()}</p><OperationSummary operation={op}/>{op.requestId&&<p className="mono">Request {op.requestId} · original session {op.sessionId}</p>}{op.hash&&<a href={`${ARC_NETWORKS[network].explorerUrl}/tx/${op.hash}`} target="_blank" rel="noreferrer">View transaction</a>}{op.message&&<p>{op.message==='[object Object]'?transactionStageLabels[op.stage]:op.message}</p>}{op.deployedVault&&op.deployedVault.toLowerCase()!==vault?.toLowerCase()&&<button className="secondary" onClick={()=>selectVault(getAddress(op.deployedVault!))}>Open created vault</button>}{unresolvedOperation(op)&&<OperationRecovery op={op} walletOpen={walletRequestOpen&&activeOperation.current===op.id} onAttach={attachOperationHash} onAcknowledge={acknowledgeNotSubmitted} onReconcile={reconcileOperation}/>}</article>)}</section>
      <section className="panel"><h2>Recovery & diagnostics</h2><p>Recovery details stay in this browser tab. The export contains no passwords, private keys, backup contents or signing data. Keep your encrypted Vault Key backup separately.</p><button className="secondary" onClick={exportDetails}>Export public diagnostics</button><button className="secondary" onClick={()=>downloadText('arcmandate-operation-history.json',localStorage.getItem('arcmandate.operations.v1')??'[]')}>Export operation history</button></section>
    </div>
    {!drawerOpen&&transaction.stage!=='idle'&&<section className="notice" role="status"><p>{transaction.message}</p>{['cancelled','simulation-rejected','unknown'].includes(transaction.stage)&&<p>{explainError(new Error(transaction.message)).advice}</p>}<button className="secondary" onClick={()=>setDrawerOpen(true)}>Open transaction status</button></section>}
    <TransactionDrawer open={drawerOpen} onClose={()=>setDrawerOpen(false)}><TransactionProgress transaction={transaction}/><section className="panel transaction">
      <div className="section-heading"><h2>{review?.title??(displayedOperation?actionLabels[displayedOperation.action]:'Transaction status')}</h2><StatusBadge label={transactionStageLabels[transaction.stage]} tone={transactionTone}/></div>
      {!review&&displayedOperation&&<OperationSummary operation={displayedOperation}/>}
      {review&&<><dl className="summary"><dt>Network</dt><dd>{networkLabel(review.network)}</dd><dt>Sender / fee payer</dt><dd className="mono">{review.account}</dd>{review.snapshot&&<><dt>Vault contract</dt><dd className="mono">{review.snapshot.address}</dd></>}{review.amount!==undefined&&<><dt>Amount</dt><dd>{usd(review.amount)}</dd></>}{review.to&&<><dt>Recipient</dt><dd className="mono">{review.to}</dd></>}{review.action==='fund'&&<><dt>Recipient vault</dt><dd className="mono">{review.snapshot?.address}</dd></>}{review.action==='deploy'&&<><dt>Deposited / session</dt><dd>0 USDC / no session</dd><dt>Vault Key ID</dt><dd>{review.publicKey?.slice(2,10)}</dd></>}{review.payment&&<><dt>Request ID</dt><dd className="mono">{review.payment.requestId}</dd><dt>Original session</dt><dd>{review.payment.sessionId}</dd></>}{review.intent&&<><dt>Authorization deadline</dt><dd>{date(review.intent.auth.deadline)}</dd></>}</dl>
        {review.action==='agent-gas'&&<p className="warning">Transfers your wallet's USDC directly to the agent. Not a vault deposit; outside session protection.</p>}
        {review.action==='agent-pay'&&<p>Vault funds go directly to the recipient. The connected agent pays the network fee. Retry keeps the original request/payment ID; unknown transactions must be reconciled first.</p>}
        {review.policy&&<>{review.snapshot?.active&&<details><summary>Previous session being replaced</summary><PolicySummary policy={review.snapshot.policy}/></details>}<h3>New session</h3><PolicySummary policy={review.policy}/>{review.snapshot&&review.policy.totalBudget>review.snapshot.balance&&<p className="warning">Budget exceeds today's balance. Future deposits can make the remaining authority spendable.</p>}{review.policy.recipients.includes(getAddress(review.policy.agent))&&<p className="warning">The agent is an allowed recipient and can pay its own wallet.</p>}</>}
        {ready?<><p>Buffered network-fee estimate: <strong>{formatUnits(ready.quote.gas*ready.quote.gasPrice,18)} USDC</strong>. The wallet determines the final fee.</p><button disabled={busy} onClick={send}>{sendLabels[review.action]}</button></>:review.intent?<button disabled={busy||transaction.stage!=='review'} onClick={approve}>Authorize with Vault Key</button>:null}
        <button className="secondary" disabled={walletRequestOpen} onClick={()=>{invalidate();if(transaction.stage==='signing')pq.lock('you cancelled signing');}}>Cancel unsigned review</button>
      </>}
      <p role="status">{transaction.message}</p>{['simulation-rejected','wallet-rejected','unknown','cancelled','reverted'].includes(transaction.stage)&&<p>{explainError(new Error(transaction.message)).advice}</p>}
      {transaction.hash&&<p className="mono"><a target="_blank" rel="noreferrer" href={`${ARC_NETWORKS[transactionNetwork].explorerUrl}/tx/${transaction.hash}`}>View transaction {transaction.hash}</a></p>}
      {transaction.stage==='confirmed'&&<><p className="notice">Confirmed onchain. {displayedOperation?.action==='deploy'?'Your empty vault is saved. Prepare an agent, then deposit and open a session.':displayedOperation?.action==='start'?'Session rules are active. This does not start a bot; switch to the configured agent to make a payment.':displayedOperation?.action==='owner-freeze'||displayedOperation?.action==='pq-freeze'?'Session frozen. The owner can now review a withdrawal.':'The verified action effect is recorded in Activity.'}</p><button onClick={()=>{setDrawerOpen(false);if(displayedOperation?.action==='owner-freeze'||displayedOperation?.action==='pq-freeze'){setFundsView('withdraw');go('funds');}else {setAgentView(displayedOperation?.action==='start'?'payment':'setup');go('agent');}}}>Continue to next step</button></>}
    </section></TransactionDrawer>
    <footer><span>ArcMandate · {networkName}</span><p>Keep your encrypted Vault Key backup and password. Vault cards and agent configuration contain public metadata only.</p></footer></div></div>
  </main></>;
}
