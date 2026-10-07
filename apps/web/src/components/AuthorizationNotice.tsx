import { useEffect, useState } from 'react';
import { unresolvedOperation, type Operation } from '../lib/operations';

export function AuthorizationNotice({ operation }: { operation: Operation }) {
  const deadline = operation.authorizationDeadline;
  const pending = unresolvedOperation(operation);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!deadline || !pending) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [deadline, pending]);
  if (!deadline || !pending) return null;
  const timestamp = Number(deadline) * 1000;
  const date = new Date(timestamp);
  const label = Number.isSafeInteger(timestamp) && Number.isFinite(date.getTime())
    ? date.toLocaleString() : `Unix timestamp ${deadline}`;
  const expired = BigInt(deadline) <= BigInt(Math.floor(now / 1000));
  if (operation.hash) return <p className="warning" role="status">Signing authorization deadline: {label}. {expired ? 'That time has passed on this device’s clock. ' : ''}The transaction may already have executed. Check its receipt before retrying; the deadline alone does not determine its outcome.</p>;
  return <div className={expired ? 'inline-notice warning' : 'inline-notice'} role={expired ? 'alert' : 'status'}>
    <p><strong>{expired ? 'Signing authorization expired.' : 'Time-limited wallet approval.'}</strong> Deadline: {label}.</p>
    <p>{expired
      ? 'If this request is still open in your wallet, reject it. Approving an expired authorization can revert and cost a network fee. Reconcile this saved operation before reviewing again.'
      : 'Approve before this time. If the request is still open after the deadline, reject it and review again with a fresh signature.'}</p>
    <p className="field-hint">This reminder uses your device’s clock. Expiry does not cancel a transaction or clear its pending record.</p>
  </div>;
}
