// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { KeyPanel } from './KeyPanel';
import type { PqKey } from '../lib/use-pq-key';

it('starts a new vault with key creation even when an encrypted file remains from another vault',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const pq:PqKey={phase:'locked',publicKey:null,busy:false,message:'Locked',lockVersion:1,file:new File(['encrypted'],'previous-vault.json'),setFile:vi.fn(),lock:vi.fn(),generate:vi.fn(),exportKey:vi.fn(),importKey:vi.fn(),sign:vi.fn()};
  try {
    await act(async()=>root.render(<KeyPanel pq={pq} disabled={false} onChange={()=>{}}/>));
    const creation=[...host.querySelectorAll('button')].find(el=>el.textContent==='Create a new key')!;
    expect(creation.getAttribute('aria-pressed')).toBe('true');expect(host.querySelector('.key-restore-form')?.hasAttribute('hidden')).toBe(true);
    await act(async()=>{[...host.querySelectorAll('button')].find(el=>el.textContent==='Use an existing backup')!.click();});
    expect(host.querySelector('.key-restore-form')?.hasAttribute('hidden')).toBe(false);
    expect(host.textContent).toContain('Selected backup: previous-vault.json');
  } finally {await act(async()=>root.unmount());host.remove();}
});

it('clears password inputs on an external lock while displaying the retained encrypted file', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const pq: PqKey = { phase: 'restored', publicKey: `0x${'ab'.repeat(32)}`, busy: false, message: 'Restored', lockVersion: 1,
    file: new File(['encrypted'], 'my-vault-key.json'), setFile: vi.fn(), lock: vi.fn(), generate: vi.fn(), exportKey: vi.fn(), importKey: vi.fn(), sign: vi.fn() };
  try {
    await act(async () => root.render(<KeyPanel pq={pq} disabled={false} onChange={() => {}} />));
    const passwords = [...host.querySelectorAll<HTMLInputElement>('input[type=password]')];
    await act(async () => {
      for (const input of passwords) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'temporary password');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    expect(passwords.every(input => input.value === 'temporary password')).toBe(true);
    await act(async () => root.render(<KeyPanel pq={{ ...pq, phase: 'locked', lockVersion: 2 }} disabled={false} onChange={() => {}} />));
    expect([...host.querySelectorAll<HTMLInputElement>('input[type=password]')].every(input => input.value === '')).toBe(true);
    expect(host.textContent).toContain('Selected backup: my-vault-key.json');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
