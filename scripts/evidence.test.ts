import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeEvidence } from './evidence.js';
const files = ['arc-testnet.json','arc-testnet-p5.json','p4-browser-smoke.json','p6-metamask-browser.json'];
describe('historical evidence adapters (R13)', () => {
  it('preserves all 37 receipts and 6 simulations without inventing source provenance', () => {
    const normalized = files.map((path) => normalizeEvidence(JSON.parse(readFileSync(`deployments/${path}`, 'utf8'))));
    expect(normalized.map((m) => m.steps.filter((s) => s.kind === 'receipt').length)).toEqual([11,11,7,8]);
    expect(normalized.flatMap((m) => m.steps).filter((s) => s.kind === 'simulation')).toHaveLength(6);
  });
  it('rejects missing receipt fields, wrong network/address and a swapped deployment', () => {
    const m = JSON.parse(readFileSync('deployments/arc-testnet-p5.json', 'utf8'));
    expect(() => normalizeEvidence({ ...m, chainId: 1 })).toThrow();
    expect(() => normalizeEvidence(m, '0x1111111111111111111111111111111111111111')).toThrow('vault mismatch');
    expect(() => normalizeEvidence({ ...m, deploymentTxHash: `0x${'ab'.repeat(32)}` })).toThrow('hash mismatch');
    const broken = structuredClone(m); delete broken.steps[0].blockNumber;
    expect(() => normalizeEvidence(broken)).toThrow();
  });
});
