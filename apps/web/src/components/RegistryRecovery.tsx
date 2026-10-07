import { useState } from 'react';
import { downloadText } from '../lib/files';
import { REGISTRY_KEY, repairRegistry, updateRegistry, type VaultBookmark } from '../lib/vault-registry';
export function RegistryRecovery({onRestored}:{onRestored(items:VaultBookmark[]):void}){
  const [raw]=useState(()=>{try{return localStorage.getItem(REGISTRY_KEY)??'{"version":1,"vaults":[]}';}catch{return '';}});const [replacement,setReplacement]=useState(raw);const [error,setError]=useState('');
  return <details><summary>Recover the saved vault list</summary><button className="secondary" onClick={()=>downloadText('arcmandate-vault-list-raw.json',raw)}>Export original vault list</button><p>Paste a complete public list backup or correct its JSON. Readable bookmarks are kept, and the original is retained in quarantine. This does not repair operation history or unlock any payment.</p><label>Corrected vault list JSON<textarea rows={6} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label><button onClick={()=>{void updateRegistry(storage=>repairRegistry(raw,replacement,storage)).then(onRestored).catch(cause=>setError(cause instanceof Error?cause.message:String(cause)));}}>Validate and restore vault list</button>{error&&<p className="error">{error}</p>}</details>;
}
