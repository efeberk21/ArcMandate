import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { KEYFILE_MAX_BYTES } from '@arcmandate/core/keyfile';
import { PqWorkerClient } from './pq-client';
import type { SigningIntent } from '../worker/pq.worker';
import { diagnostic } from './diagnostics';

export function usePqKey() {
  const worker = useRef<PqWorkerClient | null>(null);
  const epoch = useRef(0);
  const [publicKey, setPublicKey] = useState<Hex | null>(null);
  const [phase, setPhase] = useState<'locked' | 'generated' | 'restored'>('locked');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Vault Key locked locally.');
  const [lockVersion, setLockVersion] = useState(0);

  const lock = useCallback((reason?: string) => {
    diagnostic('worker-stop');
    epoch.current++;
    setLockVersion(value => value + 1);
    worker.current?.stop(); worker.current = null;
    setPublicKey(null); setPhase('locked'); setBusy(false);
    setMessage(`Vault Key locked${reason ? ` because ${reason}` : ''}. Locking does not revoke onchain spending permission. Restore your encrypted backup for management.`);
  }, []);
  useEffect(() => () => { epoch.current++; worker.current?.stop(); }, []);
  useEffect(() => {
    if (phase === 'locked' || busy) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => lock('30 minutes passed without activity'), 30 * 60 * 1000); };
    reset(); window.addEventListener('pointerdown', reset); window.addEventListener('keydown', reset);
    return () => { clearTimeout(timer); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset); };
  }, [phase, busy, lock]);

  async function generate() {
    lock();
    const current = epoch.current;
    setBusy(true); setMessage('Generating a PQ key…');
    try {
      diagnostic('worker-start'); worker.current = new PqWorkerClient();
      const response = await worker.current.request({ type: 'generate' });
      if (current !== epoch.current) return;
      if (response.type !== 'generated') throw new Error('Unexpected key response');
      setPublicKey(response.publicKey); setPhase('generated');
      setMessage('Download the encrypted backup, then select and restore the downloaded file. Restore starts a fresh Worker and proves recovery before deploying or funding.');
    } catch (error) { if (current === epoch.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (current === epoch.current) setBusy(false); }
  }

  async function exportKey(password: string, confirmation: string) {
    if (password.length < 12) throw new Error('Use at least 12 characters for your backup password');
    if (password !== confirmation) throw new Error('Passwords do not match');
    if (!worker.current || !publicKey) throw new Error('Generate or restore a key first');
    setBusy(true);
    const current = epoch.current;
    try {
      setMessage('Encrypting your backup…');
      const response = await worker.current.request({ type: 'export', password });
      if (current !== epoch.current) return;
      if (response.type !== 'exported') throw new Error('Unexpected export response');
      const url = URL.createObjectURL(new Blob([response.keyfile], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `arcmandate-key-${publicKey.slice(2, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage('Backup download requested. Keep the file and password, then select the downloaded file and restore it.');
    } finally { if (current === epoch.current) setBusy(false); }
  }

  async function importKey(file: File, password: string, expectedPublicKey?: Hex) {
    lock();
    if (file.size > KEYFILE_MAX_BYTES) throw new Error('Keyfile exceeds 16 KiB');
    const current = epoch.current;
    setBusy(true); setMessage('Restoring the file and testing a fresh signature…');
    try {
      const json = await file.text();
      if (current !== epoch.current) return;
      diagnostic('worker-start'); worker.current = new PqWorkerClient();
      const response = await worker.current.request({ type: 'import', keyfile: json, password, expectedPublicKey });
      if (current !== epoch.current) return;
      if (response.type !== 'imported') throw new Error('Unexpected restore response');
      setPublicKey(response.publicKey); setPhase('restored');
      setMessage(`Backup restored and signing checked (${response.proofMs} ms).`);
    } catch (error) {
      if (current === epoch.current) { worker.current?.stop(); worker.current = null; setMessage(error instanceof Error ? error.message : String(error)); }
      throw error;
    } finally { if (current === epoch.current) setBusy(false); }
  }

  async function sign(intent: SigningIntent) {
    if (!worker.current || phase !== 'restored') throw new Error('Restore the encrypted backup before signing');
    const current=epoch.current;setBusy(true);
    try{const response = await worker.current.request({ type: 'sign', intent });
      if(current!==epoch.current)throw new Error('Vault Key was locked while signing. Review again.');
      if (response.type !== 'signed') throw new Error('Unexpected signature response');
      return response;
    }finally{if(current===epoch.current)setBusy(false);}
  }

  const [file, setSelectedFile] = useState<File | null>(null);
  const setFile = useCallback((next: File | null) => {
    lock('you changed the selected backup');
    setSelectedFile(next);
  }, [lock]);

  return { publicKey, phase, busy, message, lockVersion, file, setFile, lock, generate, exportKey, importKey, sign };
}

export type PqKey = ReturnType<typeof usePqKey>;
