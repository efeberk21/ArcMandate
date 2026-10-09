import { useState } from 'react';
import { downloadText } from '../lib/files';
import { inspectHistory, OPERATION_KEY, repairHistory } from '../lib/history-recovery';
import type { Operation } from '../lib/operations';
export function HistoryRecovery({onRestored}:{onRestored(operations:Operation[]):void}){
  const [raw]=useState(()=>{try{return localStorage.getItem(OPERATION_KEY)??'[]';}catch{return '';}});
  const [replacement,setReplacement]=useState(raw);const [accounted,setAccounted]=useState(false);const [error,setError]=useState('');
  const inspection=inspectHistory(raw);
  return <section className="panel notice" id="history-recovery"><h2>Recover operation history</h2>
    <p>{inspection.valid.length} readable records · {inspection.invalid} damaged or unidentified records. Sending remains restricted. A vault-list import cannot reconcile this history.</p>
    <button className="secondary" onClick={()=>downloadText('arcmandate-operation-history-raw.json',raw)}>Export original history</button>
    <details><summary>Readable records</summary>{inspection.valid.map(op=><p key={op.id}>{op.action} · {op.stage} · <span className="mono">{op.account} {op.hash}</span></p>)}</details>
    <p>Repair the damaged fields or restore a complete known backup. Preserve every readable pending record. Check every possible sender's activity on every network represented in this journal, including transactions with missing hashes. Unknown outcomes must remain pending; a local statement is not an onchain cancellation.</p>
    <label>Corrected operation history JSON<textarea rows={8} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>
    <label className="checkbox-label"><input type="checkbox" checked={accounted} onChange={e=>setAccounted(e.target.checked)}/>I checked wallet activity for all damaged/unidentified records and included every possibly submitted operation in the corrected history.</label>
    <button onClick={()=>{void (async()=>{try{if(!navigator.locks)throw new Error('Web Locks support is required.');await navigator.locks.request('arcmandate-wallet-submit',{ifAvailable:true},async lock=>{if(!lock)throw new Error('Finish the open wallet request in another tab first.');await navigator.locks.request('arcmandate-operation-history',()=>{if(localStorage.getItem(OPERATION_KEY)!==raw)throw new Error('History changed in another tab. Reload the recovery view.');onRestored(repairHistory(raw,replacement,accounted,localStorage));});});}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}})();}}>Validate and restore corrected history</button>
    <p>The original is saved in quarantine before replacement. This does not cancel or resend any transaction. An incorrect accounting statement can cause duplicate payments; keep uncertain operations unresolved.</p>
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
