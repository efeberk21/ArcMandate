// @vitest-environment happy-dom
import { act } from 'react';import { createRoot,type Root } from 'react-dom/client';import { Storage as TestStorage } from 'happy-dom';import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { AgentSetup } from './AgentSetup';import type { VaultSnapshot } from '../lib/chain';
vi.mock('../lib/chain',()=>({arcClient:()=>({getBalance:async()=>0n})}));
const owner='0x1111111111111111111111111111111111111111',agent='0x3333333333333333333333333333333333333333',vault='0x2222222222222222222222222222222222222222';
const snapshot:VaultSnapshot={chainId:5042002,address:vault,owner,publicKey:`0x${'aa'.repeat(32)}`,trusted:true,active:true,sessionId:1n,nonce:1n,spent:0n,balance:1_000_000n,blockNumber:100n,timestamp:1000n,policy:{agent,totalBudget:1_000_000n,perTxCap:100_000n,expiresAt:2000n,recipients:[owner]}};
let root:Root,host:HTMLDivElement;const copy=vi.fn();const storageKey=`arcmandate.cli-request.v1:${vault}`;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('localStorage',new TestStorage());Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy.mockResolvedValue(undefined)}});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,callback:()=>unknown)=>callback()}});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(value=snapshot){await act(async()=>root.render(<AgentSetup snapshot={value} agent="" onAgent={()=>{}} onGas={()=>{}} operations={[]} verifiedBlock="90"/>));}
async function mode(){await act(async()=>{const select=host.querySelector('select')!;select.value='cli';select.dispatchEvent(new Event('change',{bubbles:true}));});}
async function fill(label:string,value:string){await act(async()=>{const input=[...host.querySelectorAll('label')].find(el=>el.textContent?.startsWith(label))!.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(label:string){await act(async()=>{[...host.querySelectorAll('button')].find(el=>el.textContent===label)!.click();});}
it('pins the same CLI request on repeated copies and rebinds only an explicitly new request after session change',async()=>{
  await render();await mode();await fill('CLI payment recipient',owner);await fill('CLI payment amount','0.01');await click('Save request and copy payment command');const original=localStorage.getItem(storageKey);await click('Save request and copy payment command');expect(localStorage.getItem(storageKey)).toBe(original);expect(copy.mock.calls.at(-1)?.[0]).toContain(JSON.parse(original!).request);
  await render({...snapshot,sessionId:2n});expect(host.textContent).toContain('older session');await click('Start a different CLI payment request');await fill('CLI payment recipient',owner);await fill('CLI payment amount','0.02');await click('Save request and copy payment command');expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({session:'2',amount:'0.02'});expect(host.textContent).not.toContain('older session');
});
it('blocks copying excessive amounts and a stale request saved by another tab',async()=>{
  await render();await mode();await fill('CLI payment recipient',owner);await fill('CLI payment amount','0.2');expect(host.textContent).toContain('exceeds the per-payment');expect([...host.querySelectorAll('button')].some(el=>el.textContent==='Save request and copy payment command')).toBe(false);
  await fill('CLI payment amount','0.01');localStorage.setItem(storageKey,'another-tab');await click('Save request and copy payment command');expect(host.textContent).toContain('changed in another tab');expect(localStorage.getItem(storageKey)).toBe('another-tab');
});
it('keeps a damaged saved CLI request restricted until explicitly accounted for',async()=>{
  localStorage.setItem(storageKey,'broken');await render();await mode();expect(host.textContent).toContain('Saved CLI request is unreadable');expect([...host.querySelectorAll('button')].find(el=>el.textContent==='Start a different CLI payment request')?.disabled).toBe(true);expect(localStorage.getItem(storageKey)).toBe('broken');
});
