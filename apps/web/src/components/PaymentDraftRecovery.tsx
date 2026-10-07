import { useState } from 'react';
import { downloadText } from '../lib/files';
import { PAYMENT_DRAFT_KEY, repairPaymentDrafts } from '../lib/payment-drafts';
export function PaymentDraftRecovery({error,onRestored}:{error:string;onRestored():void}){
  const [raw]=useState(()=>{try{return localStorage.getItem(PAYMENT_DRAFT_KEY)??'[]';}catch{return '';}});const [replacement,setReplacement]=useState(raw);const [accounted,setAccounted]=useState(false);const [failure,setFailure]=useState('');
  return <section className="panel notice" role="alert"><h2>Recover payment requests</h2><p>{error}</p>
    <button className="secondary" onClick={()=>downloadText('arcmandate-payment-drafts-raw.json',raw)}>Export original drafts</button>
    <p>Restore a complete backup or correct the damaged fields. Every readable request must retain its ID, original session, payment ID, recipient and amount. Check the operation journal and wallet activity for unidentified requests. Keep uncertain submissions unresolved in operation history.</p>
    <label>Corrected payment drafts JSON<textarea rows={8} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={accounted} onChange={e=>setAccounted(e.target.checked)}/>I checked every damaged request and included every possible submission in operation history for receipt reconciliation.</label>
    <button onClick={()=>{void(async()=>{try{if(!navigator.locks)throw new Error('Web Locks support is required.');await navigator.locks.request('arcmandate-wallet-submit',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Finish the wallet request in another tab first.');await navigator.locks.request('arcmandate-operation-history',()=>navigator.locks.request('arcmandate-payment-drafts',()=>{if(localStorage.getItem(PAYMENT_DRAFT_KEY)!==raw)throw new Error('Drafts changed in another tab. Reload recovery first.');repairPaymentDrafts(raw,replacement,accounted,localStorage);onRestored();}));});}catch(cause){setFailure(cause instanceof Error?cause.message:String(cause));}})();}}>Validate and restore payment drafts</button>
    <p>The original is retained in quarantine. This does not cancel or resend transactions. A false accounting statement can cause duplicate payment.</p>{failure&&<p className="error">{failure}</p>}
  </section>;
}
