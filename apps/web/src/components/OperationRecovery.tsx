import { useState } from 'react';
import type { Hex } from 'viem';
import type { Operation } from '../lib/operations';
import { errorMessage } from '../lib/transactions';

export function OperationRecovery({ op, walletOpen, onAttach, onAcknowledge, onReconcile }: {
  op: Operation; walletOpen: boolean;
  onAttach(op: Operation, hash: Hex): Promise<void>;
  onAcknowledge(op: Operation): Promise<void>;
  onReconcile(op: Operation): Promise<void>;
}) {
  const [choice, setChoice] = useState<'hash' | 'statement' | null>(null);
  const [hash, setHash] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function act(task: () => Promise<void>) {
    setWorking(true); setError('');
    try { await task(); setChoice(null); } catch (cause) { setError(errorMessage(cause)); }
    finally { setWorking(false); }
  }
  return <div className="operation-recovery">
    <div className="actions">
      {op.hash && <button disabled={working} onClick={() => void act(() => onReconcile(op))}>Recheck saved receipt</button>}
      {!op.hash && !choice && <>
        <button disabled={working || walletOpen} onClick={() => setChoice('hash')}>Find transaction in wallet activity</button>
        <button className="secondary" disabled={working || walletOpen} onClick={() => setChoice('statement')}>No transaction was sent</button>
      </>}
    </div>
    {walletOpen && <p className="warning">A wallet request is still open. Approve or reject it in your wallet before reconciling this action.</p>}
    {choice === 'hash' && <div className="notice">
      <p>Check this sender on Arc {op.network} in your wallet’s Activity tab. Paste the hash of this exact action; an unrelated transaction cannot resolve it.</p>
      <label>Submitted transaction hash<input value={hash} placeholder="0x followed by 64 hex characters" onChange={e => setHash(e.target.value)} disabled={working} /></label>
      <button disabled={working || walletOpen} onClick={() => void act(async () => {
        const value = hash.trim();
        if (!/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Enter a complete transaction hash (0x followed by 64 hex characters).');
        await onAttach(op, value as Hex);
      })}>{working ? 'Checking transaction…' : 'Verify and attach hash'}</button>
      <button className="secondary" disabled={working} onClick={() => setChoice(null)}>Back</button>
    </div>}
    {choice === 'statement' && <div className="notice">
      <p>Check the sender’s wallet activity on this network first. This statement does not cancel a transaction onchain. If a transaction was sent, attach its hash instead.</p>
      <button className="secondary" disabled={working || walletOpen} onClick={() => void act(() => onAcknowledge(op))}>I checked wallet activity: no transaction was sent</button>
      <button className="secondary" disabled={working} onClick={() => setChoice(null)}>Back</button>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
