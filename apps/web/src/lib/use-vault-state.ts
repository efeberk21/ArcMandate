import { ARC_NETWORKS } from '@arcmandate/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { readVault, type ArcClient, type Network, type VaultSnapshot } from './chain';
import { errorMessage } from './transactions';
import { diagnostic } from './diagnostics';

type View = { identity: string; snapshot: VaultSnapshot | null; error: string; reading: boolean };
export const vaultIdentity = (network: Network, address: Address) => `${network}:${address.toLowerCase()}`;

/** The render gate also applies before effects run, so a new address never displays old data. */
export function useVaultState(client: ArcClient, network: Network, vault: Address | null, minimumBlocks: Map<string, bigint>) {
  const identity = vault ? vaultIdentity(network, vault) : '';
  const selected = useRef(identity);
  selected.current = identity;
  const ticket = useRef(0);
  const [view, setView] = useState<View>({ identity, snapshot: null, error: '', reading: !!vault });

  const acceptSnapshot = useCallback((snapshot: VaultSnapshot) => {
    if (snapshot.chainId !== ARC_NETWORKS[network].chainId) throw new Error('Vault state belongs to another network.');
    if (vaultIdentity(network, snapshot.address) !== selected.current || selected.current !== identity) return;
    const minimum = minimumBlocks.get(identity) ?? 0n;
    if (snapshot.blockNumber < minimum) return;
    minimumBlocks.set(identity, snapshot.blockNumber);
    setView({ identity, snapshot, error: '', reading: false });
  }, [identity, network, minimumBlocks]);

  const refresh = useCallback(async (at?: bigint) => {
    if (!vault || selected.current !== identity) return;
    const request = ++ticket.current;
    diagnostic('vault-read-start');
    setView(previous => ({ identity, snapshot: previous.identity === identity ? previous.snapshot : null, error: previous.identity === identity ? previous.error : '', reading: true }));
    try {
      const head = at ?? await client.getBlockNumber({ cacheTime: 0 });
      const minimum = minimumBlocks.get(identity) ?? 0n;
      const next = await readVault(client, vault, head < minimum ? minimum : head);
      if (request !== ticket.current || selected.current !== identity) return;
      // Another fresh authorization/receipt read may have advanced the view while this read ran.
      if (next.blockNumber < (minimumBlocks.get(identity) ?? 0n)) {
        setView(previous => previous.identity === identity ? { ...previous, reading: false } : previous);
        return;
      }
      acceptSnapshot(next);
      diagnostic('vault-read-ok');
    } catch (error) {
      diagnostic('vault-read-error');
      if (request === ticket.current && selected.current === identity) {
        setView(previous => ({ identity, snapshot: previous.identity === identity ? previous.snapshot : null, error: errorMessage(error), reading: false }));
      }
    }
  }, [client, vault, identity, minimumBlocks, acceptSnapshot]);

  useEffect(() => {
    if (!vault) setView({ identity: '', snapshot: null, error: '', reading: false });
    else void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    return () => { ticket.current++; clearInterval(timer); };
  }, [vault, refresh]);

  return {
    snapshot: view.identity === identity ? view.snapshot : null,
    readError: view.identity === identity ? view.error : '',
    reading: !!vault && (view.identity !== identity || view.reading),
    refresh, acceptSnapshot,
  };
}
