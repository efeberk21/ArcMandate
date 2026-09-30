import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { ARC_NETWORKS, PQ_VERIFIER_ADDRESS } from '@arcmandate/core';
import type { Authorization, DigestContext, Policy } from '@arcmandate/core/digest';
import { KEYFILE_MAX_BYTES } from '@arcmandate/core/keyfile';
import { PqWorkerClient } from './lib/pq-client';

const verifierAbi = parseAbi(['function verifySlhDsaSha2128s(bytes vk, bytes message, bytes sig) returns (bool)']);
const context: DigestContext = {
  chainId: BigInt(ARC_NETWORKS.testnet.chainId),
  vault: '0x1111111111111111111111111111111111111111',
  owner: '0x2222222222222222222222222222222222222222',
};
const policy: Policy = {
  agent: '0x3333333333333333333333333333333333333333',
  totalBudget: 150_000n,
  perTxCap: 50_000n,
  expiresAt: 1_900_000_000n,
  recipients: ['0x4444444444444444444444444444444444444444'],
};
const auth: Authorization = { nonce: 7n, sessionId: 3n, deadline: 1_899_999_000n };

function App() {
  const worker = useRef<PqWorkerClient | null>(null);
  const epoch = useRef(0);
  const [phase, setPhase] = useState<'none' | 'generated' | 'restored'>('none');
  const [publicKey, setPublicKey] = useState<Hex | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [exportedJson, setExportedJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Generate a key, export its encrypted backup, lock, then restore it.');

  useEffect(() => () => { worker.current?.stop(); worker.current = null; }, []);

  function lock() {
    epoch.current++;
    worker.current?.stop();
    worker.current = null;
    setPhase('none');
    setPublicKey(null);
    setPassword('');
    setConfirmation('');
    setBusy(false);
    setStatus('Locked. The Worker was terminated. Restore the encrypted file to sign again.');
  }

  async function run(task: (client: PqWorkerClient) => Promise<void>) {
    const current = epoch.current;
    setBusy(true);
    try {
      worker.current ??= new PqWorkerClient();
      await task(worker.current);
    } catch (error) {
      if (current === epoch.current) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }

  function generate() {
    lock();
    setExportedJson('');
    void run(async (client) => {
      setStatus('Generating a PQ key in the Worker…');
      const response = await client.request({ type: 'generate' });
      if (response.type !== 'generated') throw new Error('Unexpected Worker response');
      setPublicKey(response.publicKey);
      setPhase('generated');
      setStatus('Key generated. Export an encrypted backup, then lock and restore it.');
    });
  }

  function exportBackup() {
    void run(async (client) => {
      if (phase !== 'generated' && phase !== 'restored') throw new Error('Generate or restore a key first');
      if (password.length < 12) throw new Error('Use a password of at least 12 characters');
      if (password !== confirmation) throw new Error('Passwords do not match');
      setStatus('Encrypting the key in the Worker…');
      const response = await client.request({ type: 'export', password });
      if (response.type !== 'exported') throw new Error('Unexpected Worker response');
      setExportedJson(response.keyfile);
      const url = URL.createObjectURL(new Blob([response.keyfile], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'arcmandate-keyfile.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassword('');
      setConfirmation('');
      setStatus('Encrypted backup downloaded. Lock the key, then import this file to prove recovery.');
    });
  }

  function restore() {
    const selectedFile = file;
    const enteredPassword = password;
    lock();
    setExportedJson('');
    void run(async (client) => {
      if (!selectedFile) throw new Error('Choose a keyfile');
      if (selectedFile.size > KEYFILE_MAX_BYTES) throw new Error('Keyfile exceeds 16 KiB');
      setStatus('Decrypting and proving the restored key in the Worker…');
      const response = await client.request({ type: 'import', keyfile: await selectedFile.text(), password: enteredPassword });
      if (response.type !== 'imported') throw new Error('Unexpected Worker response');
      setPublicKey(response.publicKey);
      setPhase('restored');
      setPassword('');
      setConfirmation('');
      setStatus(`Restored key passed a fresh signing check in ${response.proofMs} ms. You can run the Arc verifier check.`);
    });
  }

  function checkArc() {
    void run(async (client) => {
      if (phase !== 'restored' || !publicKey) throw new Error('Restore the encrypted backup first');
      setStatus('Signing a structured START intent in the Worker…');
      const response = await client.request({ type: 'sign', intent: { action: 'START_SESSION', context, policy, auth } });
      if (response.type !== 'signed') throw new Error('Unexpected Worker response');
      const rpc = createPublicClient({ transport: http(ARC_NETWORKS.testnet.rpcUrl, { timeout: 30_000 }) });
      if (await rpc.getChainId() !== ARC_NETWORKS.testnet.chainId) throw new Error('Unexpected Arc chain ID');
      const verify = async (message: Hex) => {
        const data = encodeFunctionData({ abi: verifierAbi, functionName: 'verifySlhDsaSha2128s', args: [publicKey, message, response.signature] });
        const result = await rpc.call({ to: PQ_VERIFIER_ADDRESS, data });
        if (!result.data) throw new Error('Empty verifier response');
        return decodeFunctionResult({ abi: verifierAbi, functionName: 'verifySlhDsaSha2128s', data: result.data });
      };
      const changed = `0x${response.digest.slice(2, 3) === '0' ? '1' : '0'}${response.digest.slice(3)}` as Hex;
      if (!await verify(response.digest) || await verify(changed)) throw new Error('Arc verifier did not distinguish the original and changed digest');
      setStatus(`PASS: restored key signed in ${response.signingMs} ms; Arc accepted the intent and rejected the changed digest.`);
    });
  }

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'system-ui', lineHeight: 1.5 }}>
      <h1>ArcMandate key recovery check</h1>
      <p>P3 test harness. The secret stays in a Worker. This page does not deploy or fund a vault.</p>
      <p><button disabled={busy} onClick={generate}>Generate new PQ key</button>{' '}
        <button onClick={lock}>Lock key</button></p>
      {publicKey && <p>Public key: <code style={{ overflowWrap: 'anywhere' }}>{publicKey}</code></p>}
      <section>
        <h2>Encrypted backup</h2>
        <label>Password <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{' '}
        <label>Confirm for export <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <p><button disabled={busy || phase === 'none'} onClick={exportBackup}>Download encrypted keyfile</button></p>
        {exportedJson && <details><summary>View encrypted backup JSON</summary>
          <textarea aria-label="Encrypted backup JSON" readOnly value={exportedJson} rows={14} style={{ width: '100%' }} />
        </details>}
      </section>
      <section>
        <h2>Restore</h2>
        <p><input type="file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></p>
        <p><button disabled={busy || !file} onClick={restore}>Restore and verify key</button>{' '}
          <button disabled={busy || phase !== 'restored'} onClick={checkArc}>Check restored signature on Arc testnet</button></p>
      </section>
      <p role="status" style={{ overflowWrap: 'anywhere' }}>{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
