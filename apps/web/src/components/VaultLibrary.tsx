import { networkLabel } from '../lib/release';
import type { Network } from '../lib/chain';
import { useState } from 'react';
import { ARC_NETWORKS } from '@arcmandate/core';
import type { Address, Hex } from 'viem';
import { downloadText } from '../lib/files';
import { bookmarkId, parseRegistry, registryJson, type VaultBookmark } from '../lib/vault-registry';
import { sameAddress } from '../lib/operations';
import { explainError } from '../lib/errors';
import { RegistryRecovery } from './RegistryRecovery';
export function VaultLibrary({ network = 'testnet', items, account, selected, error, onOpen, onChange, onFind, onRecovered, findOpen, onFindToggle }: {
  network?: Network; items: VaultBookmark[]; account: Address | null; selected: Address | null; error: string;
  onOpen(address: Address): void; onChange(items: VaultBookmark[], remove?: string, editLabel?:boolean): Promise<void>; onFind(hash: Hex): Promise<void>;
  onRecovered(items:VaultBookmark[]):void;
  findOpen?:boolean; onFindToggle?(open:boolean):void;
}) {
  const [filter, setFilter] = useState('all'); const [hash, setHash] = useState(''); const [message, setMessage] = useState(''); const [working, setWorking] = useState(false);
  const [importedFile, setImportedFile] = useState('');
  async function act(task: () => Promise<void>) { setWorking(true); setMessage(''); try { await task(); } catch (cause) { const info = explainError(cause); setMessage(`${info.message} ${info.advice}`); } finally { setWorking(false); } }
  const networkName = networkLabel(network);
  const matching = items.filter(item => item.chainId === ARC_NETWORKS[network].chainId);
  const shown = matching.filter(item => filter === 'all' || (filter === 'owned' ? sameAddress(item.owner, account) : !sameAddress(item.owner, account))).sort((a,b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  return <section className="panel" id="vault-library" aria-label="Saved vaults">
    <div className="section-heading"><h2>Your saved vaults</h2><span>{matching.length} bookmarks</span></div>
    <p>Public bookmarks in this browser, available before connecting a wallet. A name or imported owner is a local hint; each selected vault is verified onchain.</p>
    <label>Show vaults<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All {networkName} vaults</option><option value="owned">This wallet's vaults</option><option value="watch">Other / watch-only vaults</option></select></label>
    {error && <p className="error" role="alert">{error} Your transaction history is separate. Preserve this list before repairing it.</p>}
    {error&&<RegistryRecovery onRestored={onRecovered}/>}
    {!shown.length && <p>No bookmarks in this view. This does not mean you have no vaults onchain. Open an address, find its creation transaction, or import a card.</p>}
    <div className="bookmark-grid">{shown.map(item => <article key={bookmarkId(item)} className="bookmark">
      <h3>{item.label || 'USDC vault'} {sameAddress(selected,item.address) && <span className="badge">Selected</span>}</h3>
      <p className="mono">{item.address}</p><p>{networkName} · Key ID {item.publicKey?.slice(2,10) ?? 'not checked'}</p>
      <p className="muted">{sameAddress(item.owner,account) ? 'Owner matches connected wallet (verify onchain)' : 'View bookmark'} · {item.checkedAt ? `Last checked ${new Date(item.checkedAt).toLocaleString()}` : 'Not checked in this browser'}</p>
      <div className="actions"><button className="secondary" onClick={() => onOpen(item.address)}>Open saved vault</button><button className="secondary" onClick={() => downloadText(`arcmandate-vault-${item.address.slice(2,10)}.json`, registryJson([item]))}>Download vault card</button></div>
      <details><summary>Rename or remove bookmark</summary><label>Local vault name<input key={item.label} maxLength={80} defaultValue={item.label} onBlur={e => { if (e.target.value !== item.label) void act(() => onChange([{ ...item, label: e.target.value }],undefined,true)); }} /></label>
        <p>Removing only hides this bookmark. It does not delete the vault, funds, session or pending transactions.</p><button className="secondary" disabled={working} onClick={() => void act(() => onChange([], bookmarkId(item)))}>Remove bookmark</button></details>
    </article>)}</div>
    <div className="actions vault-library-transfer"><button className="secondary" onClick={() => downloadText('arcmandate-vault-list.json', registryJson(items))}>Export vault list</button>
      <label className="file-field">Import vault card or list<input type="file" aria-label="Import vault card or list" accept=".json,application/json" disabled={working} onChange={e => {
        const file = e.target.files?.[0]; if (!file) return;
        setImportedFile('');
        void act(async () => { if (file.size > 512 * 1024) throw new Error('Vault list exceeds 512 KiB.'); const imported = parseRegistry(await file.text()).map(item => ({ ...item, source: 'import' as const, checkedAt: undefined })); await onChange(imported); setImportedFile(file.name); setMessage('Public bookmarks imported. Open a vault to verify its owner and key.'); }); e.target.value = '';
      }} />{importedFile && <span className="muted">Imported: {importedFile}</span>}</label></div>
    <p className="muted">A vault card contains no secrets and is not your encrypted Vault Key backup. Storage belongs to this origin: localhost, 127.0.0.1 and different ports/devices have separate lists. Export/import to move bookmarks.</p>
    <details id="creation-lookup" open={findOpen} onToggle={event=>onFindToggle?.(event.currentTarget.open)}><summary>Find vault from its creation transaction</summary><p>A vault address is 42 characters including 0x. A transaction hash is 66. A Vault Key public key is also 66 but cannot locate a vault. This lookup accepts a successful direct creation transaction on {networkName}.</p>
      <label>Deployment transaction hash<input value={hash} placeholder="0x + 64 hex characters" onChange={e => setHash(e.target.value)} /></label>
      <button disabled={working} onClick={() => void act(async () => { await onFind(hash.trim() as Hex); setMessage('Creation verified. The vault was opened and bookmarked.'); })}>{working ? 'Checking creation…' : 'Find and open vault'}</button></details>
    {message && <p role="status">{message}</p>}
  </section>;
}
