import type { TransactionState } from '../lib/transactions';
export function TransactionProgress({transaction}:{transaction:TransactionState}){
  const index=transaction.stage==='confirmed'||transaction.stage==='submitted'||transaction.stage==='reverted'||transaction.stage==='unknown'&&transaction.hash?3:transaction.stage==='wallet'||transaction.stage==='wallet-rejected'||transaction.stage==='ready'?2:['signing','simulating','simulation-rejected'].includes(transaction.stage)?1:0;
  return <ol className="transaction-progress" aria-label="Transaction steps">{['Review details','Authorization','Approve in wallet','Confirmation'].map((label,at)=><li key={label} aria-current={at===index?'step':undefined} className={at<index||transaction.stage==='confirmed'?'complete':at===index?'current':''}><span aria-hidden="true">{at<index||transaction.stage==='confirmed'?'✓':at+1}</span>{label}</li>)}</ol>;
}
