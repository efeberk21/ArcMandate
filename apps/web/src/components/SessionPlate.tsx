import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import type { VaultSnapshot } from '../lib/chain';

export function TechnicalIcon({ kind = 'anchor' }: { kind?: 'anchor' | 'lock' | 'plate' | 'orbit' }) {
  return <svg className="technical-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    {kind === 'lock' ? <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>
      : kind === 'plate' ? <><rect x="4" y="3" width="16" height="18" rx="4" /><path d="M8 8h8M8 12h5M8 16h8" /></>
        : kind === 'orbit' ? <><circle cx="12" cy="12" r="3" /><path d="M6 5c-4 4-5 11-2 14s10 2 14-2M18 19c4-4 5-11 2-14S10 3 6 7" /><circle cx="5" cy="6" r="1.5" /><circle cx="19" cy="18" r="1.5" /></>
          : <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />}
  </svg>;
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'rated' | 'overload' | 'verified' }) {
  return <span className={`badge tone-${tone}`}><span className="status-mark" aria-hidden="true" />{label}</span>;
}

const amount = (value: bigint) => formatUnits(value, 6);
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
type SessionState = 'active' | 'locked' | 'expired' | 'exhausted' | 'unanchored';
const labels: Record<SessionState, string> = { active: 'Active session', locked: 'Frozen', expired: 'Expired', exhausted: 'Budget used', unanchored: 'No session yet' };

