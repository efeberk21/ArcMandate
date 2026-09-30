import type { WorkerRequest, WorkerResponse } from '../worker/pq.worker';

type Payload = WorkerRequest extends infer R ? R extends WorkerRequest ? Omit<R, 'id'> : never : never;

export class PqWorkerClient {
  private worker = new Worker(new URL('../worker/pq.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private closed = false;
  private pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const call = this.pending.get(response.id);
      if (!call) return;
      this.pending.delete(response.id);
      if (response.type === 'error') call.reject(new Error(response.message));
      else call.resolve(response);
    };
    this.worker.onerror = (event) => this.stop(new Error(event.message || 'PQ Worker failed'));
  }

  request(payload: Payload): Promise<WorkerResponse> {
    if (this.closed) return Promise.reject(new Error('PQ Worker is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id });
    });
  }

  stop(reason = new Error('PQ key locked')): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const call of this.pending.values()) call.reject(reason);
    this.pending.clear();
  }
}
