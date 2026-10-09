import type { Network } from '../lib/chain';
import { ARC_NETWORKS } from '@arcmandate/core';
import { useEffect, useRef, useState } from 'react';
import { encodeFunctionData, formatUnits, type Address, type Hex } from 'viem';
import { vaultAbi } from '@arcmandate/core/contracts';
import { addressInput, usdcInput } from '@arcmandate/core/policy';
import { arcClient, type VaultSnapshot } from '../lib/chain';
import { sameAddress, type Operation } from '../lib/operations';
import { downloadText } from '../lib/files';

export function AgentSetup({network='testnet',snapshot,agent,onAgent,onGas,operations,verifiedBlock}:{network?:Network;snapshot:VaultSnapshot;agent:string;onAgent(value:string):void;onGas():void;operations:Operation[];verifiedBlock?:string}){
  const [balance,setBalance]=useState<bigint|null>(null);const [fee,setFee]=useState<bigint|null>(null);const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [reload,setReload]=useState(0); const [mode,setMode]=useState('manual');
  const cliStorageKey=`arcmandate.cli-request.v1:${network==='mainnet'?'5042:':''}${snapshot.address.toLowerCase()}`;
  const [cliStore]=useState(()=>{let raw:string|null=null;try{raw=localStorage.getItem(cliStorageKey);if(raw===null)return {raw,saved:null,error:''};const parsed=JSON.parse(raw);
    if(!parsed||Object.keys(parsed).some(key=>!['request','to','amount','session'].includes(key))||typeof parsed.request!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.request)||typeof parsed.to!=='string'||typeof parsed.amount!=='string'||typeof parsed.session!=='string'||!/^\d+$/.test(parsed.session))throw new Error('Invalid CLI request');
    addressInput(parsed.to,'Saved recipient');usdcInput(parsed.amount);return {raw,saved:parsed as {request:string;to:string;amount:string;session:string},error:''};
  }catch{return {raw,saved:null,error:'Saved CLI request is unreadable. Preserve it and reconcile the CLI journal before choosing another request.'};}});
  const [request,setRequest]=useState<string>(cliStore.saved?.request??crypto.randomUUID());const [to,setTo]=useState<string>(cliStore.saved?.to??'');const [amount,setAmount]=useState<string>(cliStore.saved?.amount??'');const [pinnedSession,setPinnedSession]=useState<string|null>(cliStore.saved?.session??null);const cliPinned=pinnedSession!==null;const [cliError,setCliError]=useState('');const [cliDamaged,setCliDamaged]=useState(!!cliStore.error);const [cliAccounted,setCliAccounted]=useState(false);
  const cliBaseline=useRef(cliStore.raw);
  useEffect(()=>{let current=true;setBalance(null);setFee(null);setError('');if(!agent)return;
    let address:Address;try{address=addressInput(agent,'Agent');if(sameAddress(address,snapshot.owner)||sameAddress(address,snapshot.address))throw new Error('Use a separate agent account, not the owner or vault.');}catch(cause){setError((cause as Error).message);return;}
    setLoading(true);const rpc=arcClient(network);void(async()=>{
      const native=await rpc.getBalance({address}); if(current)setBalance(native);
      if(snapshot.active&&sameAddress(address,snapshot.policy.agent)&&snapshot.timestamp<snapshot.policy.expiresAt&&snapshot.spent<snapshot.policy.totalBudget&&snapshot.balance>0n&&snapshot.policy.recipients[0]){
        const data=encodeFunctionData({abi:vaultAbi,functionName:'agentPay',args:[snapshot.sessionId,`0x${'ab'.repeat(32)}` as Hex,snapshot.policy.recipients[0],1n]});
        const [gas,price]=await Promise.all([rpc.estimateGas({account:address,to:snapshot.address,data}),rpc.getGasPrice()]);if(current)setFee(((gas*120n+99n)/100n)*price);
      }
    })().catch(cause=>{if(current)setError(cause instanceof Error?cause.message:String(cause));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};
  },[network,agent,snapshot.address,snapshot.blockNumber,reload]);
  const deployment=operations.find(op=>op.network===network&&op.action==='deploy'&&sameAddress(op.deployedVault,snapshot.address)&&op.blockNumber);
  // Imported cards supply deployment context separately through App; no invented deployment block.
  const block=deployment?.blockNumber??verifiedBlock;
  let command=''; let commandError='';
  try{if(mode==='cli'){
    if(network!=='testnet')throw new Error('Use the browser payment console on Arc Mainnet.');
    if(cliDamaged)throw new Error(cliStore.error);
    if(!snapshot.trusted)throw new Error('This vault build is unsupported. A payment command cannot be generated.');
    const recipient=addressInput(to,'Payment recipient'); if(!snapshot.active)throw new Error('Open a session before generating its payment command.');
    if(snapshot.timestamp>=snapshot.policy.expiresAt)throw new Error('This session has expired. Open a new session before a new payment.');
    if(!snapshot.policy.recipients.some(item=>sameAddress(item,recipient)))throw new Error('Select a recipient allowed by this session.');
    const units=usdcInput(amount);if(units>snapshot.policy.perTxCap)throw new Error('Amount exceeds the per-payment limit.');if(units>snapshot.policy.totalBudget-snapshot.spent)throw new Error('Amount exceeds the remaining session budget.');if(units>snapshot.balance)throw new Error('Amount exceeds the vault balance.');
    if(!block)throw new Error('Find the creation transaction or import its verified vault card to recover the deployment block first.');
    if(cliPinned && pinnedSession!==snapshot.sessionId.toString())throw new Error('This saved CLI request belongs to an older session. Reconcile its original journal before starting a different request.');
    command=`npm run agent:pay -- --request ${request} --vault ${snapshot.address} --to ${recipient} --amount ${amount.trim()} --session ${snapshot.sessionId} --deployment-block ${block} --key-file private/agents/my-agent/key.json`;
  }}catch(cause){commandError=(cause as Error).message;}
  const readableBalance=balance===null?'Unknown':balance===0n?'0':balance<10n**12n?'<0.000001':`${balance% (10n**12n)!==0n?'≈ ':''}${formatUnits(balance/(10n**12n),6)}`;
  return <section className="panel" id="agent-setup"><span className="eyebrow">Payment account</span><h2>Prepare a separate agent</h2>
    <p>Your wallet manages the vault. A separate agent account pays from it within the limits you set.</p>
    <label>Agent setup method<select value={mode} onChange={e=>setMode(e.target.value)}><option value="manual">Use another wallet account</option>{network==='testnet'&&<option value="cli">Use the local agent CLI</option>}</select></label>
    {mode==='manual'?<><p>Create a second account in your wallet, then paste its public address below.</p><details><summary>How to prepare a wallet account</summary><ol><li>Create or select a second account in your EVM wallet. You choose the account; this app does not create or switch it silently.</li><li>Copy its address below and add USDC for network fees. This account's own funds are outside the vault limits.</li><li>Return to the owner to deposit and open the session last. Switching accounts locks your local Vault Key; restore it when managing.</li><li>Switch to the agent, open the payment console and make a payment. A session does not start a bot.</li></ol></details></>:<><p>Create a separate testnet signing account in the repository terminal. Never give the bot your owner private key or Vault Key backup.</p><code className="command">npm run agent:create -- --name my-agent</code><p>Copy its printed public address below. The local CLI sends one payment per command; it does not start a bot service.</p></>}
    <label>Agent wallet<input value={agent} placeholder="Separate EVM account address" onChange={e=>onAgent(e.target.value)}/></label>
    <div className="agent-fee-status" role="status"><span className="eyebrow">Agent network-fee balance</span><strong>{loading?'Checking…':balance===null?'Unknown':`${readableBalance} USDC`}</strong><p>{balance===0n?'Add USDC to this account before paying.':balance===null?'Choose an account to check its fee balance.':fee===null?'The actual payment fee is checked after session setup.':balance<fee?'Balance is below the buffered fee estimate.':'Fees can change; review each payment.'}</p></div>
    {balance!==null&&<details><summary>Exact balance and fee estimate</summary><p>Agent network-fee balance: {formatUnits(balance,18)} USDC.</p>{fee!==null?<p>Buffered estimate for a minimal current-policy payment: {formatUnits(fee,18)} USDC. This estimate can change; review each payment.</p>:<p>A payment estimate will be available after session setup.</p>}</details>}
    {error&&<p className="warning">Could not establish agent readiness: {error}</p>}
    <div className="actions"><button className="secondary" onClick={()=>setReload(value=>value+1)}>Refresh agent balance</button><button className="secondary" onClick={onGas}>Add agent network fees</button></div>
    {mode==='cli'&&<><h3>Make a payment with the CLI</h3><label>CLI payment recipient<input disabled={cliPinned} value={to} onChange={e=>setTo(e.target.value)}/></label><label>CLI payment amount (USDC)<input disabled={cliPinned} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      {commandError&&<p>{commandError}</p>}{command&&<><code className="command">{command}</code><button className="secondary" onClick={()=>{void(async()=>{try{if(!navigator.locks)throw new Error('Web Locks support is required to save the CLI request.');await navigator.locks.request(cliStorageKey,()=>{if(localStorage.getItem(cliStorageKey)!==cliBaseline.current)throw new Error('CLI request changed in another tab. Reload it before copying a payment command.');const saved=JSON.stringify({request,to,amount:amount.trim(),session:snapshot.sessionId.toString()});localStorage.setItem(cliStorageKey,saved);cliBaseline.current=saved;setPinnedSession(snapshot.sessionId.toString());});await navigator.clipboard.writeText(command);}catch(cause){setCliError(`${cause instanceof Error?cause.message:String(cause)} Keep the original command and journal; do not regenerate an ID to retry.`);}})();}}>Save request and copy payment command</button></>}
      {cliDamaged&&<><button className="secondary" onClick={()=>downloadText('arcmandate-cli-request-raw.json',cliStore.raw??'')}>Export damaged CLI request</button><label className="checkbox-label"><input type="checkbox" checked={cliAccounted} onChange={e=>setCliAccounted(e.target.checked)}/>I preserved and reconciled the original CLI request and every possibly submitted payment in its journal.</label></>}
      <p>Retry the identical command and request ID to recover its saved receipt. Preserve private/agent-journal and private/agent-wallet-locks. Use only one executor (browser console OR CLI) for this account/request; independent devices/origins do not share nonce coordination.</p><button className="secondary" disabled={cliDamaged&&!cliAccounted} onClick={()=>{try{if(cliDamaged)localStorage.setItem(`arcmandate.cli-quarantine.${crypto.randomUUID()}`,JSON.stringify({raw:cliStore.raw,accounted:cliAccounted}));setCliDamaged(false);setRequest(crypto.randomUUID());setPinnedSession(null);setTo('');setAmount('');setCliError('Different request chosen explicitly. Preserve and reconcile the previous CLI journal.');}catch{setCliError('Could not preserve the original request. Sending remains restricted.');}}}>Start a different CLI payment request</button>{cliError&&<p role="status">{cliError}</p>}</>}
    <details><summary>Public configuration for your agent</summary><p>Permission does not transfer the budget to the agent. Your vault holds the money; this file contains public connection details only.</p><button className="secondary" onClick={()=>downloadText('arcmandate-agent-config.json',JSON.stringify({chainId:ARC_NETWORKS[network].chainId,vault:snapshot.address,agent,sessionId:snapshot.sessionId.toString(),deploymentBlock:block??null,recipients:snapshot.policy.recipients, note:'Public configuration only. No bot is started; use a separate local agent key and one executor.'},null,2))}>Download public agent configuration</button></details>
  </section>;
}
