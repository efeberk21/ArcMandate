import { useEffect, useState } from 'react';
import { ARC_NETWORKS } from '@arcmandate/core';
import { vaultAbi } from '@arcmandate/core/contracts';
import { arcClient, type Network, type VaultSnapshot } from '../lib/chain';
import { errorMessage } from '../lib/transactions';
type Entry = { id: string; name: string; hash: string; block: bigint };
export function RecentEvents({ snapshot, network, deploymentBlock }: { snapshot: VaultSnapshot; network: Network; deploymentBlock?: bigint }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [from, setFrom] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    const earliest = snapshot.blockNumber > 1999n ? snapshot.blockNumber - 1999n : 0n;
    const lower = deploymentBlock && deploymentBlock > earliest ? deploymentBlock : earliest;
    setFrom(lower);
    void arcClient(network).getContractEvents({ address: snapshot.address, abi: vaultAbi, fromBlock: lower, toBlock: snapshot.blockNumber, strict: true }).then((logs) => {
      if (current) setEntries(logs.slice(-30).reverse().map((log) => ({ id: `${ARC_NETWORKS[network].chainId}:${log.transactionHash}:${log.logIndex}`, name: log.eventName, hash: log.transactionHash, block: log.blockNumber })));
    }).catch((error) => { if (current) { setEntries([]); setError(errorMessage(error)); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [network, snapshot.address, snapshot.blockNumber, deploymentBlock]);
  return <section className="panel" aria-label="Selected vault recent events"><h2>Selected vault events</h2>
    <p className="mono">{snapshot.address}</p><p className="muted">Up to 30 events in blocks {from.toString()}–{snapshot.blockNumber.toString()}{deploymentBlock ? ', bounded by its recorded deployment' : '; deployment block unknown, showing a bounded recent window'}.</p>
    {loading && <p role="status">Reading recent events…</p>}
    {error && <p className="warning">Recent events unavailable: {error}. No live event result is shown.</p>}
    {!loading && !error && entries.length === 0 && <p>No vault events in this block window.</p>}
    {!loading && !error && entries.map((entry) => <p key={entry.id}>{entry.name} · block {entry.block.toString()} · <a href={`${ARC_NETWORKS[network].explorerUrl}/tx/${entry.hash}`} target="_blank" rel="noreferrer">Receipt</a></p>)}
  </section>;
}
