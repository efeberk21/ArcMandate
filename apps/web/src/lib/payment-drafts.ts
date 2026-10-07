import { bytesToHex, getAddress, isAddress, type Address, type Hex } from 'viem';
import type { VaultSnapshot } from './chain';
import type { Operation } from './operations';
export const PAYMENT_DRAFT_KEY='arcmandate.payment-drafts.v1';
export type PaymentDraft={ requestId:string; paymentId:Hex; chainId:5042002; account:Address; vault:Address; sessionId:string; recipient:Address; amount:string; createdAt:string };
type Store=Pick<Storage,'getItem'|'setItem'>;
export function loadPaymentDrafts(storage:Pick<Storage,'getItem'>=localStorage):PaymentDraft[]{
  const raw=storage.getItem(PAYMENT_DRAFT_KEY)??'[]';if(raw.length>512*1024)throw new Error('Payment draft history exceeds the supported size. Preserve the original before recovery.');const value=JSON.parse(raw);
  if(!Array.isArray(value)||value.length>500||value.some(d=> !d || Object.keys(d).some(key=>!['requestId','paymentId','chainId','account','vault','sessionId','recipient','amount','createdAt'].includes(key))||d.chainId!==5042002 || typeof d.requestId!=='string'||!d.requestId||d.requestId.length>80||typeof d.paymentId!=='string'||!/^0x[0-9a-f]{64}$/i.test(d.paymentId)||typeof d.account!=='string'||!isAddress(d.account)||typeof d.vault!=='string'||!isAddress(d.vault)||typeof d.recipient!=='string'||!isAddress(d.recipient)||typeof d.sessionId!=='string'||!/^\d+$/.test(d.sessionId)||BigInt(d.sessionId)>=2n**256n||typeof d.amount!=='string'||!/^\d+$/.test(d.amount)||BigInt(d.amount)<=0n||BigInt(d.amount)>=2n**256n||typeof d.createdAt!=='string'||!Number.isFinite(Date.parse(d.createdAt)))||new Set(value.map(d=>d.requestId)).size!==value.length||new Set(value.map(d=>`${d.vault.toLowerCase()}:${d.sessionId}:${d.paymentId.toLowerCase()}`)).size!==value.length) throw new Error('Payment drafts are damaged. Preserve browser storage and check wallet activity; a new request must not bypass an unknown payment.');
  return value;
}
export function repairPaymentDrafts(raw:string,replacement:string,accounted:boolean,storage:Pick<Storage,'setItem'>):PaymentDraft[]{
  const next=loadPaymentDrafts({getItem:()=>replacement});let rows:unknown;try{rows=JSON.parse(raw);}catch{rows=null;}
  let damaged=!Array.isArray(rows);for(const row of Array.isArray(rows)?rows:[]){let valid:PaymentDraft;try{valid=loadPaymentDrafts({getItem:()=>JSON.stringify([row])})[0];}catch{damaged=true;continue;}
    const restored=next.find(draft=>draft.requestId===valid.requestId);if(!restored||JSON.stringify(restored)!==JSON.stringify(valid))throw new Error('Recovery must preserve every readable payment request and its original intent.');
  }
  if(damaged&&!accounted)throw new Error('Account for every damaged request in wallet activity and the operation journal before restoring drafts.');
  storage.setItem(`arcmandate.payment-quarantine.${crypto.randomUUID()}`,JSON.stringify({raw,accounted,at:new Date().toISOString()}));storage.setItem(PAYMENT_DRAFT_KEY,JSON.stringify(next));return next;
}
export function savePaymentDraft(draft:PaymentDraft,storage:Store=localStorage):PaymentDraft[]{
  const existing=loadPaymentDrafts(storage); const prior=existing.find(d=>d.requestId===draft.requestId);
  if(prior && JSON.stringify(prior)!==JSON.stringify(draft)) throw new Error('This request is already bound to another payment. Retry its original intent or explicitly create a new request.');
  if(!prior){if(existing.length>=500)throw new Error('Payment draft history is full. Export and reconcile before another payment.');existing.push(draft);}
  storage.setItem(PAYMENT_DRAFT_KEY,JSON.stringify(existing));return existing;
}
export function newPaymentDraft(snapshot:VaultSnapshot,account:Address,recipient:Address,amount:bigint):PaymentDraft{
  return {requestId:crypto.randomUUID(),paymentId:bytesToHex(crypto.getRandomValues(new Uint8Array(32))),chainId:5042002,account:getAddress(account),vault:snapshot.address,sessionId:snapshot.sessionId.toString(),recipient,amount:amount.toString(),createdAt:new Date().toISOString()};
}
export function validatePayment(snapshot:VaultSnapshot,draft:PaymentDraft,operations:Operation[]):void{
  if(snapshot.address.toLowerCase()!==draft.vault.toLowerCase()||snapshot.sessionId.toString()!==draft.sessionId||snapshot.policy.agent.toLowerCase()!==draft.account.toLowerCase())throw new Error('Session changed. This request stays in its original session; reconcile it before creating a new payment.');
  if(!snapshot.active)throw new Error('SessionInactive');
  if(snapshot.timestamp>=snapshot.policy.expiresAt)throw new Error('SessionExpired');
  const amount=BigInt(draft.amount);
  if(!snapshot.policy.recipients.some(to=>to.toLowerCase()===draft.recipient.toLowerCase()))throw new Error('RecipientNotAllowed');
  if(amount>snapshot.policy.perTxCap)throw new Error('PerPaymentLimitExceeded');
  if(amount>snapshot.policy.totalBudget-snapshot.spent)throw new Error('BudgetExceeded');
  if(amount>snapshot.balance)throw new Error('InsufficientBalance');
  const attempts=operations.filter(op=>op.action==='agent-pay'&&op.requestId===draft.requestId);
  if(attempts.some(op=>op.stage==='confirmed'))throw new Error('PaymentAlreadyUsed: this request has a confirmed payment. Open its receipt.');
  if(attempts.some(op=>!['reverted','cancelled','wallet-rejected','simulation-rejected'].includes(op.stage)))throw new Error('This request is unresolved. Recheck its saved receipt; do not resend.');
}
