import { afterEach, describe, expect, it, vi } from 'vitest';
import { PqWorkerClient } from './pq-client';
class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor() { FakeWorker.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());
describe('Worker pending request lifecycle (R10)', () => {
  it('rejects all in-flight imports/signs on lock and ignores stale responses', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new PqWorkerClient(); const worker = FakeWorker.latest;
    const pending = client.request({ type: 'import', keyfile: '{}', password: 'example-only' });
    const rejection = expect(pending).rejects.toThrow('locked');
    client.stop(); await rejection;
    worker.onmessage?.({ data: { id: 1, type: 'imported', publicKey: '0x00', proofMs: 1 } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(client.request({ type: 'generate' })).rejects.toThrow('closed');
  });
  it('keeps independent request responses separate and terminates on worker error', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new PqWorkerClient(); const worker = FakeWorker.latest;
    const first = client.request({ type: 'generate' }); const second = client.request({ type: 'generate' });
    worker.onmessage?.({ data: { id: 2, type: 'generated', publicKey: '0x02' } });
    expect(await second).toMatchObject({ id: 2 });
    const rejection = expect(first).rejects.toThrow('injected failure');
    worker.onerror?.({ message: 'injected failure' }); await rejection;
  });
});
