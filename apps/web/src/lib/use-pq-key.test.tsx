// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../worker/pq.worker';
const worker = vi.hoisted(() => ({ request: vi.fn(), stop: vi.fn() }));
vi.mock('./pq-client', () => ({ PqWorkerClient: class {
  request = worker.request;
  stop = worker.stop;
} }));
import { usePqKey } from './use-pq-key';

let root: Root;
let host: HTMLDivElement;
let key: ReturnType<typeof usePqKey>;
const publicKey = `0x${'ab'.repeat(32)}` as const;
const original = new File(['test transport payload'], 'original.json');
function Screen() { key = usePqKey(); return <p>{key.phase}</p>; }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  worker.request.mockReset(); worker.stop.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Screen />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('stops an unlocked signer when another backup is selected and refuses further signing', async () => {
  worker.request.mockResolvedValue({ id: 1, type: 'imported', publicKey, proofMs: 1 });
  await act(async () => { await key.importKey(original, 'test-only password', publicKey); });
  expect(key.phase).toBe('restored');
  const damaged = new File(['broken JSON'], 'damaged.json');
  await act(async () => key.setFile(damaged));
  expect(worker.stop).toHaveBeenCalledOnce();
  expect(key).toMatchObject({ phase: 'locked', publicKey: null, busy: false, file: damaged });
  const calls = worker.request.mock.calls.length;
  await expect(key.sign({} as Parameters<typeof key.sign>[0])).rejects.toThrow('Restore the encrypted backup');
  expect(worker.request).toHaveBeenCalledTimes(calls);
});

it('does not reopen a signer if an older restore response arrives after a file change', async () => {
  let finish!: (response: WorkerResponse) => void;
  worker.request.mockImplementation(() => new Promise<WorkerResponse>(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = key.importKey(original, 'test-only password', publicKey); });
  expect(key.busy).toBe(true);
  await act(async () => key.setFile(null));
  expect(worker.stop).toHaveBeenCalledOnce();
  await act(async () => { finish({ id: 1, type: 'imported', publicKey, proofMs: 1 }); await pending; });
  expect(key).toMatchObject({ phase: 'locked', publicKey: null, busy: false, file: null });
});
