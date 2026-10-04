import { useState } from 'react';
import type { Hex } from 'viem';
import type { PqKey } from '../lib/use-pq-key';
import { StatusBadge } from './SessionPlate';

export function KeyPanel({ pq, expectedKey, disabled, onChange }: { pq: PqKey; expectedKey?: Hex; disabled: boolean; onChange(): void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  async function act(task: () => Promise<void>) {
    setError('');
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <section className="panel key-panel" id="key-backup" aria-label="PQ key backup">
    <div className="section-heading"><h2><span className="section-index">02</span>Authorization key & backup</h2><StatusBadge label={pq.busy ? 'PENDING' : pq.phase === 'restored' ? 'VERIFIED' : pq.phase.toUpperCase()} tone={pq.phase === 'restored' && !pq.busy ? 'verified' : 'neutral'} /></div>
    <p>Keep your encrypted file and password. Losing either management key can prevent withdrawals. Using both keys on one device does not protect against a compromised device.</p>
    {pq.publicKey && <p className="mono">Public key: {pq.publicKey}</p>}
    <div className="actions">
      <button disabled={disabled || pq.busy || !!expectedKey} onClick={() => { onChange(); void pq.generate(); }}>Generate new PQ key</button>
      <button className="secondary" onClick={() => { onChange(); pq.lock(); setPassword(''); setConfirmation(''); }}>Lock key</button>
    </div>
    <div className="fields">
      <label>Backup password<input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label>Confirm password for export<input type="password" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
    </div>
    <button disabled={disabled || pq.busy || pq.phase === 'locked'} onClick={() => {
      const pass = password; const repeat = confirmation; setPassword(''); setConfirmation('');
      void act(() => pq.exportKey(pass, repeat));
    }}>Download encrypted backup</button>
    <label className="file-field">Encrypted keyfile<input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
    <button disabled={disabled || pq.busy || !file} onClick={() => {
      const pass = password; setPassword(''); setConfirmation(''); onChange();
      if (file) void act(() => pq.importKey(file, pass, expectedKey));
    }}>Restore and verify backup</button>
    <p className={error ? 'error' : 'key-status'} role={error ? 'alert' : 'status'}>{error || pq.message}</p>
  </section>;
}
