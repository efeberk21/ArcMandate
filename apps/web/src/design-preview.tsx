import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionPlate, StatusBadge, TechnicalIcon } from './components/SessionPlate';
import type { VaultSnapshot } from './lib/chain';
import './styles.css';

type PreviewState = 'active' | 'locked' | 'expired' | 'exhausted' | 'unanchored';
function sample(state: PreviewState): VaultSnapshot {
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const cleared = state === 'locked' || state === 'unanchored';
  return {
    trusted: true,
    address: '0x1111111111111111111111111111111111111111', owner: '0x2222222222222222222222222222222222222222',
    publicKey: `0x${'12'.repeat(32)}`, sessionId: state === 'unanchored' ? 0n : state === 'locked' ? 15n : 14n,
    nonce: state === 'locked' ? 7n : 6n, active: !cleared, balance: 1000000n,
    blockNumber: 65000000n, timestamp, spent: cleared ? 0n : state === 'exhausted' ? 1000000n : 380000n,
    policy: {
      agent: cleared ? '0x0000000000000000000000000000000000000000' : '0x3333333333333333333333333333333333333333',
      totalBudget: cleared ? 0n : 1000000n, perTxCap: cleared ? 0n : 100000n,
      expiresAt: cleared ? 0n : state === 'expired' ? timestamp : timestamp + 2832n,
      recipients: cleared ? [] : ['0x4444444444444444444444444444444444444444', '0x5555555555555555555555555555555555555555'],
    },
  };
}

function DesignPreview() {
  const [state, setState] = useState<PreviewState>('active');
  const [snapshot, setSnapshot] = useState(() => sample('active'));
  function choose(next: PreviewState) { setState(next); setSnapshot(sample(next)); }
  function lock() {
    setState('locked');
    setSnapshot({ ...sample('locked'), balance: snapshot.balance, blockNumber: snapshot.blockNumber + 1n, sessionId: snapshot.sessionId + 1n, nonce: snapshot.nonce + 1n });
  }
  function pay() {
    if (state !== 'active') return;
    const spent = snapshot.spent + 50000n;
    if (spent >= snapshot.policy.totalBudget) setState('exhausted');
    setSnapshot({ ...snapshot, spent, balance: snapshot.balance - 50000n, blockNumber: snapshot.blockNumber + 1n });
  }
  return <main className="design-preview">
    <header className="preview-heading"><div><a className="brand" href="/"><span className="brand-mark"><TechnicalIcon kind="orbit" /></span><span>ArcMandate</span></a><p>Design preview / sample session data</p></div><StatusBadge label="Preview" /></header>
    <div className="preview-controls" aria-label="Sample session states">{(['active', 'locked', 'expired', 'exhausted', 'unanchored'] as const).map((name) => <button key={name} className="secondary" aria-pressed={state === name} onClick={() => choose(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}<button disabled={state !== 'active'} onClick={pay}>Preview 0.05 USDC payment</button></div>
    <SessionPlate snapshot={snapshot} onLockOut={lock} lockDisabled={state === 'locked' || state === 'unanchored'} />
    <p className="muted">Sample data only. Preview controls do not connect to a wallet or submit transactions.</p>
  </main>;
}

// Vite's production entry is index.html. This separate preview is development-only.
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<DesignPreview />);
