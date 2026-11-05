import type { CSSProperties } from 'react';
import { BrandMark } from './BrandMark';

/** The four limits a vault places on its agent, set around the mark like bodies on an orbit. */
const boundaries = [
  { label: 'Total budget', angle: -58 },
  { label: 'Per-payment cap', angle: 28 },
  { label: 'Allowed recipients', angle: 152 },
  { label: 'Expiry', angle: 218 },
];

function MandateOrbit() {
  return <div className="mandate-orbit" aria-hidden="true">
    <div className="mandate-halo"/>
    <svg className="mandate-rings" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="mandate-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc39c"/>
          <stop offset=".55" stopColor="#ff8a45"/>
          <stop offset="1" stopColor="#ff8a45" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <circle className="ring-boundary" cx="200" cy="200" r="190"/>
      <circle className="ring-track" cx="200" cy="200" r="140"/>
      <circle className="ring-inner" cx="200" cy="200" r="92"/>
      <g className="ring-sweep"><circle cx="200" cy="200" r="140" pathLength="100" stroke="url(#mandate-arc)" strokeDasharray="34 66"/></g>
      <g className="ring-sweep reverse"><circle cx="200" cy="200" r="92" pathLength="100" strokeDasharray="12 88"/></g>
      <g className="ring-satellite"><circle cx="200" cy="10" r="3"/></g>
      <g className="ring-satellite slow"><circle cx="200" cy="60" r="2.5"/></g>
    </svg>
    {boundaries.map(item => <span key={item.label} className="mandate-limit" style={{ '--angle': `${item.angle}deg` } as CSSProperties}><i/>{item.label}</span>)}
    <div className="mandate-mark"><BrandMark/></div>
    <span className="mandate-caption">Permission with boundaries</span>
  </div>;
}

export function Welcome({ onCreate, onOpen, onContinue, vaultLabel, pending }: {
  onCreate(): void; onOpen(): void; onContinue(): void; vaultLabel?: string; pending: boolean;
}) {
  return <section className="welcome" aria-labelledby="welcome-heading">
    <div className="welcome-hero">
      <div className="welcome-copy">
        <span className="eyebrow">Welcome to ArcMandate</span>
        <h1 id="welcome-heading" tabIndex={-1}>Your money.<br/>Your agent.<br/><em>Your rules.</em></h1>
        <p className="welcome-lead">Schedule USDC payments, with limits you control.</p>
        <p>Choose who to pay, how much and when. Your payment agent follows the schedule while your vault enforces the spending limits—even when this site is closed.</p>
        <div className="welcome-actions"><button onClick={onCreate}>Create a vault <span aria-hidden="true">↗</span></button><button className="secondary" onClick={onOpen}>Open an existing vault</button></div>
        {vaultLabel&&<button className="text-button welcome-continue" onClick={onContinue}>Continue to {vaultLabel} <span aria-hidden="true">→</span></button>}
        {pending&&<div className="inline-notice welcome-pending" role="alert"><p>A saved transaction still needs checking. Opening this page does not cancel it.</p><button className="text-button" onClick={onContinue}>View transaction recovery</button></div>}
      </div>
      <MandateOrbit/>
    </div>
    <div className="welcome-principles">
      <article><span className="welcome-number">01</span><h2>Fund your vault.</h2><p>Your vault holds the USDC. The service manages a separate payment account with only the authority you grant.</p></article>
      <article><span className="welcome-number">02</span><h2>Set the boundaries.</h2><p>Allowed recipients, a total budget, a per-payment cap and an expiry. You choose every limit.</p></article>
      <article><span className="welcome-number">03</span><h2>Stay in control.</h2><p>Freeze spending when needed. Your owner wallet and Vault Key authorize management.</p></article>
    </div>
    <p className="welcome-note">View an existing vault without connecting. Connect your wallet when you’re ready to manage it.</p>
  </section>;
}
