import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { journalPath, runPayment, type PaymentPort } from './agent-journal.js';

const intended = {
  requestId: 'invoice-42', chainId: 5_042_002,
  vault: '0x1111111111111111111111111111111111111111' as const,
  sessionId: '7', to: '0x2222222222222222222222222222222222222222' as const,
  amount: '50000', deploymentBlock: '100',
};
const signedTx = '0x1234' as const;
const txHash = keccak256(signedTx);

function withDirectory(test: (directory: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const directory = mkdtempSync(join(tmpdir(), 'arc-journal-'));
    try { await test(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
  };
}

describe('agent payment journal', () => {
  it('keeps the same payment ID and signed transaction across a submission timeout and restart', withDirectory(async (directory) => {
    let signs = 0;
    let sends = 0;
    let hasReceipt = false;
    const port: PaymentPort = {
      async sign() { signs++; return { signedTx, txHash }; },
      async receipt() { return hasReceipt ? { status: 'success', blockNumber: 123n } : null; },
      async used() { return false; },
      async paymentEvent() { return null; },
      async broadcast() { sends++; throw new Error('RPC timeout after accepting transaction'); },
    };
    const first = await runPayment(directory, intended, port);
    expect(first.status).toBe('pending');
    const saved = JSON.parse(readFileSync(journalPath(directory, intended.requestId), 'utf8'));
    expect(saved.paymentId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(saved.signedTx).toBe(signedTx);
    expect(saved.txHash).toBe(txHash);
    const second = await runPayment(directory, intended, port);
    expect(second.status).toBe('pending');
    expect(second.journal.paymentId).toBe(first.journal.paymentId);
    expect(signs).toBe(1);
    expect(sends).toBe(2); // Same raw transaction; no new nonce or ID.
    hasReceipt = true;
    const third = await runPayment(directory, intended, port);
    expect(third.status).toBe('confirmed');
    expect(sends).toBe(2);
    expect(third.journal.receipt?.blockNumber).toBe('123');
  }));

  it('uses onchain paymentId and event after a lost hash, without another send', withDirectory(async (directory) => {
    let signs = 0;
    const port: PaymentPort = {
      async sign() { signs++; return { signedTx, txHash }; },
      async receipt() { return null; },
      async used() { return true; },
      async paymentEvent() { return { txHash, blockNumber: 120n }; },
      async broadcast() { throw new Error('must not broadcast'); },
    };
    const result = await runPayment(directory, intended, port);
    expect(result.status).toBe('confirmed');
    expect(signs).toBe(0);
    expect(result.journal.txHash).toBe(txHash);
  }));

  it('rejects a changed request and never moves it into a new session', withDirectory(async (directory) => {
    const port: PaymentPort = {
      async sign() { return { signedTx, txHash }; },
      async receipt() { return null; },
      async used() { return false; },
      async paymentEvent() { return null; },
      async broadcast() {},
    };
    await runPayment(directory, intended, port);
    const sameAddressDifferentCase = await runPayment(directory, { ...intended, vault: intended.vault.toUpperCase().replace('0X', '0x') as typeof intended.vault }, port);
    expect(sameAddressDifferentCase.status).toBe('pending');
    await expect(runPayment(directory, { ...intended, sessionId: '8' }, port)).rejects.toThrow('different sessionId');
    await expect(runPayment(directory, { ...intended, amount: '60000' }, port)).rejects.toThrow('different amount');
  }));

  it('recovers a journal lock left by a dead process', withDirectory(async (directory) => {
    writeFileSync(`${journalPath(directory, intended.requestId)}.lock`, '99999999\n');
    const port: PaymentPort = {
      async sign() { return { signedTx, txHash }; },
      async receipt() { return null; },
      async used() { return false; },
      async paymentEvent() { return null; },
      async broadcast() {},
    };
    expect((await runPayment(directory, intended, port)).status).toBe('pending');
  }));
});
