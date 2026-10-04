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
const labels: Record<SessionState, string> = { active: 'Active', locked: 'Locked', expired: 'Expired', exhausted: 'Exhausted', unanchored: 'Unanchored' };

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
    active: 'Your agent. Your boundaries.', locked: 'Authority is locked.', expired: 'The hold window is closed.',
    exhausted: 'The budget is used.', unanchored: 'Anchor your first agent.',
  };
  return <div className={`vault-instrument state-${state}`}>
    <section className="session-plate" aria-label="Anchored session">
      <div className="session-heading"><div className="session-identity"><h3>{titles[state]}</h3><p>{state === 'locked' ? 'Session epoch' : 'Session'} <span className="mono">{snapshot.sessionId.toString().padStart(4, '0')}</span></p></div><StatusBadge label={labels[state]} tone={usable ? 'rated' : hasSession ? 'overload' : 'neutral'} /></div>
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
      <div className="session-budget"><div><span className="plate-label">{hasPolicy ? 'Remaining session budget' : 'Spending authority'}</span><div className="load-value"><strong>{hasPolicy ? amount(remaining) : '0.00'}</strong><span>{hasPolicy ? `/ ${amount(snapshot.policy.totalBudget)} USDC` : 'USDC available'}</span></div></div>{hasPolicy && <span className="budget-fraction mono">{Math.round(ratio * 100)}% remaining</span>}</div>
      <dl className="session-specs"><div><dt>Per payment</dt><dd>{hasPolicy ? <>{amount(snapshot.policy.perTxCap)} <span>USDC</span></> : 'Cleared'}</dd></div><div><dt>Hold remaining</dt><dd>{state === 'locked' ? 'Closed' : state === 'unanchored' ? 'Not set' : hold}</dd></div><div><dt>Allowed recipients</dt><dd>{snapshot.policy.recipients.length} <span>{snapshot.policy.recipients.length === 1 ? 'address' : 'addresses'}</span></dd></div></dl>
      <div className="session-bottom"><div className="anchor-list">{snapshot.policy.recipients.length ? snapshot.policy.recipients.map((address) => <span className="recipient" key={address} title={address}><span className="recipient-dot" aria-hidden="true" /><span className="mono">{short(address)}</span></span>) : <span className="muted">No active recipients</span>}</div><div className="session-actions">{onLockOut && snapshot.active ? <button className="secondary" disabled={lockDisabled} onClick={onLockOut}><TechnicalIcon kind="lock" />Review lock out</button> : onManage ? <button className="secondary" onClick={onManage}>Manage vault</button> : null}</div></div>
      <p className="instrument-note">{state === 'locked' ? 'Authority revoked. Session limits and recipients were cleared onchain.' : state === 'expired' || state === 'exhausted' ? 'Spending unavailable. Lock out this onchain session before withdrawal.' : state === 'unanchored' ? 'Open a session to define the agent, budget, hold window and permitted recipients.' : 'The session budget is fixed. Deposits do not renew authority.'}</p>
      {snapshot.active && <p className="muted countdown-note">Hold time estimated from the last chain block.</p>}
    </section>
    <aside className="vault-register" aria-label="Vault register">
      <div className="balance-register"><span className="plate-label">Vault balance</span><strong>{amount(snapshot.balance)} <span>USDC</span></strong></div>
      <dl className="register-data"><div><dt>Spendable authority</dt><dd>{amount(spendable)} USDC</dd></div><div><dt>{hasPolicy ? 'Session spent' : 'Control nonce'}</dt><dd>{hasPolicy ? `${amount(snapshot.spent)} USDC` : snapshot.nonce.toString().padStart(4, '0')}</dd></div><div><dt>State at block</dt><dd>{snapshot.blockNumber.toString()}</dd></div></dl>
      <details className="key-register"><summary>Authorization details</summary><dl className="summary"><dt>Owner wallet</dt><dd className="mono">{snapshot.owner}</dd>{hasPolicy && <><dt>Agent wallet</dt><dd className="mono">{snapshot.policy.agent}</dd><dt>Control nonce</dt><dd className="mono">{snapshot.nonce.toString()}</dd></>}<dt>PQ public key</dt><dd className="mono">{snapshot.publicKey}</dd>{hasPolicy && <><dt>Hold expires</dt><dd className="mono">{new Date(Number(snapshot.policy.expiresAt) * 1000).toLocaleString()}</dd></>}</dl></details>
    </aside>
  </div>;
}
