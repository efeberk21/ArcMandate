import { useEffect, useRef, useState } from 'react';
import { formatUnits, getAddress, parseUnits, toHex, type Address } from 'viem';
import { ARC_NETWORKS } from '@arcmandate/core';
import { arcClient, type VaultSnapshot } from '../lib/chain';
import type { BrowserWallet } from '../lib/wallet';

type Payment = { index: number; dueAt: number; status: string; hash?: string; message?: string };
type Plan = { id: string; recipient: Address; amount: string; startAt: number; intervalSeconds: number; count: number; sessionId: string;
  status: string; nextIndex: number; payments: Payment[]; message: string };
type State = { chainId: number; vault: Address; agent: Address | null; plan: Plan | null; history: Plan[]; lastCheckedAt: number | null; lastError: string | null;
  feeReturn?: { hash: string; amount: string; status: string; message: string } | null };
const endpoint = (import.meta.env.VITE_AUTOMATION_API_URL as string | undefined)?.replace(/\/$/, '');
const localInput = (time: number) => { const d = new Date(time); return new Date(time - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const date = (time: number) => new Date(time).toLocaleString();
const usdc = (value: string) => `${formatUnits(BigInt(value), 6)} USDC`;

export function AutomaticPayments({ snapshot, account, provider, walletChain, disabled, onAgent, onLimits, onGas, onDeposit, onFreeze }: {
  snapshot: VaultSnapshot; account: Address | null; provider?: BrowserWallet; walletChain: number | null; disabled: boolean;
  onAgent(address: Address): void; onLimits(): void; onGas(): void; onDeposit(): void; onFreeze(): void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [recipient, setRecipient] = useState<string>(snapshot.policy.recipients[0] ?? '');
  const [amount, setAmount] = useState('');
  const [start, setStart] = useState(() => localInput(Date.now() + 180_000));
  const [interval, setIntervalValue] = useState('15');
  const [count, setCount] = useState('2');
  const [review, setReview] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [feeBalance, setFeeBalance] = useState<bigint | null>(null);
  const current = useRef(true);
  const onAgentRef = useRef(onAgent); onAgentRef.current = onAgent;
  const announcedAgent = useRef<Address | null>(null);
  const owner = !!account && account.toLowerCase() === snapshot.owner.toLowerCase();
  const canManage = owner && walletChain === snapshot.chainId && snapshot.trusted && !disabled;
  const base = `${endpoint}/v1/${snapshot.chainId}/${snapshot.address}`;
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  async function api<T>(action: string, body: unknown = {}, auth = token): Promise<T> {
    if (!endpoint) throw new Error('Automatic payments are not enabled on this deployment yet.');
    const response = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (response.status === 401 && current.current) setToken('');
    if (!response.ok) throw new Error(result.error || 'Unable to reach the payment service.');
    return result as T;
  }
  function accept(result: State) {
    if (!current.current) return;
    if (result.chainId !== snapshot.chainId || result.vault.toLowerCase() !== snapshot.address.toLowerCase()) throw new Error('Service returned another vault.');
    setState(result); setFetchedAt(Date.now());
    if (result.agent && result.agent !== announcedAgent.current) { announcedAgent.current = result.agent; onAgentRef.current(result.agent); }
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (cause) { if (current.current) setError(cause instanceof Error ? cause.message : 'Service unavailable.'); }
    finally { if (current.current) setBusy(false); }
  }
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const id = window.setInterval(() => {
      if (!alive || busy) return;
      void api<State>('state').then(result => { if (alive) { accept(result); setPollError(''); } }).catch(cause => { if (alive) setPollError(cause.message); });
    }, 15_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [token, busy]);
  useEffect(() => {
    setReview(false);
    setStart(previous => new Date(previous).getTime() < Date.now() + 30_000 ? localInput(Date.now() + 180_000) : previous);
  }, [snapshot.sessionId, snapshot.policy.agent, snapshot.active]);
  useEffect(() => {
    let alive = true;
    if (!state?.agent) { setFeeBalance(null); return; }
    void arcClient(snapshot.chainId === 5042 ? 'mainnet' : 'testnet').getBalance({ address: state.agent })
      .then(balance => { if (alive) setFeeBalance(balance); }).catch(() => { if (alive) setFeeBalance(null); });
    return () => { alive = false; };
  }, [state?.agent, snapshot.blockNumber]);
  async function login() {
    if (!provider || !canManage) throw new Error('Connect the owner wallet on the selected network.');
    const challenge = await api<{ nonce: string; owner: Address; message: string }>('challenge');
    if (getAddress(challenge.owner) !== getAddress(account!)) throw new Error('This vault has another owner.');
    const signature = await provider.request({ method: 'personal_sign', params: [toHex(challenge.message), account] });
    if (!current.current) return;
    const session = await api<{ token: string }>('login', { nonce: challenge.nonce, signature });
    if (!current.current) return;
    setToken(session.token); accept(await api<State>('state', {}, session.token));
  }
  let payload: { recipient: Address; amount: string; startAt: number; intervalSeconds: number; count: number } | undefined;
  let invalid = '';
  try {
    if (!state?.agent || !snapshot.active || snapshot.policy.agent.toLowerCase() !== state.agent.toLowerCase()) throw new Error('Open a spending session for your automatic payment account first.');
    if (!recipient) throw new Error('Choose an allowed recipient.');
    const to = getAddress(recipient);
    if (!snapshot.policy.recipients.some(a => a.toLowerCase() === to.toLowerCase())) throw new Error('Choose an allowed recipient.');
    if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(amount)) throw new Error('Enter a USDC amount with up to six decimals.');
    const units = parseUnits(amount, 6), payments = Number(count), seconds = Number(interval) * 60, time = new Date(start).getTime();
    if (units <= 0n || units > snapshot.policy.perTxCap) throw new Error('Amount must be positive and within the payment limit.');
    if (!Number.isSafeInteger(payments) || payments < 1 || payments > 100) throw new Error('Choose 1–100 payments.');
    if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 2_592_000) throw new Error('Interval must be 1 minute to 30 days.');
    if (!Number.isFinite(time) || time < Date.now() + 30_000) throw new Error('Choose a first payment at least 30 seconds from now.');
    if (time + seconds * 1000 * (payments - 1) >= Number(snapshot.policy.expiresAt) * 1000) throw new Error('The last payment must be before your session expires.');
    if (units * BigInt(payments) > snapshot.policy.totalBudget - snapshot.spent) throw new Error('Plan total exceeds your remaining budget.');
    if (units * BigInt(payments) > snapshot.balance) throw new Error('Deposit enough USDC for the whole plan.');
    payload = { recipient: to, amount: units.toString(), startAt: time, intervalSeconds: seconds, count: payments };
  } catch (cause) { invalid = (cause as Error).message; }
  const plan = state?.plan;
  const unresolved = plan?.payments.some(p => ['intent', 'signed'].includes(p.status));
  const canCreate = state?.feeReturn?.status !== 'signed' && (!plan || ['completed', 'stopped'].includes(plan.status) && !unresolved);
  const explorer = ARC_NETWORKS[snapshot.chainId === 5042 ? 'mainnet' : 'testnet'].explorerUrl;
  const update = (fn: () => void) => { fn(); setReview(false); setAcknowledged(false); };
  return <section className="panel automatic-payments" aria-label="Automatic payments">
    <span className="eyebrow">Runs while you’re away</span><h2>Automatic payments</h2>
    <p>Choose the recipient, amount and schedule. After you authorize the spending session and activate a plan, payments run without a wallet prompt—even when this site is closed.</p>
    {!endpoint ? <p className="notice">Automatic payments are not enabled on this deployment yet. Your vault management remains available.</p> : <>
      {!token && <><p>Sign in with your vault’s owner wallet to prepare the payment account and manage schedules. Sign-in is free and does not move money.</p><button disabled={!canManage || busy} onClick={() => void run(login)}>{busy ? 'Connecting…' : 'Sign in to automatic payments'}</button>{!owner && <p className="field-hint">Connect this vault’s owner wallet.</p>}</>}
      {token && <>
        {!state?.agent ? <><p>Prepare a separate payment account managed by the service. Your owner wallet and Vault Key stay with you.</p><button disabled={busy || !canManage} onClick={() => void run(async () => accept(await api<State>('agent')))}>Prepare automatic payment account</button></> : <>
          <dl className="summary"><dt>Automatic payment account</dt><dd className="mono">{state.agent}</dd><dt>Session connection</dt><dd>{snapshot.active && snapshot.policy.expiresAt > snapshot.timestamp && snapshot.policy.agent.toLowerCase() === state.agent.toLowerCase() ? `Authorized · session ${snapshot.sessionId}` : 'Spending session needed'}</dd></dl>
          <div className="welcome-actions"><button className="secondary" onClick={onGas}>Add payment network fees</button><button className="secondary" onClick={onDeposit}>Deposit to vault</button><button className="secondary" onClick={onLimits}>Set spending limits</button></div>
          <p>Payment account network-fee balance: <strong>{feeBalance === null ? 'Unavailable' : `${formatUnits(feeBalance, 18)} USDC`}</strong>.</p>
          {!snapshot.active && !unresolved && plan?.status !== 'running' && <button className="secondary" disabled={busy || !canManage || state.feeReturn?.status === 'signed'} onClick={() => void run(async () => accept(await api<State>('return-fees')))}>Return unused fees to owner</button>}
          {state.feeReturn && <p>{state.feeReturn.message} <a href={`${explorer}/tx/${state.feeReturn.hash}`} target="_blank" rel="noreferrer">Fee return · {state.feeReturn.status}</a></p>}
          <p className="field-hint">The service holds this account’s signing key. The vault enforces your recipient, amount, budget and expiry limits. The service enforces the schedule. Network fees come from the account’s separate balance, with a maximum of 0.01 USDC per submitted payment. Insufficient fees pause the plan.</p>
          {plan && <article className="automatic-plan"><div className="section-heading"><h3>Current plan</h3><strong>{pollError ? 'Status unavailable' : plan.status}</strong></div>
            <p>{plan.message}</p><dl className="summary"><dt>Recipient</dt><dd className="mono">{plan.recipient}</dd><dt>Each payment</dt><dd>{usdc(plan.amount)}</dd><dt>Frequency</dt><dd>Every {plan.intervalSeconds / 60} minutes · {plan.count} times</dd><dt>Original session</dt><dd>{plan.sessionId}</dd><dt>Next scheduled time</dt><dd>{plan.nextIndex < plan.count ? date(plan.startAt + plan.intervalSeconds * 1000 * plan.nextIndex) : 'Schedule ended'}</dd><dt>Confirmed payments</dt><dd>{plan.payments.filter(p => p.status === 'confirmed').length} of {plan.count}</dd></dl>
            <div className="welcome-actions">{plan.status === 'running' && <button className="secondary" disabled={busy || !canManage} onClick={() => void run(async () => accept(await api<State>('pause', { planId: plan.id })))}>Pause plan</button>}{plan.status === 'paused' && <button disabled={busy || !canManage} onClick={() => void run(async () => accept(await api<State>('resume', { planId: plan.id })))}>Resume plan</button>}{!['stopped', 'completed'].includes(plan.status) && <button className="secondary" disabled={busy || !canManage} onClick={() => void run(async () => accept(await api<State>('stop', { planId: plan.id })))}>Stop plan</button>}<button className="danger" onClick={onFreeze}>Freeze spending authority</button></div>
            <p className="field-hint">Pause stops new submissions by the service. Freeze revokes the onchain session. A transaction already sent may still confirm.</p>
          </article>}
          {canCreate && <div className="automatic-form"><h3>Create a payment plan</h3>
            <label>Recipient<select value={recipient} onChange={e => update(() => setRecipient(e.target.value))}><option value="">Choose an allowed recipient</option>{snapshot.policy.recipients.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
            <div className="field-grid"><label>Each payment (USDC)<input inputMode="decimal" value={amount} placeholder="0.01" onChange={e => update(() => setAmount(e.target.value))}/></label><label>Number of payments<input type="number" min="1" max="100" value={count} onChange={e => update(() => setCount(e.target.value))}/></label></div>
            <div className="field-grid"><label>First payment ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input type="datetime-local" value={start} onChange={e => update(() => setStart(e.target.value))}/></label><label>Repeat every (minutes)<input type="number" min="1" max="43200" value={interval} onChange={e => update(() => setIntervalValue(e.target.value))}/></label></div>
            <p className="field-hint">A delayed time is skipped after one minute. Missed payments are not sent together when the service recovers. Network confirmation times can vary.</p>
            {invalid && <p className="field-hint">{invalid}</p>}
            {!review ? <button disabled={busy || !canManage || !!invalid} onClick={() => setReview(true)}>Review payment plan</button> : payload && <div className="notice"><h3>Review before activating</h3><p>{payload.count} payments of {usdc(payload.amount)}. Total: <strong>{usdc((BigInt(payload.amount) * BigInt(payload.count)).toString())}</strong>, plus network fees.</p><p className="mono">To: {payload.recipient}</p><p>First: {date(payload.startAt)}<br/>Last: {date(payload.startAt + payload.intervalSeconds * 1000 * (payload.count - 1))}</p><label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>I authorize these automatic payments under session {snapshot.sessionId.toString()}, including when this page is closed.</label><button disabled={busy || !canManage || !acknowledged || !!invalid} onClick={() => void run(async () => { accept(await api<State>('plan', payload)); setReview(false); setAcknowledged(false); })}>{busy ? 'Activating…' : 'Activate automatic payments'}</button><button className="secondary" disabled={busy} onClick={() => setReview(false)}>Edit plan</button></div>}
          </div>}
          {[...(plan ? [plan] : []), ...state.history.slice().reverse()].filter(p => p.payments.length).map(p => <details key={p.id} open={p === plan}><summary>Payment history · session {p.sessionId}</summary>{p.payments.map(payment => <article className="activity-entry" key={payment.index}><strong>Payment {payment.index + 1} · {payment.status}</strong><p>{date(payment.dueAt)}</p>{payment.message && <p>{payment.message}</p>}{payment.hash && <a href={`${explorer}/tx/${payment.hash}`} target="_blank" rel="noreferrer">View transaction</a>}</article>)}</details>)}
        </>}
        <button className="text-button" disabled={busy} onClick={() => void run(async () => accept(await api<State>('state')))}>Refresh service status</button>
        {fetchedAt && <p className="field-hint">Last loaded: {date(fetchedAt)}. Worker checked: {state?.lastCheckedAt ? date(state.lastCheckedAt) : 'No scheduled payment processed yet'}.</p>}
        {state?.lastError && <p className="warning">{state.lastError}</p>}
      </>}
    </>}
    {(error || pollError) && <p role="alert" className="error">{error || pollError} Saved information may be stale; an active plan can continue on the server.</p>}
  </section>;
}