export function SessionPlate({ snapshot, onManage, onLockOut, lockDisabled = true }: {
  snapshot: VaultSnapshot; onManage?: () => void; onLockOut?: () => void; lockDisabled?: boolean;
}) {
  const [clock, setClock] = useState({ snapshot, elapsed: 0 });
  const [paymentPulse, setPaymentPulse] = useState(0);
  const previous = useRef({ sessionId: snapshot.sessionId, spent: snapshot.spent });
  useEffect(() => {
    if (previous.current.sessionId !== snapshot.sessionId) setPaymentPulse(0);
    else if (snapshot.active && snapshot.spent > previous.current.spent) setPaymentPulse((value) => value + 1);
    previous.current = { sessionId: snapshot.sessionId, spent: snapshot.spent };
    setClock({ snapshot, elapsed: 0 });
    if (!snapshot.active) return;
    const start = performance.now();
    const timer = window.setInterval(() => setClock({ snapshot, elapsed: Math.floor((performance.now() - start) / 1000) }), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot]);
  const elapsed = clock.snapshot === snapshot ? clock.elapsed : 0;
  const hasSession = snapshot.sessionId > 0n;
  const hasPolicy = snapshot.policy.totalBudget > 0n;
  const remaining = snapshot.policy.totalBudget > snapshot.spent ? snapshot.policy.totalBudget - snapshot.spent : 0n;
  const seconds = snapshot.policy.expiresAt > snapshot.timestamp + BigInt(elapsed) ? Number(snapshot.policy.expiresAt - snapshot.timestamp) - elapsed : 0;
  const state: SessionState = !hasSession ? 'unanchored' : !snapshot.active ? 'locked' : seconds === 0 ? 'expired' : remaining === 0n ? 'exhausted' : 'active';
  const usable = state === 'active';
  const ratio = hasPolicy ? Number(remaining * 10000n / snapshot.policy.totalBudget) / 10000 : 0;
  const spendable = usable ? (remaining < snapshot.balance ? remaining : snapshot.balance) : 0n;
  const hold = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((n) => n.toString().padStart(2, '0')).join(':');
  const connectionPath = state === 'locked' ? 'M120 115C225 215 330 215 444 115' : 'M120 115C225 35 330 182 444 115';
  const titles: Record<SessionState, string> = {
    active: 'Your agent’s spending limits.', locked: 'Session frozen.', expired: 'Session expired.',
    exhausted: 'Session budget used.', unanchored: 'No spending session yet.',
  };
  return <div className={`vault-instrument state-${state}`}>
    <div className="vault-stat-grid"><section className="vault-balance-card" aria-label="Vault balance"><span className="eyebrow">Held in your vault</span><div className="balance-amount"><strong>{amount(snapshot.balance)}</strong><span>USDC</span></div><p>Your agent’s budget gives spending permission. This is the money actually in the vault.</p></section>
    <section className="session-plate" aria-label="Anchored session">
      <div className="session-heading"><div className="session-identity"><h3>{titles[state]}</h3></div><StatusBadge label={labels[state]} tone={usable ? 'rated' : hasSession ? 'overload' : 'neutral'} /></div>
      {hasPolicy?<><div className="session-budget"><div><span className="plate-label">{usable?'Remaining budget':'Unused budget'}</span><div className="load-value"><strong>{amount(remaining)}</strong><span>/ {amount(snapshot.policy.totalBudget)} USDC</span></div></div><span className="budget-fraction mono">{Math.round(ratio*100)}% remaining</span></div><dl className="session-specs"><div><dt>Per payment</dt><dd>{amount(snapshot.policy.perTxCap)} USDC</dd></div><div><dt>Time remaining</dt><dd>{state==='locked'?'Closed':hold}</dd></div><div><dt>Recipients</dt><dd>{snapshot.policy.recipients.length} allowed</dd></div></dl></>:<p className="empty-session-copy">{hasSession?'Agent spending is stopped. You can withdraw or set new limits.':'No agent can spend yet. Prepare an account, deposit and open a session.'}</p>}
      {usable&&snapshot.balance===0n&&<p className="warning">The session has permission, but the vault is empty.</p>}
      {usable && seconds <= 600 && <p className="warning" role="status">Expires within 10 minutes. Replace or freeze the session.</p>}
      <p className="instrument-note">{state === 'locked' ? 'Authority revoked. Session limits and recipients were cleared onchain.' : state === 'expired' || state === 'exhausted' ? 'Spending unavailable. Freeze this onchain session before withdrawal.' : state === 'unanchored' ? 'Creating the vault does not start a bot or a spending session.' : 'The budget stays fixed until you replace the session.'}</p>
    </section></div>
    <details className="vault-state-details"><summary>Spending rules & contract details <span className="muted">State at block {snapshot.blockNumber.toString()}</span></summary>
      <div className="session-detail-grid"><div><h3>How spending is limited</h3>
      <div className="anchor-field" role="img" aria-label={`Vault anchor and ${hasPolicy ? 'session' : 'inactive'} agent. ${labels[state]}.${hasPolicy ? ` ${amount(remaining)} of ${amount(snapshot.policy.totalBudget)} USDC budget remains.` : ' No spending authority.'}`}>
        <span className="field-star" style={{ left: '8%', top: '22%' }} aria-hidden="true" /><span className="field-star star-bright" style={{ left: '38%', top: '14%' }} aria-hidden="true" /><span className="field-star" style={{ left: '89%', top: '17%' }} aria-hidden="true" /><span className="field-star" style={{ left: '49%', top: '80%' }} aria-hidden="true" /><span className="field-star star-bright" style={{ left: '84%', top: '76%' }} aria-hidden="true" /><span className="field-star" style={{ left: '12%', top: '82%' }} aria-hidden="true" />
        <svg className="anchor-map" viewBox="0 0 600 230" preserveAspectRatio="none" aria-hidden="true">
          <ellipse className="authority-boundary" cx="300" cy="115" rx="250" ry="99" />
          <path className="authority-halo" d={connectionPath} />
          <path className="authority-track" d={connectionPath} />
          <path className="authority-tether" d={connectionPath} pathLength="1" strokeDasharray={state === 'locked' ? '1 0' : `${ratio} 1`} />
          {usable && paymentPulse > 0 && <path key={paymentPulse} className="payment-trace" d={connectionPath} pathLength="1" />}
        </svg>
        <span className="boundary-label">Bounded authority</span>
        <div className="anchor-node vault-node"><span className="anchor-core"><TechnicalIcon /></span><span className="node-label">Vault / anchor</span></div>
        <div className="anchor-node agent-node"><span className="agent-core" /><span className="node-label">{hasPolicy ? 'Agent' : 'No active agent'}</span></div>
      </div>
      <div className="session-bottom"><div className="anchor-list">{snapshot.policy.recipients.length ? snapshot.policy.recipients.map((address) => <span className="recipient" key={address} title={address}><span className="recipient-dot" aria-hidden="true" /><span className="mono">{short(address)}</span></span>) : <span className="muted">No active recipients</span>}</div><div className="session-actions">{onLockOut && snapshot.active ? <button className="secondary" disabled={lockDisabled} onClick={onLockOut}><TechnicalIcon kind="lock" />Review freeze</button> : onManage ? <button className="secondary" onClick={onManage}>Manage vault</button> : null}</div></div>
      {snapshot.active && <p className="muted countdown-note">Time estimated from the last chain block. A session is permission, not evidence that a bot is running.</p>}
      </div>
    <aside className="vault-register" aria-label="Vault register">
      <h3>Verified contract state</h3><dl className="summary"><dt>Spendable now</dt><dd>{amount(spendable)} USDC</dd><dt>Session spent</dt><dd>{amount(snapshot.spent)} USDC</dd><dt>Session ID / nonce</dt><dd>{snapshot.sessionId.toString()} / {snapshot.nonce.toString()}</dd><dt>Owner wallet</dt><dd className="mono">{snapshot.owner}</dd>{hasPolicy && <><dt>Agent wallet</dt><dd className="mono">{snapshot.policy.agent}</dd></>}<dt>PQ public key</dt><dd className="mono">{snapshot.publicKey}</dd>{hasPolicy && <><dt>Session expires</dt><dd className="mono">{new Date(Number(snapshot.policy.expiresAt) * 1000).toLocaleString()}</dd></>}</dl>
    </aside>
    </div></details>
  </div>;
}
