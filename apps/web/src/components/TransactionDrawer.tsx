import { useEffect, useRef, type ReactNode } from 'react';
export function TransactionDrawer({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary,input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])].filter(el => {
        if(el.hidden||el.closest('[hidden]'))return false;
        for(let parent=el.parentElement;parent&&parent!==dialog.current;parent=parent.parentElement){if(parent.tagName==='DETAILS'&&!parent.hasAttribute('open')&&parent.querySelector('summary')!==el)return false;}
        return true;
      });
      const first=controls[0], last=controls.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown',keydown);
    return () => { document.body.style.overflow=bodyOverflow; document.removeEventListener('keydown',keydown); if (previous?.isConnected) previous.focus(); };
  },[open]);
  if (!open) return null;
  return <div className="drawer-backdrop"><div ref={dialog} className="transaction-drawer" role="dialog" aria-modal="true" aria-label="Transaction review" tabIndex={-1}>
    <div className="drawer-header"><h2>Review transaction</h2><button className="secondary" onClick={onClose}>Close review panel</button></div>
    {children}<p className="muted">Closing this panel does not cancel a submitted transaction. Track it in Activity.</p>
  </div></div>;
}
