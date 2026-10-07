import { useEffect,useState } from 'react';
import { ARC_NETWORKS, USDC_ADDRESS } from '@arcmandate/core';
import { vaultAbi } from '@arcmandate/core/contracts';
import { formatUnits,parseAbi } from 'viem';
import { arcClient,type Network,type VaultSnapshot } from '../lib/chain';
import { errorMessage } from '../lib/transactions';
type Entry={id:string;name:string;hash:string;block:bigint;amount?:bigint;recipient?:string;session?:bigint};
const labels:Record<string,string>={SessionStarted:'Session opened',AgentPaid:'Agent payment',SessionRevoked:'Session frozen',Withdrawn:'Withdrawal',Transfer:'USDC deposit'};
const transfers=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export function RecentEvents({snapshot,network,deploymentBlock}:{snapshot:VaultSnapshot;network:Network;deploymentBlock?:bigint}){
  const [entries,setEntries]=useState<Entry[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [page,setPage]=useState(0);
  const upper=snapshot.blockNumber>BigInt(page)*2000n?snapshot.blockNumber-BigInt(page)*2000n:0n;
  const earliest=upper>1999n?upper-1999n:0n;const lower=deploymentBlock&&deploymentBlock>earliest?deploymentBlock:earliest;
  useEffect(()=>{let current=true;setLoading(true);setError('');const rpc=arcClient(network);
    void Promise.all([rpc.getContractEvents({address:snapshot.address,abi:vaultAbi,fromBlock:lower,toBlock:upper,strict:true}),
      rpc.getContractEvents({address:USDC_ADDRESS,abi:transfers,eventName:'Transfer',args:{to:snapshot.address},fromBlock:lower,toBlock:upper,strict:true})]).then(([vaultLogs,depositLogs])=>{
        if(!current)return;
        const all:Entry[]=[...vaultLogs,...depositLogs].map(log=>{
          const args=log.args as Record<string,unknown>;
          return{id:`${network}:${log.transactionHash}:${log.logIndex}`,name:log.eventName,hash:log.transactionHash,block:log.blockNumber,
            amount:typeof(args.amount??args.value)==='bigint'?(args.amount??args.value) as bigint:undefined,recipient:typeof args.to==='string'?args.to:undefined,
            session:typeof args.sessionId==='bigint'?args.sessionId:typeof args.newSessionId==='bigint'?args.newSessionId:undefined};
        });setEntries([...new Map(all.map(entry=>[entry.id,entry])).values()].sort((a,b)=>a.block>b.block?-1:1).slice(0,30));
      }).catch(cause=>{if(current){setEntries([]);setError(errorMessage(cause));}}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};
  },[network,snapshot.address,snapshot.blockNumber,page,deploymentBlock]);
  return <section className="panel" id="activity" aria-label="Vault activity"><h2>Onchain vault activity</h2><p>Up to 30 events in blocks {lower.toString()}–{upper.toString()}. Deposits are read from USDC Transfer events. <a href={`${ARC_NETWORKS[network].explorerUrl}/address/${snapshot.address}`} target="_blank" rel="noreferrer">Full explorer history</a></p>
    {loading&&<p role="status">Reading this activity range…</p>}{error&&<p className="warning">Activity could not load: {error}. This does not mean your session or vault was lost.</p>}
    {!loading&&!error&&!entries.length&&<p>No activity in this scanned range. Older transactions may exist.</p>}
    {!loading&&!error&&entries.map(entry=><article className="activity-entry" key={entry.id}><strong>{labels[entry.name]??entry.name}</strong>{entry.amount!==undefined&&<span> · {formatUnits(entry.amount,6)} USDC</span>}{entry.session!==undefined&&<span> · session {entry.session.toString()}</span>}{entry.recipient&&<p className="mono">Recipient {entry.recipient}</p>}<a href={`${ARC_NETWORKS[network].explorerUrl}/tx/${entry.hash}`} target="_blank" rel="noreferrer">View transaction</a><span> · block {entry.block.toString()}</span></article>)}
    <div className="actions"><button className="secondary" disabled={loading||page===0} onClick={()=>setPage(value=>value-1)}>Newer range</button><button className="secondary" disabled={loading||lower===0n||lower===deploymentBlock||page>=9} onClick={()=>setPage(value=>value+1)}>Older range</button></div><p className="muted">Browse up to ten ranges of 2,000 blocks here. Use the explorer for earlier or complete history.</p>
  </section>;
}
