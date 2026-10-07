import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { KEYFILE_MAX_BYTES, parseKeyfile } from '@arcmandate/core/keyfile';
import type { PqKey } from '../lib/use-pq-key';
import { explainError } from '../lib/errors';
import { StatusBadge } from './SessionPlate';
export function KeyPanel({ pq, expectedKey, disabled, onChange }: { pq: PqKey; expectedKey?: Hex; disabled: boolean; onChange(): void }) {
  const [password,setPassword]=useState(''); const [exportPassword,setExportPassword]=useState(''); const [confirmation,setConfirmation]=useState('');
  const [error,setError]=useState(''); const [fileKey,setFileKey]=useState<Hex|null>(null); const [fileError,setFileError]=useState(''); const [checking,setChecking]=useState(false);
  const [flow,setFlow]=useState<'create'|'restore'>(expectedKey?'restore':'create');
  useEffect(()=>{if(expectedKey)setFlow('restore');},[expectedKey]);
  useEffect(() => { setPassword(''); setExportPassword(''); setConfirmation(''); setError(''); },[pq.lockVersion]);
  useEffect(() => {
    let current=true; setFileKey(null); setFileError(''); setChecking(!!pq.file);
    if (pq.file) void (async () => {
      if (pq.file!.size>KEYFILE_MAX_BYTES) throw new Error('Keyfile exceeds 16 KiB.');
      const metadata=parseKeyfile(await pq.file!.text());
      if (expectedKey && metadata.publicKey.toLowerCase()!==expectedKey.toLowerCase()) throw new Error('This backup belongs to a different Vault Key. Select the matching file.');
      if(current) setFileKey(metadata.publicKey);
    })().catch(cause=>{if(current)setFileError(explainError(cause).message);}).finally(()=>{if(current)setChecking(false);});
    return ()=>{current=false;};
  },[pq.file,expectedKey]);
  async function act(task:()=>Promise<void>) { setError(''); try{await task();}catch(cause){const info=explainError(cause);setError(`${info.message} ${info.advice}`);} }
  return <section className="panel key-panel" id="key-backup" aria-label="Vault Key backup">
    <div className="section-heading"><h2>Vault Key & backup</h2><StatusBadge label={pq.busy?'Checking':pq.phase==='restored'?'Unlocked / verified':pq.phase} tone={pq.phase==='restored'?'verified':'neutral'} /></div>
    <p>Use this key with your owner wallet to set spending limits and withdraw.</p>
    <p className="key-safety-note">Keep both the encrypted file and password. There is no reset if either is lost.</p>
    <details><summary>Why do I need this key?</summary><p>This is a second management signature, not an EVM wallet. It has no balance or gas fee. The owner can freeze without it. This immutable vault has no key rotation; losing either management key can prevent withdrawal.</p></details>
    {expectedKey && <p>Required Key ID: <strong className="mono">{expectedKey.slice(2,10)}</strong></p>}
    {pq.publicKey && <details><summary>Full public key / Key ID {pq.publicKey.slice(2,10)}</summary><p className="mono">{pq.publicKey}</p></details>}
    {!expectedKey&&pq.phase!=='restored'&&<div className="task-switcher" aria-label="Key setup method">{(['create','restore'] as const).map(item=><button className="secondary" key={item} aria-pressed={flow===item} onClick={()=>{setFlow(item);setPassword('');setExportPassword('');setConfirmation('');}}>{item==='create'?'Create a new key':'Use an existing backup'}</button>)}</div>}
    {!expectedKey&&pq.phase!=='restored'&&(flow==='create'||pq.phase==='generated')&&<ol className="key-steps" aria-label="Key setup steps"><li className={pq.phase==='generated'?'complete':'current'}>1. Create</li><li className={pq.phase==='generated'&&flow==='create'?'current':''}>2. Download</li><li className={flow==='restore'?'current':''}>3. Restore & verify</li></ol>}
    {!expectedKey && pq.phase==='locked' && <div className="notice" hidden={flow!=='create'}><h3>Create your Vault Key</h3><p>You’ll download and verify its backup before creating a vault.</p><button disabled={disabled||pq.busy} onClick={()=>{onChange();void act(pq.generate);}}>Create Vault Key</button></div>}
    {pq.phase!=='locked' && <details open={pq.phase==='generated'&&flow==='create'}><summary>{pq.phase==='generated'?'Encrypt and download backup':'Download another encrypted copy'}</summary>
      <label>New backup password (at least 12 characters)<input type="password" autoComplete="new-password" value={exportPassword} disabled={disabled||pq.busy} onChange={e=>setExportPassword(e.target.value)}/></label>
      <label>Confirm password for download<input type="password" autoComplete="new-password" value={confirmation} disabled={disabled||pq.busy} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button disabled={disabled||pq.busy} onClick={()=>{const pass=exportPassword,repeat=confirmation;setExportPassword('');setConfirmation('');void act(async()=>{await pq.exportKey(pass,repeat);setFlow('restore');});}}>Download encrypted backup</button></details>}
    <div hidden={!expectedKey&&flow!=='restore'&&pq.phase!=='restored'} className="key-restore-form">
    <h3>{pq.phase==='generated'?'3. Verify the file you downloaded':'Unlock from your encrypted backup'}</h3>
    <label className="file-field">Encrypted Vault Key backup<input type="file" accept=".json,application/json" disabled={disabled||pq.busy} onChange={e=>{onChange();setPassword('');pq.setFile(e.target.files?.[0]??null);}}/></label>
    {pq.file && <p className="muted">Selected backup: {pq.file.name}. The encrypted file is kept for this tab only; reload requires selecting it again.</p>}
    {checking && <p role="status">Checking backup format and public key…</p>}
    {fileKey && <p>File Key ID: <strong className="mono">{fileKey.slice(2,10)}</strong>. Format matches; decrypting and a fresh signature are still required.</p>}
    {fileError && <p className="error" role="alert">{fileError}</p>}
    <label>Existing backup password<input type="password" autoComplete="off" disabled={disabled||pq.busy||!!fileError} value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <button disabled={disabled||pq.busy||checking||!!fileError||!fileKey||!password} onClick={()=>{const pass=password;setPassword('');setConfirmation('');setExportPassword('');onChange();if(pq.file)void act(()=>pq.importKey(pq.file!,pass,expectedKey));}}>Restore and verify backup</button>
    </div>
    <button className="secondary" disabled={pq.phase==='locked'&&!pq.busy} onClick={()=>{onChange();pq.lock();}}>Lock Vault Key</button>
    <details><summary>Locking and automatic lock</summary><p>Locking closes the local signer. It does not freeze your onchain session or stop agent payments. The key locks after 30 minutes without activity.</p></details>
    <p className={error?'error':'key-status'} role={error?'alert':'status'}>{error||pq.message}</p>
  </section>;
}
