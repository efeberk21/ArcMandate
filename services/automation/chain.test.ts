import {afterEach,expect,it,vi} from 'vitest';
import {privateKeyToAccount} from 'viem/accounts';
import {parseTransaction,type Address} from 'viem';
import {chainAccess} from './chain';
import {createPlan,paymentFor,type Vault} from './model';
const key=`0x${'11'.repeat(32)}` as const,agent=privateKeyToAccount(key);
const vault='0x3333333333333333333333333333333333333333' as Address,owner='0x4444444444444444444444444444444444444444' as Address;
const v:Vault={chainId:5042,address:vault,owner,agent:agent.address,sessionId:'7',active:true,expiresAt:Date.now()+600000,budget:'30000',spent:'0',cap:'10000',balance:'30000',recipients:[owner]};
const plan=createPlan({recipient:owner,amount:'10000',startAt:Date.now()+60000,intervalSeconds:60,count:2},v,agent.address),payment=paymentFor(plan,0);
function network(balance='0x6a94d74f430000'){
 const requests:Array<{method:string,params?:unknown[]}>=[];
 vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
  const body=JSON.parse(init.body as string),reply=(request:any)=>{requests.push(request);const result:Record<string,string>={eth_chainId:'0x13b2',eth_getTransactionCount:'0x0',eth_estimateGas:'0x1ea00',eth_gasPrice:'0x4a817c800',eth_getBalance:balance};if(!(request.method in result))throw new Error(`Unexpected RPC method: ${request.method}`);return{jsonrpc:'2.0',id:request.id,result:result[request.method]}};
  return Response.json(Array.isArray(body)?body.map(reply):reply(body));
 });return requests;
}
afterEach(()=>vi.unstubAllGlobals());
it('preflights and signs legacy payments without wallet preparation RPCs or broadcasting',async()=>{
 const requests=network(),access=chainAccess('mainnet','https://rpc.example');
 await access.preflight(vault,key,plan,payment,10n**16n);
 expect(requests.some(r=>r.method==='eth_estimateGas')).toBe(true);
 const signed=await access.sign(vault,key,plan,payment,10n**16n),tx=parseTransaction(signed.signedTx);
 expect(tx.chainId).toBe(5042);expect(tx.type).toBe('legacy');expect(tx.to?.toLowerCase()).toBe(vault.toLowerCase());expect(tx.nonce).toBe(0);expect(tx.gas! * tx.gasPrice!).toBeLessThanOrEqual(10n**16n);
 expect(requests.filter(r=>r.method==='eth_estimateGas').every(r=>(r.params![0] as {from:string}).from.toLowerCase()===agent.address.toLowerCase())).toBe(true);
 expect(requests.some(r=>['eth_fillTransaction','eth_sendRawTransaction'].includes(r.method))).toBe(false);
});
it('rejects an unfunded agent before signing',async()=>{
 network('0x0');await expect(chainAccess('mainnet','https://rpc.example').sign(vault,key,plan,payment,10n**16n)).rejects.toThrow('Add USDC');
});
