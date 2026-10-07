// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TransactionDrawer } from './TransactionDrawer';
let root:Root;let host:HTMLDivElement;let opener:HTMLButtonElement;const close=vi.fn();
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);opener=document.createElement('button');document.body.append(opener);opener.focus();root=createRoot(host);close.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();opener.remove();});
it('traps keyboard focus through visible controls and returns focus when closed',async()=>{
  await act(async()=>root.render(<TransactionDrawer open onClose={close}><details><summary>Details</summary><button>Hidden action</button></details><button disabled>Disabled action</button></TransactionDrawer>));
  const dialog=host.querySelector('[role="dialog"]') as HTMLElement;expect(document.activeElement).toBe(dialog);expect(document.body.style.overflow).toBe('hidden');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));expect(document.activeElement?.tagName).toBe('SUMMARY');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));expect(document.activeElement?.textContent).toBe('Close review panel');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(close).toHaveBeenCalledOnce();
  await act(async()=>root.render(<TransactionDrawer open={false} onClose={close}>Pending receipt</TransactionDrawer>));expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe('');
});
