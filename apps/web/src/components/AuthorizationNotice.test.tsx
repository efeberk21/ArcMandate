// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthorizationNotice } from './AuthorizationNotice';
import { canSubmitOperation, type Operation } from '../lib/operations';
let host: HTMLDivElement, root: Root;
const op: Operation = { id:'pending-start', network:'testnet', action:'start', account:'0x1111111111111111111111111111111111111111', vault:'0x3333333333333333333333333333333333333333', dataHash:`0x${'ab'.repeat(32)}`, stage:'wallet', createdAt:'2026-10-07T12:00:00Z', authorizationDeadline:'1791374460' };
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
it('changes an open wallet reminder into an expiry warning without clearing duplicate protection',async()=>{
  await act(async()=>root.render(<AuthorizationNotice operation={op}/>));
  expect(host.textContent).toContain('Time-limited wallet approval');
  await act(async()=>vi.advanceTimersByTime(65000));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Signing authorization expired');
  expect(host.textContent).toContain('reject it');expect(host.textContent).toContain('network fee');
  expect(canSubmitOperation('start','testnet',op.account,op.vault,[op])).toBe(false);
});
it('keeps a submitted transaction unresolved after the deadline and directs receipt reconciliation',async()=>{
  vi.setSystemTime(new Date('2026-10-07T12:02:00Z'));
  const submitted={...op,stage:'submitted' as const,hash:`0x${'cd'.repeat(32)}` as const};
  await act(async()=>root.render(<AuthorizationNotice operation={submitted}/>));
  expect(host.textContent).toContain('may already have executed');expect(host.textContent).toContain('Check its receipt');
  expect(host.textContent).not.toContain('reject it');
  expect(canSubmitOperation('start','testnet',op.account,op.vault,[submitted])).toBe(false);
});
it('does not invent deadlines for old journals or warn on resolved receipts',async()=>{
  await act(async()=>root.render(<AuthorizationNotice operation={{...op,authorizationDeadline:undefined}}/>));expect(host.textContent).toBe('');
  await act(async()=>root.render(<AuthorizationNotice operation={{...op,stage:'confirmed'}}/>));expect(host.textContent).toBe('');
  await act(async()=>root.render(<AuthorizationNotice operation={{...op,authorizationDeadline:(2n**256n-1n).toString()}}/>));expect(host.textContent).toContain('Unix timestamp');
});
