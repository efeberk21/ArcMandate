// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storage as TestStorage } from 'happy-dom';
import { getAddress, type Address, type Hex } from 'viem';
import { startSessionDigest } from '@arcmandate/core/digest';
import { expectedVaultRuntime } from '@arcmandate/core/runtime';
import type { SigningIntent } from './worker/pq.worker';
import type { VaultSnapshot } from './lib/chain';

const mock = vi.hoisted(() => ({ read: vi.fn(), lock: vi.fn(), sign: vi.fn(), simulate: vi.fn(), events: new Map<string, (...args: unknown[]) => void>(), request: vi.fn(), tx:vi.fn(),receipt:vi.fn(),active:false,session:0n,nonce:0n,keyVersion:0,network:'testnet' as 'testnet'|'mainnet' }));
const owner = getAddress('0x1111111111111111111111111111111111111111');
const vault = getAddress('0x2222222222222222222222222222222222222222');
const agent = getAddress('0x3333333333333333333333333333333333333333');
const publicKey = `0x${'aa'.repeat(32)}` as Hex;
const snapshot: VaultSnapshot = { chainId:5042002, address: vault, owner, publicKey, sessionId: 0n, nonce: 0n, active: false, spent: 0n, balance: 3_000_000n, blockNumber: 100n, timestamp: 1_791_284_400n, trusted: true,
  policy: { agent, totalBudget: 0n, perTxCap: 0n, expiresAt: 0n, recipients: [] } };
vi.mock('./lib/release',async importOriginal=>{const actual=await importOriginal<typeof import('./lib/release')>();return {...actual,get releaseNetwork(){return mock.network;}};});
vi.mock('./lib/chain', async importOriginal => {
  const actual = await importOriginal<typeof import('./lib/chain')>();
  const client = {
    chain:{get id(){return mock.network==='mainnet'?5042:5042002;}},
    getChainId: async () => mock.network==='mainnet'?5042:5042002, getBlockNumber: async () => 100n,
    getBalance: async () => 10n ** 18n, getBlock: async () => ({ number: 100n, timestamp: 1_791_284_400n }),
    getContractEvents: async () => [], estimateGas: async () => 100000n, getGasPrice: async () => 1n,
    getTransaction:mock.tx,waitForTransactionReceipt:mock.receipt,
    getBytecode:async()=>expectedVaultRuntime(owner,publicKey),
    readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === 'startSessionDigest') return startSessionDigest({ chainId: mock.network==='mainnet'?5042n:5042002n, vault, owner }, args[0] as never, args[1] as never);
      return functionName === 'active' ? mock.active : functionName==='sessionId'?mock.session:functionName==='controlNonce'?mock.nonce:functionName==='usedPaymentIds'?false:0n;
    },
  };
  return { ...actual, readVault: mock.read, arcClient: () => client, simulate: mock.simulate };
});
vi.mock('./lib/use-pq-key', () => ({ usePqKey: () => ({ phase: 'restored', publicKey: `0x${'aa'.repeat(32)}`, busy: false, message: 'Restored', lockVersion: mock.keyVersion,
  lock: mock.lock, sign: mock.sign, file: null, setFile: vi.fn(), generate: vi.fn(), exportKey: vi.fn(), importKey: vi.fn() }) }));
import App from './App';
import { SimulationRejected } from './lib/transactions';

let root: Root; let host: HTMLDivElement;
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent === text||item.getAttribute('aria-label')===text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
function field(text: string) {
  const found = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith(text))?.querySelector('input,textarea,select');
  if (!found) throw new Error(`Missing field: ${text}`);
  return found as HTMLInputElement;
}
async function fill(text: string, value: string) {
  await act(async () => {
    const input = field(text);
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function chooseDuration(value: string) {
  await act(async () => { const select = field('Session duration'); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function prepareSession() {
  await fill('Agent wallet', agent); await fill('Session budget', '1'); await fill('Per payment cap', '0.1'); await fill('Allowed recipients', owner);
  await click('Review open session');
}
beforeEach(async () => {
  vi.clearAllMocks(); mock.events.clear();
  mock.network='testnet';mock.active=false;mock.session=0n;mock.nonce=0n;mock.keyVersion=0;
  vi.stubGlobal('localStorage', new TestStorage());
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name:string,options:unknown,callback?: (lock:unknown)=>unknown)=>typeof options==='function'?(options as (lock:unknown)=>unknown)({}):callback?.({})}});
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', `/?network=testnet&vault=${vault}`);
  mock.read.mockResolvedValue(snapshot);
  mock.request.mockImplementation(async ({ method }) => method === 'eth_accounts' ? [owner] : method === 'eth_chainId' ? '0x4cef52' : '0x0');
  window.ethereum = { request: mock.request, on: (name, listener) => { mock.events.set(name, listener); }, removeListener: name => { mock.events.delete(name); } };
  mock.sign.mockImplementation(async (intent: SigningIntent) => ({ type: 'signed', signature: '0x1234', signingMs: 1,
    digest: intent.action === 'START_SESSION' ? startSessionDigest(intent.context, intent.policy, intent.auth) : '0x' }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<App />); });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); delete window.ethereum; });

