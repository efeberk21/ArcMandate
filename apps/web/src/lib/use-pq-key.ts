import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { KEYFILE_MAX_BYTES } from '@arcmandate/core/keyfile';
import { PqWorkerClient } from './pq-client';
import type { SigningIntent } from '../worker/pq.worker';

export function usePqKey() {
  const worker = useRef<PqWorkerClient | null>(null);
  const epoch = useRef(0);
  const [publicKey, setPublicKey] = useState<Hex | null>(null);
  const [phase, setPhase] = useState<'locked' | 'generated' | 'restored'>('locked');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Restore an encrypted backup to manage a vault.');

  const lock = useCallback(() => {
    epoch.current++;
    worker.current?.stop(); worker.current = null;
    setPublicKey(null); setPhase('locked'); setBusy(false);
    setMessage('Key locked. Restore your encrypted backup to sign again.');
  }, []);
  useEffect(() => () => { epoch.current++; worker.current?.stop(); }, []);

  async function generate() {
    lock();
    const current = epoch.current;
    setBusy(true); setMessage('Generating a PQ key…');
    try {
      worker.current = new PqWorkerClient();
      const response = await worker.current.request({ type: 'generate' });
      if (current !== epoch.current) return;
      if (response.type !== 'generated') throw new Error('Unexpected key response');
      setPublicKey(response.publicKey); setPhase('generated');
      setMessage('Download the encrypted backup, lock the key, then restore the file before deploying or funding.');
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
      link.href = url; link.download = 'arcmandate-keyfile.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage('Backup download requested. Keep the file and password, then lock and restore it.');
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
      worker.current = new PqWorkerClient();
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
    const response = await worker.current.request({ type: 'sign', intent });
    if (response.type !== 'signed') throw new Error('Unexpected signature response');
    return response;
  }

  return { publicKey, phase, busy, message, lock, generate, exportKey, importKey, sign };
}

export type PqKey = ReturnType<typeof usePqKey>;
