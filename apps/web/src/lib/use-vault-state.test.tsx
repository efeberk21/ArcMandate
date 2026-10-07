// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import type { ArcClient, VaultSnapshot } from './chain';
const read = vi.hoisted(() => vi.fn());
vi.mock('./chain', () => ({ readVault: read }));
import { useVaultState } from './use-vault-state';
const a = '0x1111111111111111111111111111111111111111' as Address;
const b = '0x2222222222222222222222222222222222222222' as Address;
const snapshot = (address: Address, blockNumber = 100n): VaultSnapshot => ({ address, owner: a, publicKey: `0x${'ab'.repeat(32)}`, sessionId: 1n, nonce: 1n, active: true,
  balance: 10n, spent: 0n, blockNumber, timestamp: 100n, trusted: true,
  policy: { agent: b, totalBudget: 10n, perTxCap: 1n, recipients: [a], expiresAt: 1000n } });
let root: Root; let host: HTMLDivElement; let view: ReturnType<typeof useVaultState>;
let minimum: Map<string, bigint>; let head: bigint;
const client = { getBlockNumber: async () => head } as unknown as ArcClient;
function Screen({ vault }: { vault: Address | null }) {
  view = useVaultState(client, 'testnet', vault, minimum);
  return <p>{view.snapshot?.address ?? 'empty'}|{view.readError}|{String(view.reading)}</p>;
}
async function render(vault: Address | null) { await act(async () => { root.render(<Screen vault={vault} />); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  read.mockReset(); minimum = new Map(); head = 100n;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('rejects a delayed response from a previous address without touching the new vault', async () => {
  let finish!: (value: VaultSnapshot) => void;
  read.mockImplementation((_client, address) => address === a ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(snapshot(b)));
  await render(a); await render(b);
  expect(host.textContent).toContain(b);
  await act(async () => { finish(snapshot(a)); });
  expect(view.snapshot?.address).toBe(b);
});
it('retains stale data only for the same vault and clears it for a different failing address', async () => {
  read.mockResolvedValue(snapshot(a)); await render(a);
  read.mockRejectedValue(new Error('RPC unavailable'));
  await act(async () => { await view.refresh(); });
  expect(view.snapshot?.address).toBe(a); expect(view.readError).toBe('RPC unavailable');
  await render(b);
  expect(view.snapshot).toBeNull(); expect(view.readError).toBe('RPC unavailable');
  expect(host.textContent).not.toContain(a);
});
it('does not regress below a receipt read and pins later refreshes to the minimum block', async () => {
  read.mockImplementation((_client, address, block) => Promise.resolve(snapshot(address, block)));
  await render(a);
  await act(async () => { await view.refresh(200n); });
  head = 150n;
  await act(async () => { await view.refresh(); });
  expect(read.mock.calls.at(-1)?.[2]).toBe(200n);
  expect(view.snapshot?.blockNumber).toBe(200n);
});
