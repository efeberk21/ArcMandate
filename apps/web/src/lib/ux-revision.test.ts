import { describe,it,expect } from 'vitest';
import { encodeEventTopics,encodeAbiParameters,encodeFunctionData,keccak256,type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { capability,type CapabilityState } from './capabilities';
import { deriveNextStep } from './next-step';
import { loadRegistry,mergeRegistry,migrateOperations,parseRegistry,registryJson,snapshotBookmark,findDeployment,repairRegistry,REGISTRY_KEY } from './vault-registry';
import { loadPaymentDrafts,newPaymentDraft,savePaymentDraft,validatePayment,repairPaymentDrafts } from './payment-drafts';
import { inspectHistory,repairHistory } from './history-recovery';
import { operationReceipt,saveOperation,type Operation } from './operations';
import type { VaultSnapshot,ArcClient } from './chain';
const owner='0x1111111111111111111111111111111111111111';const vault='0x2222222222222222222222222222222222222222';const agent='0x3333333333333333333333333333333333333333';const recipient='0x4444444444444444444444444444444444444444';
const publicKey=`0x${'aa'.repeat(32)}` as Hex;const hash=`0x${'ab'.repeat(32)}` as Hex;
const snapshot:VaultSnapshot={address:vault,owner,publicKey,trusted:true,active:true,sessionId:1n,nonce:1n,spent:0n,balance:1_000_000n,blockNumber:100n,timestamp:1000n,policy:{agent,totalBudget:1_000_000n,perTxCap:100_000n,expiresAt:2000n,recipients:[recipient]}};
const state:CapabilityState={network:'testnet',account:owner,walletChain:5042002,provider:true,vault,snapshot,phase:'locked',publicKey:null,operations:[],locksAvailable:true};
function storage(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},values};}
const op:Operation={id:'payment-1',action:'agent-pay',network:'testnet',account:agent,vault,to:vault,dataHash:keccak256('0x1234'),stage:'unknown',createdAt:'2026-10-06T00:00:00.000Z',requestId:'invoice-1',paymentId:publicKey,sessionId:'1',amount:'10000',recipient};
it('preserves original payment identity during damaged-draft recovery and quarantines before restoring',()=>{
  const draft=newPaymentDraft(snapshot,agent,recipient,10000n),store=storage(),raw=JSON.stringify([draft,{requestId:'damaged'}]);
  expect(()=>repairPaymentDrafts(raw,JSON.stringify([{...draft,amount:'20000'}]),true,store)).toThrow('original intent');
  expect(()=>repairPaymentDrafts(raw,JSON.stringify([draft]),false,store)).toThrow('Account for');
  repairPaymentDrafts(raw,JSON.stringify([draft]),true,store);expect(loadPaymentDrafts(store)).toEqual([draft]);expect([...store.values.keys()].some(key=>key.startsWith('arcmandate.payment-quarantine.'))).toBe(true);
  expect(()=>loadPaymentDrafts({getItem:()=>JSON.stringify([draft,draft])})).toThrow('damaged');
});
describe('role readiness and guidance',()=>{
  it('owner freeze skips Vault Key while withdrawal needs inactive session and matching key',()=>{
    expect(capability('owner-freeze',state).allowed).toBe(true);expect(capability('withdraw',state).allowed).toBe(false);
    expect(capability('withdraw',{...state,phase:'restored',publicKey,snapshot:{...snapshot,active:false}}).allowed).toBe(true);
  });
  it('agent pays with a locked Vault Key; relay only freezes with the matching key',()=>{
    expect(capability('agent-pay',{...state,account:agent}).allowed).toBe(true);
    expect(capability('start',{...state,account:agent,phase:'restored',publicKey}).allowed).toBe(false);
    expect(capability('pq-freeze',{...state,account:recipient,phase:'restored',publicKey}).allowed).toBe(true);
    expect(capability('pq-freeze',{...state,account:recipient}).allowed).toBe(false);
  });
  it.each(['stale','untrusted','expired','exhausted'] as const)('does not recommend payment for %s',kind=>{
    const changed:CapabilityState={...state,account:agent,snapshot:{...snapshot,trusted:kind!=='untrusted',timestamp:kind==='expired'?2000n:1000n,spent:kind==='exhausted'?1_000_000n:0n},readError:kind==='stale'?'RPC unavailable':''};
    expect(capability('agent-pay',changed).allowed).toBe(false);expect(deriveNextStep(changed).title).not.toBe('The session permits payments');
  });
  it('first setup creates/imports a key rather than asking for a nonexistent backup',()=>{
    expect(deriveNextStep({...state,vault:null,snapshot:null}).title).toBe('Create or restore your Vault Key');
  });
  it('guides an inactive owner through agent choice, deposit, then limits',()=>{
    const setup={...state,phase:'restored' as const,publicKey,snapshot:{...snapshot,active:false,sessionId:0n,balance:0n}};
    expect(deriveNextStep(setup).id).toBe('agent');
    expect(deriveNextStep({...setup,agentAddress:owner}).id).toBe('agent');
    expect(deriveNextStep({...setup,agentAddress:agent}).id).toBe('fund');
    expect(deriveNextStep({...setup,agentAddress:agent,snapshot:{...setup.snapshot,balance:1_000_000n}}).id).toBe('session');
  });
});
describe('persistent independent vault library',()=>{
  it('allows deliberate rename and clear while background refresh preserves a local name',()=>{
    const store=storage(),bookmark={...snapshotBookmark(snapshot),label:'First'};mergeRegistry([bookmark],store);mergeRegistry([{...bookmark,label:'Second'}],store,true);expect(loadRegistry(store)[0].label).toBe('Second');mergeRegistry([snapshotBookmark(snapshot)],store);expect(loadRegistry(store)[0].label).toBe('Second');mergeRegistry([{...bookmark,label:''}],store,true);expect(loadRegistry(store)[0].label).toBe('');
  });
  it('quarantines a damaged list and preserves readable bookmarks without changing operation history',()=>{
    const store=storage(),bookmark=snapshotBookmark(snapshot),raw=JSON.stringify({version:1,vaults:[bookmark,{address:'broken'}]});store.setItem(REGISTRY_KEY,raw);store.setItem('arcmandate.operations.v1','unresolved journal');repairRegistry(raw,registryJson([]),store);expect(loadRegistry(store)).toEqual([bookmark]);expect(store.getItem('arcmandate.operations.v1')).toBe('unresolved journal');expect([...store.values.keys()].some(key=>key.startsWith('arcmandate.registry-quarantine.'))).toBe(true);
    expect(()=>repairRegistry(raw,registryJson([]),store)).toThrow('changed in another tab');
  });
  it('survives 150 terminal operations and migrates idempotently without rewriting journals',()=>{
    const store=storage();mergeRegistry([snapshotBookmark(snapshot)],store);
    for(let i=0;i<150;i++)saveOperation({...op,id:`op-${i}`,stage:'confirmed'},store);
    const before=store.getItem('arcmandate.operations.v1');migrateOperations([op,{...op,stage:'confirmed'}],store);migrateOperations([{...op,stage:'confirmed'}],store);
    expect(loadRegistry(store)).toHaveLength(1);expect(store.getItem('arcmandate.operations.v1')).toBe(before);
  });
  it('treats imports as metadata and preserves local labels/checked keys',()=>{
    const store=storage();const saved={...snapshotBookmark(snapshot),label:'My vault'};mergeRegistry([saved],store);
    mergeRegistry([{...saved,source:'import',label:'Fake',publicKey:hash,owner:agent}],store);
    expect(loadRegistry(store)[0]).toMatchObject({label:'My vault',owner,publicKey});
    mergeRegistry([snapshotBookmark(snapshot)],store);expect(loadRegistry(store)[0].label).toBe('My vault');
  });
  it('rejects secret fields, wrong chain/schema/size and leaves storage intact on quota failure',()=>{
    const item=snapshotBookmark(snapshot);
    expect(()=>parseRegistry(registryJson([{...item,chainId:1}]))).toThrow();
    expect(()=>parseRegistry(JSON.stringify({version:1,vaults:[{...item,privateKey:hash}]}))).toThrow();
    expect(()=>parseRegistry('x'.repeat(512*1024+1))).toThrow('exceeds');
    const store=storage();mergeRegistry([item],store);const before=loadRegistry(store);
    expect(()=>mergeRegistry([{...item,address:agent}],{getItem:store.getItem,setItem:()=>{throw new Error('Quota');}})).toThrow('Quota');expect(loadRegistry(store)).toEqual(before);
  });
  it('rejects a successful payment hash as a creation lookup',async()=>{
    const rpc={getChainId:async()=>5042002,getTransactionReceipt:async()=>({status:'success',contractAddress:null})};
    await expect(findDeployment(rpc as unknown as ArcClient,hash)).rejects.toThrow('not a direct contract-creation');
  });
});
describe('payment identity and receipt effect',()=>{
  it('persists identical retry identity and rejects changed intent/session and old confirmed requests',()=>{
    const store=storage();const draft=newPaymentDraft(snapshot,agent,recipient,10000n);savePaymentDraft(draft,store);
    expect(loadPaymentDrafts(store)[0]).toEqual(draft);expect(()=>savePaymentDraft({...draft,amount:'20000'},store)).toThrow('another payment');
    expect(()=>validatePayment({...snapshot,sessionId:2n},draft,[])).toThrow('Session changed');
    expect(()=>validatePayment(snapshot,draft,[{...op,requestId:draft.requestId,stage:'confirmed'}])).toThrow('PaymentAlreadyUsed');
  });
  it.each(['limit','recipient','expiry','balance','frozen'] as const)('rejects %s before wallet submission',kind=>{
    const draft=newPaymentDraft(snapshot,agent,kind==='recipient'?owner:recipient,kind==='limit'?200000n:10000n);
    const next={...snapshot,active:kind!=='frozen',timestamp:kind==='expiry'?2000n:1000n,balance:kind==='balance'?1n:1_000_000n};
    expect(()=>validatePayment(next,draft,[])).toThrow();
  });
  it('requires exact AgentPaid session/payment ID/recipient/amount proof',async()=>{
    const input=encodeFunctionData({abi:vaultAbi,functionName:'agentPay',args:[1n,publicKey,recipient,10000n]});const payment={...op,hash,dataHash:keccak256(input)};
    let amount=10000n;const rpc={getChainId:async()=>5042002,getTransaction:async()=>({from:agent,to:vault,input,value:0n,nonce:7,chainId:5042002}),
      waitForTransactionReceipt:async()=>({transactionHash:hash,status:'success',blockNumber:101n,logs:[{address:vault,topics:encodeEventTopics({abi:vaultAbi,eventName:'AgentPaid',args:{sessionId:1n,paymentId:publicKey,to:recipient}}),data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[amount,amount])}]})};
    expect((await operationReceipt(rpc as unknown as ArcClient,payment,hash)).effectVerified).toBe(true);
    amount=999n;expect((await operationReceipt(rpc as unknown as ArcClient,payment,hash)).effectVerified).toBe(false);
  });
});
describe('history quarantine',()=>{
  it('exports readable rows but does not drop unresolved records during repair',()=>{
    const raw=JSON.stringify([op,{id:'damaged'}]);expect(inspectHistory(raw)).toMatchObject({invalid:1,valid:[op]});
    expect(()=>repairHistory(raw,'[]',true,storage())).toThrow('preserve');
    expect(()=>repairHistory(raw,JSON.stringify([{...op,stage:'cancelled'}]),true,storage())).toThrow('pending');
    expect(()=>repairHistory(raw,JSON.stringify([op]),false,storage())).toThrow('Account for');
    const store=storage();repairHistory(raw,JSON.stringify([op]),true,store);expect([...store.values.keys()].some(key=>key.includes('quarantine'))).toBe(true);
  });
});
