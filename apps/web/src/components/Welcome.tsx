import { BrandMark } from './BrandMark';

export function Welcome({ onCreate, onOpen, onContinue, vaultLabel, pending }: {
  onCreate(): void; onOpen(): void; onContinue(): void; vaultLabel?: string; pending: boolean;
}) {
  return <section className="welcome" aria-labelledby="welcome-heading">
    <div className="welcome-hero">
      <div className="welcome-copy">
        <span className="eyebrow">Welcome to ArcMandate</span>
        <h1 id="welcome-heading" tabIndex={-1}>Your money.<br/>Your agent.<br/><em>Your rules.</em></h1>
        <p className="welcome-lead">Give your agent room to work, with limits you control.</p>
        <p>Keep USDC in your own vault. Choose who your agent can pay, how much it can spend and when its access ends.</p>
        <div className="welcome-actions"><button onClick={onCreate}>Create a vault <span aria-hidden="true">↗</span></button><button className="secondary" onClick={onOpen}>Open an existing vault</button></div>
        {vaultLabel&&<button className="text-button welcome-continue" onClick={onContinue}>Continue to {vaultLabel} <span aria-hidden="true">→</span></button>}
        {pending&&<div className="inline-notice welcome-pending" role="alert"><p>A saved transaction still needs checking. Opening this page does not cancel it.</p><button className="text-button" onClick={onContinue}>View transaction recovery</button></div>}
      </div>
      <div className="welcome-vault" aria-hidden="true"><div className="welcome-orbit orbit-one"/><div className="welcome-orbit orbit-two"/><div className="welcome-orbit orbit-three"/><div className="welcome-anchor"><BrandMark/></div><span className="welcome-orbit-label">Permission with boundaries.</span></div>
    </div>
    <div className="welcome-principles">
      <article><span className="welcome-number">01</span><h2>Keep custody.</h2><p>Your vault holds the funds. A spending budget gives your agent permission, not ownership.</p></article>
      <article><span className="welcome-number">02</span><h2>Set the boundaries.</h2><p>Allowed recipients, a total budget, a per-payment cap and an expiry. You choose every limit.</p></article>
      <article><span className="welcome-number">03</span><h2>Stay in control.</h2><p>Freeze spending when needed. Your owner wallet and Vault Key authorize management.</p></article>
    </div>
    <p className="welcome-note">View an existing vault without connecting. Connect your wallet when you’re ready to manage it.</p>
  </section>;
}
