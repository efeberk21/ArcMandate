import { useState } from 'react';
import { formatUnits } from 'viem';
import { usdcInput } from '@arcmandate/core/policy';
import type { VaultSnapshot } from '../lib/chain';
import type { PaymentDraft } from '../lib/payment-drafts';
export function AgentConsole({snapshot,draft,disabled,reasons,onReview,onNew}:{snapshot:VaultSnapshot;draft:PaymentDraft|null;disabled:boolean;reasons:string[];onReview(recipient:string,amount:string):void;onNew():void}){
  const [to,setTo]=useState('');const [amount,setAmount]=useState('');
  const remaining=snapshot.policy.totalBudget>snapshot.spent?snapshot.policy.totalBudget-snapshot.spent:0n;
  let inputError='';
  if(!draft){try{if(!to)throw new Error('Choose an allowed recipient.');const units=usdcInput(amount);if(units>snapshot.policy.perTxCap)throw new Error('Amount exceeds the per-payment limit.');if(units>remaining)throw new Error('Amount exceeds the remaining budget.');if(units>snapshot.balance)throw new Error('Amount exceeds the vault balance.');}catch(cause){inputError=(cause as Error).message;}}
  return <section className="panel" id="agent-console"><span className="eyebrow">Vault → approved recipient</span><h2>Make an agent payment</h2><p>Connect the configured agent account. The vault pays the recipient; the agent pays the network fee. No Vault Key is needed.</p>
    {reasons.includes('Select the configured agent account in your wallet.')&&<p className="field-hint">If this page still shows the owner after switching accounts, open this site's account permissions in your wallet and select the agent. Check the connected address above before paying.</p>}
    <dl className="payment-limits"><div><dt>Per-payment limit</dt><dd>{formatUnits(snapshot.policy.perTxCap,6)} USDC</dd></div><div><dt>Remaining budget</dt><dd>{formatUnits(remaining,6)} USDC</dd></div><div><dt>Vault balance</dt><dd>{formatUnits(snapshot.balance,6)} USDC</dd></div></dl>
    {draft?<div className="notice"><h3>Saved payment request</h3><dl className="summary"><dt>Recipient</dt><dd className="mono">{draft.recipient}</dd><dt>Amount</dt><dd>{formatUnits(BigInt(draft.amount),6)} USDC</dd><dt>Original session</dt><dd>{draft.sessionId}</dd></dl><p>Retry keeps the original payment. A new session does not carry it forward.</p><details><summary>Payment request identifier</summary><p className="mono">{draft.requestId}</p></details></div>:<><label>Payment recipient<select value={to} onChange={e=>setTo(e.target.value)}><option value="">Choose an allowed recipient</option>{snapshot.policy.recipients.map(address=><option key={address} value={address}>{address}</option>)}</select></label><label>Payment amount (USDC)<input inputMode="decimal" placeholder="0.00" value={amount} aria-invalid={!!amount&&!!inputError} onChange={e=>setAmount(e.target.value)}/></label></>}
    <p className="field-hint">Review the recipient, amount and network fee before approving in your wallet.</p>
    <div className="actions"><button disabled={disabled||!!inputError} onClick={()=>onReview(draft?.recipient??to,draft?formatUnits(BigInt(draft.amount),6):amount)}>Review payment</button>
      {draft&&<button className="secondary" onClick={()=>{setTo('');setAmount('');onNew();}}>Start a different payment request</button>}</div>
    {reasons.length>0&&<ul className="warning">{reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
    {!disabled&&inputError&&<p className="field-hint" role="status">{inputError}</p>}
    <details><summary>Manual payments, retries and automation</summary><p>This page never starts a bot or pays in the background. Use one executor for this account; browser, CLI and different devices do not share all journals. Keep the original request when retrying an uncertain payment.</p></details>
  </section>;
}
