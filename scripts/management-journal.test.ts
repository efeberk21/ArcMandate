import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { atomicJson } from './durable.js';
import { runManagementStep, type ManagementPort, type ManagementReceipt } from './management-journal.js';
import { freshAuthorization } from './demo-authorization.js';
const account = privateKeyToAccount(`0x${'02'.repeat(32)}`);
describe('demo resume and management fault windows (R07/R08)', () => {
  it('uses fresh state and a new deadline after a 20-minute interruption', async () => {
    let queried = 0n;
    const auth = await freshAuthorization(100n, { head: async () => 1300n, state: async (at) => { queried = at; return { nonce: 2n, sessionId: 1n, timestamp: 2200n }; } });
    expect(queried).toBe(1300n); expect(auth).toEqual({ nonce: 2n, sessionId: 1n, deadline: 2800n });
    await freshAuthorization(1400n, { head: async () => 1300n, state: async (at) => { expect(at).toBe(1400n); return { nonce: 2n, sessionId: 1n, timestamp: 2300n }; } });
  });
  for (const crash of ['signed','persisted','broadcast','receipt'] as const) {
    it(`recovers deploy/funding/withdraw after ${crash} without a second successful transfer`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'arc-admin-'));
      try {
        for (const step of ['deploy','fund','withdraw']) {
          const hashes = new Set<Hex>(); let signs = 0; let injected = false;
          const port: ManagementPort<ManagementReceipt> = {
            chainId: 5042002, account: account.address, intentHash: keccak256('0x1234'),
            async sign() { signs++; return account.signTransaction({ chainId: 5042002, nonce: 1, gas: 100000n, gasPrice: 1n, ...(step === 'deploy' ? {} : { to: account.address }), data: '0x1234', value: 0n }); },
            async broadcast(raw) { hashes.add(keccak256(raw)); },
            async receipt(hash) { if (!hashes.has(hash)) throw new Error('not mined'); return { status: 'success', transactionHash: hash, blockNumber: 123n }; },
            checkpoint(stage) { if (stage === crash && !injected) { injected = true; throw new Error('injected crash'); } },
          };
          const path = join(dir, `${step}.json`);
          await expect(runManagementStep(path, step, port)).rejects.toThrow('injected');
          const result = await runManagementStep(path, step, port);
          expect(result.status).toBe('success'); expect(hashes.size).toBe(1);
          expect(signs).toBe(crash === 'signed' ? 2 : 1);
          // Saved withdrawal receipt -> final-status crash: no pre-withdrawal balance read/sign.
          port.sign = async () => { throw new Error('must not sign again'); };
          expect((await runManagementStep(path, step, port)).transactionHash).toBe(result.transactionHash);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 20000);
  }
  it('leaves a complete old or new manifest across flush/rename failures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc-manifest-')); const path = join(dir, 'manifest.json');
    try {
      atomicJson(path, { status: 'old' });
      expect(() => atomicJson(path, { status: 'new' }, (stage) => { if (stage === 'flushed') throw new Error('crash'); })).toThrow('crash');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ status: 'old' });
      expect(() => atomicJson(path, { status: 'new' }, (stage) => { if (stage === 'renamed') throw new Error('crash'); })).toThrow('crash');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ status: 'new' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
