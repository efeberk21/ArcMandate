import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { initialVaultSelection, latestAccountVault, rememberVaultSelection } from './vault-selection';
import type { Operation } from './operations';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x95f6879d6710b0e5aa6b97d427076c560fa814b1';
const other = '0x3333333333333333333333333333333333333333';
const rootUrl = () => new URL('http://127.0.0.1:5173/?network=testnet');
function storage() {
  let json: string | null = null;
  return { getItem: () => json, setItem: (_key: string, value: string) => { json = value; } };
}
const deployment: Operation = { id: 'created', action: 'deploy', account: owner, network: 'testnet', stage: 'confirmed', deployedVault: vault,
  createdAt: '2026-10-05T12:00:00Z', dataHash: `0x${'01'.repeat(32)}` };

describe('vault navigation recovery', () => {
  it('restores the selected vault when reopening the root URL without a wallet connection', () => {
    const saved = storage(); rememberVaultSelection(getAddress(vault), saved);
    expect(initialVaultSelection(rootUrl(), saved).address).toBe(getAddress(vault));
  });
  it('prioritizes an explicit vault link over a different saved selection', () => {
    const saved = storage(); rememberVaultSelection(other, saved);
    const url = rootUrl(); url.searchParams.set('vault', vault);
    expect(initialVaultSelection(url, saved).address).toBe(getAddress(vault));
  });
  it('does not silently substitute a remembered testnet vault for a mainnet or invalid vault link', () => {
    const saved = storage(); rememberVaultSelection(getAddress(vault), saved);
    for (const url of [new URL('http://localhost/?network=mainnet'), new URL('http://localhost/?network=testnet&vault=invalid')]) {
      expect(initialVaultSelection(url, saved)).toMatchObject({ address: null, recover: false });
    }
  });
  it('keeps Create another vault selected across reload rather than reopening an older vault', () => {
    const saved = storage(); rememberVaultSelection(getAddress(vault), saved); rememberVaultSelection(null, saved);
    expect(initialVaultSelection(rootUrl(), saved)).toEqual({ address: null, setup: true, recover: false });
  });
  it('ignores corrupt preferences and leaves manual address opening available', () => {
    expect(initialVaultSelection(rootUrl(), { getItem: () => '{bad' })).toEqual({ address: null, setup: false, recover: true });
    expect(() => rememberVaultSelection(getAddress(vault), { setItem() { throw new Error('Storage denied'); } })).not.toThrow();
  });
  it('recovers a vault from a confirmed deposit even when its creation record is missing', () => {
    const deposit: Operation = { ...deployment, id: 'deposit', action: 'fund', vault, deployedVault: undefined };
    expect(latestAccountVault([deposit], owner)).toBe(getAddress(vault));
  });
  it('does not reopen other accounts, pending deployments, or mainnet records', () => {
    expect(latestAccountVault([{ ...deployment, account: other }, { ...deployment, stage: 'submitted' }, { ...deployment, network: 'mainnet' }], owner)).toBeNull();
  });
  it('selects the latest confirmed vault without mutating stored operation order', () => {
    const records: Operation[] = [deployment, { ...deployment, id: 'newer', deployedVault: other, createdAt: '2026-10-05T13:00:00Z' }];
    expect(latestAccountVault(records, owner)).toBe(other);
    expect(records[0].id).toBe('created');
  });
});