describe('vault and review integration', () => {
  it('requests mainnet during explicit connection and verifies the wallet after its chain event without sending',async()=>{
    mock.network='mainnet';
    localStorage.setItem('arcmandate.wallet-disconnected.v1','true');
    window.history.replaceState(null,'','/?network=mainnet&setup=1');
    let chain='0x4cef52';
    mock.request.mockImplementation(async({method,params})=>{
      if(method==='eth_requestAccounts'||method==='eth_accounts')return[owner];
      if(method==='eth_chainId')return chain;
      if(method==='wallet_switchEthereumChain'){
        expect(params).toEqual([{chainId:'0x13b2'}]);
        chain='0x13b2';mock.events.get('chainChanged')?.(chain);return null;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    await click('Connect the required wallet');
    expect(button('Review vault creation').disabled).toBe(false);
    expect(host.querySelector('.inline-notice')).toBeNull();
    expect(mock.request.mock.calls.every(call=>['eth_requestAccounts','eth_accounts','eth_chainId','wallet_switchEthereumChain'].includes(call[0].method))).toBe(true);
  });
  it.each(['rejected','unchanged'])('keeps mainnet creation blocked when the wallet switch is %s',async(outcome)=>{
    mock.network='mainnet';
    localStorage.setItem('arcmandate.wallet-disconnected.v1','true');
    window.history.replaceState(null,'','/?network=mainnet&setup=1');
    mock.request.mockImplementation(async({method})=>{
      if(method==='eth_requestAccounts'||method==='eth_accounts')return[owner];
      if(method==='eth_chainId')return'0x4cef52';
      if(method==='wallet_switchEthereumChain'){
        if(outcome==='rejected')throw Object.assign(new Error('User rejected network switch'),{code:4001});
        return null;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    await click('Connect the required wallet');
    expect(button('Review vault creation').disabled).toBe(true);
    expect(host.querySelector('.error')?.textContent).toContain(outcome==='rejected'?'rejected':'Arc Mainnet');
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });
  it('does not reinterpret an explicit testnet link or pending journal on a mainnet build',async()=>{
    mock.network='mainnet';mock.read.mockClear();
    const saved=JSON.stringify([{id:'testnet-pending',network:'testnet',action:'agent-gas',account:owner,vault,dataHash:`0x${'ab'.repeat(32)}`,stage:'unknown',createdAt:new Date().toISOString(),walletNonce:7}]);
    localStorage.setItem('arcmandate.operations.v1',saved);
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    expect(host.querySelector('.masthead')?.textContent).toContain('Arc Mainnet');
    expect(new URL(window.location.href).searchParams.has('vault')).toBe(false);
    expect(mock.read).not.toHaveBeenCalled();
    expect(host.querySelector('.pending-summary')).toBeNull();
    expect(localStorage.getItem('arcmandate.operations.v1')).toBe(saved);
    expect(host.textContent).toContain('Switch to Arc Mainnet');
  });
  it('prepares mainnet owner plus PQ authorization without requesting wallet submission',async()=>{
    mock.network='mainnet';mock.read.mockResolvedValue({...snapshot,chainId:5042});
    mock.request.mockImplementation(async({method})=>method==='eth_accounts'?[owner]:method==='eth_chainId'?'0x13b2':'0x0');
    window.history.replaceState(null,'',`/?network=mainnet&vault=${vault}`);
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    await prepareSession();await click('Authorize with Vault Key');
    expect(host.querySelector('.transaction-drawer')?.textContent).toContain('Arc Mainnet');
    expect(mock.sign.mock.calls.at(-1)?.[0].context.chainId).toBe(5042n);
    expect(button('Open session in wallet').disabled).toBe(false);
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });

  it('opens the welcome page at the root and resumes the remembered vault only on request',async()=>{
    localStorage.setItem('arcmandate.vault-selection.v1',JSON.stringify({network:'testnet',address:vault,setup:false}));
    window.history.replaceState(null,'','/');await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    expect(host.querySelector('.welcome')).not.toBeNull();expect((host.querySelector('.workspace') as HTMLElement).hidden).toBe(true);
    expect(new URL(window.location.href).searchParams.has('vault')).toBe(false);
    await act(async()=>{(host.querySelector('.welcome-continue') as HTMLButtonElement).click();});
    expect(host.querySelector('.welcome')).toBeNull();expect((host.querySelector('.workspace') as HTMLElement).hidden).toBe(false);
    expect(new URL(window.location.href).searchParams.get('vault')).toBe(vault);
  });
  it('keeps unresolved operations visible on home without changing their journal',async()=>{
    const saved=JSON.stringify([{id:'pending-home',network:'testnet',action:'agent-gas',account:owner,vault,dataHash:`0x${'ab'.repeat(32)}`,stage:'unknown',createdAt:new Date().toISOString(),walletNonce:7}]);
    localStorage.setItem('arcmandate.operations.v1',saved);
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    await act(async()=>{(host.querySelector('.brand') as HTMLAnchorElement).click();});
    expect(host.querySelector('.welcome')?.textContent).toContain('A saved transaction still needs checking');
    expect(localStorage.getItem('arcmandate.operations.v1')).toBe(saved);
    await click('View transaction recovery');expect(host.querySelector('#tab-activity')?.getAttribute('aria-selected')).toBe('true');
    expect(localStorage.getItem('arcmandate.operations.v1')).toBe(saved);
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });

  it('keeps recovery reachable from Agent without expanding it above the selected task',async()=>{
    const saved=JSON.stringify([{id:'pending-nav',network:'testnet',action:'agent-gas',account:owner,vault,dataHash:`0x${'ab'.repeat(32)}`,stage:'unknown',createdAt:new Date().toISOString(),walletNonce:7}]);
    localStorage.setItem('arcmandate.operations.v1',saved);
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    await click('Agent & session');
    expect(host.querySelector('.pending-summary')?.textContent).toContain('A saved transaction needs checking');
    expect(host.querySelector('#pending-operations')).toBeNull();
    await click('View transaction recovery');
    expect(host.querySelector('#tab-activity')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('#pending-operations')?.textContent).toContain('Outcome unknown');
    expect(localStorage.getItem('arcmandate.operations.v1')).toBe(saved);
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });

  it('selects an authorized second account, locks the key and resumes that explicit choice after reload', async () => {
    mock.request.mockImplementation(async ({ method }) => method === 'eth_accounts' ? [owner, agent] : method === 'eth_chainId' ? '0x4cef52' : '0x0');
    await click('Disconnect'); await click('Connect wallet'); mock.lock.mockClear();
    await act(async () => { const select = field('Account for this app'); select.value = agent; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(field('Account for this app').value).toBe(agent);
    expect(mock.lock).toHaveBeenCalled();
    expect(localStorage.getItem('arcmandate.wallet-account.v1')).toBe(agent);
    await act(async () => { root.unmount(); root = createRoot(host); root.render(<App />); });
    expect(field('Account for this app').value).toBe(agent);
    mock.request.mockImplementation(async ({ method }) => method === 'eth_accounts' ? [owner] : method === 'eth_chainId' ? '0x4cef52' : '0x0');
    await act(async () => { mock.events.get('accountsChanged')!([owner]); });
    expect(field('Account for this app').value).toBe('');
    expect(host.querySelector('#wallet-menu')?.textContent).toContain('Wallet not connected');
    expect(mock.request.mock.calls.some(call => call[0].method === 'eth_sendTransaction')).toBe(false);
  });
  it('keeps one task navigation and preserves form drafts across task switches',async()=>{
    expect(host.querySelectorAll('[role=tablist]')).toHaveLength(1);
    expect(host.querySelectorAll('[role=tab]')).toHaveLength(5);
    await click('Funds');await fill('Deposit amount','0.42');await click('Withdraw from vault');
    expect(field('Deposit amount').closest('[hidden]')).not.toBeNull();
    expect(field('Withdrawal amount').closest('[hidden]')).toBeNull();
    await click('Activity');await click('Funds');await click('Deposit to vault');
    expect(field('Deposit amount').value).toBe('0.42');
    expect(field('Deposit amount').closest('[hidden]')).toBeNull();
  });
  it('takes agent fee funding directly to its form and keeps key-free owner freeze available',async()=>{
    await click('Agent & session');await fill('Agent wallet',agent);await click('Add agent network fees');
    expect(host.querySelector('#panel-funds')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('#agent-gas')?.hasAttribute('hidden')).toBe(false);
    expect(field('Deposit amount').closest('[hidden]')).not.toBeNull();
    expect(host.querySelector('#freeze-session')).not.toBeNull();
  });
  it('preserves empty recipient rows while editing and enforces the five-row UI limit',async()=>{
    await click('Agent & session');await click('2 · Set limits');await fill('Recipient 1',owner);
    await click('Add recipient');expect(field('Recipient 2').value).toBe('');
    await fill('Recipient 2','0x33');expect(field('Recipient 1').value).toBe(owner);expect(field('Recipient 2').value).toBe('0x33');
    await click('Add recipient');await click('Add recipient');await click('Add recipient');
    expect(field('Recipient 5').value).toBe('');expect(button('Add recipient').disabled).toBe(true);
    await click('Remove recipient 2');expect(button('Add recipient').disabled).toBe(false);expect(field('Recipient 1').value).toBe(owner);
  });
  it('opens the creation-hash form directly from the recovery shortcut',async()=>{
    await click('Find a vault using its creation transaction');
    expect(host.querySelector('#saved-vault-tools')?.getAttribute('open')).not.toBeNull();
    expect(host.querySelector('#creation-lookup')?.getAttribute('open')).not.toBeNull();
  });
  async function connectAgent(){
    mock.active=true;mock.session=1n;mock.nonce=1n;
    mock.read.mockResolvedValue({...snapshot,active:true,sessionId:1n,nonce:1n,policy:{agent,totalBudget:1_000_000n,perTxCap:100_000n,expiresAt:snapshot.timestamp+86400n,recipients:[owner]}});
    mock.request.mockImplementation(async({method})=>method==='eth_accounts'?[agent]:method==='eth_chainId'?'0x4cef52':'0x0');
    await act(async()=>{mock.events.get('accountsChanged')!([agent]);});await click('Refresh state');await click('Agent & session');mock.sign.mockClear();
  }
  it('explains payment limits before review and permits correction without losing the recipient',async()=>{
    await connectAgent();await act(async()=>{const select=field('Payment recipient');select.value=owner;select.dispatchEvent(new Event('change',{bubbles:true}));});
    await fill('Payment amount','0.11');expect(button('Review payment').disabled).toBe(true);
    expect(host.querySelector('#agent-console')?.textContent).toContain('Amount exceeds the per-payment limit.');
    await fill('Payment amount','0.01');expect(field('Payment recipient').value).toBe(owner);expect(button('Review payment').disabled).toBe(false);
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });
  it('prepares an agent payment automatically without wallet submission and restores its original request after remount',async()=>{
    await connectAgent();await act(async()=>{const select=field('Payment recipient');select.value=owner;select.dispatchEvent(new Event('change',{bubbles:true}));});await fill('Payment amount','0.01');
    await click('Review payment');expect(host.textContent).toContain('Ready for wallet');expect(host.textContent).not.toContain('Simulate payment only');expect(mock.simulate).toHaveBeenCalled();
    expect(mock.sign).not.toHaveBeenCalled();expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
    const before=localStorage.getItem('arcmandate.payment-drafts.v1');expect(before).toContain('"sessionId":"1"');
    await act(async()=>{root.unmount();root=createRoot(host);root.render(<App/>);});
    expect(host.textContent).toContain('Saved payment request');expect(localStorage.getItem('arcmandate.payment-drafts.v1')).toBe(before);
  });
  it('keeps wallet submission unavailable when automatic preparation rejects the payment',async()=>{
    await connectAgent();await act(async()=>{const select=field('Payment recipient');select.value=owner;select.dispatchEvent(new Event('change',{bubbles:true}));});await fill('Payment amount','0.01');
    mock.simulate.mockRejectedValueOnce(new SimulationRejected('SessionInactive'));
    await click('Review payment');
    expect(host.textContent).toContain('Cannot proceed');expect(host.textContent).toContain('SessionInactive');
    expect([...host.querySelectorAll('button')].some(item=>item.textContent==='Send payment in wallet')).toBe(false);
    expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
    expect(localStorage.getItem('arcmandate.operations.v1')).toBeNull();
  });
  it('rejects a second tab draft after another tab has saved the original payment request',async()=>{
    await connectAgent();const other=document.createElement('div');document.body.append(other);const otherRoot=createRoot(other);
    try{
      await act(async()=>otherRoot.render(<App/>));
      const fillOther=async(label:string,value:string)=>act(async()=>{const input=[...other.querySelectorAll('label')].find(el=>el.textContent?.startsWith(label))!.querySelector('input,select')! as HTMLInputElement;const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});
      await fillOther('Payment recipient',owner);await fillOther('Payment amount','0.01');
      await act(async()=>{const select=field('Payment recipient');select.value=owner;select.dispatchEvent(new Event('change',{bubbles:true}));});await fill('Payment amount','0.01');await click('Review payment');
      await act(async()=>{[...other.querySelectorAll('button')].find(el=>el.textContent==='Review payment')!.click();});expect(other.textContent).toContain('changed in another tab');expect(JSON.parse(localStorage.getItem('arcmandate.payment-drafts.v1')!)).toHaveLength(1);expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
    }finally{await act(async()=>otherRoot.unmount());other.remove();}
  });
  it('records payment intent/nonce before approval and preserves unknown hash without a second send',async()=>{
    await connectAgent();await act(async()=>{const select=field('Payment recipient');select.value=owner;select.dispatchEvent(new Event('change',{bubbles:true}));});await fill('Payment amount','0.01');
    let submitted:any;const hash=`0x${'ab'.repeat(32)}`;
    mock.request.mockImplementation(async({method,params})=>{
      if(method==='eth_accounts')return[agent];if(method==='eth_chainId')return'0x4cef52';if(method==='eth_getTransactionCount')return'0x7';
      if(method==='eth_sendTransaction'){
        const saved=JSON.parse(localStorage.getItem('arcmandate.operations.v1')!)[0];expect(saved).toMatchObject({action:'agent-pay',walletNonce:7,stage:'wallet',sessionId:'1'});expect(saved.paymentId).toHaveLength(66);submitted=params[0];return hash;
      }throw new Error('Unexpected method');
    });
    mock.tx.mockImplementation(async()=>({from:agent,to:vault,value:0n,input:submitted.data,nonce:7,chainId:5042002}));mock.receipt.mockRejectedValue(new Error('RPC receipt timeout'));
    await click('Review payment');await click('Send payment in wallet');
    expect(submitted.nonce).toBe('0x7');expect(JSON.parse(localStorage.getItem('arcmandate.operations.v1')!)[0]).toMatchObject({stage:'unknown',hash});
    await click('Close review panel');expect(button('Review payment').disabled).toBe(true);
    expect(mock.request.mock.calls.filter(call=>call[0].method==='eth_sendTransaction')).toHaveLength(1);
  });
  it('removes the previous vault view even when the newly selected address fails to load', async () => {
    expect(host.querySelector('.vault-instrument')).not.toBeNull();
    mock.read.mockRejectedValue(new Error('The address is not a vault'));
    await fill('Vault address', agent); await click('Open vault');
    expect(host.querySelector('.vault-instrument')).toBeNull();
    expect(host.querySelector('#vault')?.textContent).toContain(agent);
    expect(host.textContent).toContain('The address is not a vault');
  });
  it('invalidates the actual review when a duration preset changes, then reviews the new expiry', async () => {
    await prepareSession();
    expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).toContain('New session');
    await chooseDuration('60');
    expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).not.toContain('New session');
    expect(host.textContent).toContain('The form or context changed');
    await click('Review open session'); await click('Authorize with Vault Key');
    expect(mock.sign.mock.calls.at(-1)?.[0].policy.expiresAt).toBe(snapshot.timestamp + 3600n);
  });
  it('discards a ready transaction when switching to custom duration without a wallet request', async () => {
    await prepareSession(); await click('Authorize with Vault Key');
    expect(button('Open session in wallet').disabled).toBe(false);
    await chooseDuration('custom');
    expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).not.toContain('Open session in wallet');
    await fill('Custom duration (minutes)', '15'); await click('Review open session'); await click('Authorize with Vault Key');
    expect(mock.sign.mock.calls.at(-1)?.[0].policy.expiresAt).toBe(snapshot.timestamp + 900n);
    expect(mock.request.mock.calls.some(call => call[0].method === 'eth_sendTransaction')).toBe(false);
  });
  it('invalidates and locks immediately on a real wallet event, even while provider lookup is stalled', async () => {
    await prepareSession(); mock.lock.mockClear();
    mock.request.mockImplementation(() => new Promise(() => {}));
    await act(async () => { mock.events.get('accountsChanged')!([agent]); });
    expect(mock.lock).toHaveBeenCalledWith('your wallet account changed');
    expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).not.toContain('New session');
  });
  it('does not lock a restored key or cancel a review for the same account event', async () => {
    await prepareSession(); mock.lock.mockClear();
    await act(async () => { mock.events.get('accountsChanged')!([owner.toLowerCase()]); });
    expect(mock.lock).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).toContain('New session');
  });
  it('discards a delayed signature when the duration changes during signing',async()=>{
    await prepareSession();let finish!:(value:any)=>void;let intent!:SigningIntent;
    mock.sign.mockImplementation((value:SigningIntent)=>{intent=value;return new Promise(resolve=>{finish=resolve;});});await click('Authorize with Vault Key');expect(host.textContent).toContain('Authorizing this action with your Vault Key');
    await chooseDuration('60');await act(async()=>finish({type:'signed',signature:'0x1234',signingMs:1,digest:intent.action==='START_SESSION'?startSessionDigest(intent.context,intent.policy,intent.auth):'0x'}));
    expect([...host.querySelectorAll('button')].some(item=>item.textContent==='Open session in wallet')).toBe(false);expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });
  it('invalidates a ready wallet action when the Worker locks independently of UI input',async()=>{
    await prepareSession();await click('Authorize with Vault Key');expect(button('Open session in wallet').disabled).toBe(false);mock.keyVersion++;
    await act(async()=>root.render(<App/>));expect([...host.querySelectorAll('button')].some(item=>item.textContent==='Open session in wallet')).toBe(false);expect(mock.request.mock.calls.some(call=>call[0].method==='eth_sendTransaction')).toBe(false);
  });
  it.each(['chainChanged','disconnect'])('locks and invalidates immediately on %s even if the wallet cannot answer',async event=>{
    await prepareSession();mock.lock.mockClear();mock.request.mockImplementation(()=>new Promise(()=>{}));await act(async()=>{mock.events.get(event)!('0x1');});
    expect(mock.lock).toHaveBeenCalled();expect(host.querySelector('[aria-label="Transaction review"]')?.textContent).not.toContain('New session');
  });
  it('locks a manual setup-to-vault transition without treating it as its own deployment',async()=>{
    await click('Create another vault');mock.lock.mockClear();await fill('Vault address',vault);await click('Open vault');expect(mock.lock).toHaveBeenCalledWith('you switched vault');
  });
  it('keeps this Worker key only through its verified deployment and saves confirmation metadata atomically',async()=>{
    await click('Create another vault');mock.lock.mockClear();let submitted:any;const hash=`0x${'cd'.repeat(32)}`;
    mock.request.mockImplementation(async({method,params})=>{if(method==='eth_accounts')return[owner];if(method==='eth_chainId')return'0x4cef52';if(method==='eth_getTransactionCount')return'0x8';if(method==='eth_sendTransaction'){submitted=params[0];return hash;}throw new Error('Unexpected method');});
    mock.tx.mockImplementation(async()=>({from:owner,to:null,value:0n,input:submitted.data,nonce:8,chainId:5042002}));mock.receipt.mockResolvedValue({status:'success',transactionHash:hash,contractAddress:vault,blockNumber:101n,logs:[]});mock.read.mockResolvedValue({...snapshot,blockNumber:101n});
    const writes=vi.spyOn(localStorage,'setItem');await click('Review vault creation');await click('Create vault in wallet');
    expect(host.querySelector('#vault')?.textContent).toContain(vault);expect(mock.lock).not.toHaveBeenCalledWith('you switched vault');
    const confirmedWrites=writes.mock.calls.filter(call=>call[0]==='arcmandate.operations.v1').map(call=>JSON.parse(call[1])).filter(rows=>rows.some((op:any)=>op.stage==='confirmed'));
    expect(confirmedWrites.length).toBeGreaterThan(0);for(const rows of confirmedWrites)expect(rows.find((op:any)=>op.stage==='confirmed')).toMatchObject({deployedVault:vault,blockNumber:'101'});
  });
});
