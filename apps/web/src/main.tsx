import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, type Hex } from 'viem';
import { ARC_NETWORKS, PQ_VERIFIER_ADDRESS } from '@arcmandate/core';
import { type Authorization, type DigestContext, type Policy } from '@arcmandate/core/digest';

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
  recipients: [
    '0x4444444444444444444444444444444444444444',
    '0x5555555555555555555555555555555555555555',
  ],
};
const auth: Authorization = { nonce: 7n, sessionId: 3n, deadline: 1_899_999_000n };

type WorkerResult = { type: 'result'; publicKey: Hex; digest: Hex; signature: Hex; signingMs: number };
type WorkerError = { type: 'error'; message: string };

function App() {
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);

  async function runProbe() {
    setBusy(true);
    setStatus('Worker generating a temporary key and signing a structured START intent…');
    const worker = new Worker(new URL('./worker/pq.worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<WorkerResult>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<WorkerResult | WorkerError>) => {
          if (event.data.type === 'error') reject(new Error(event.data.message));
          else resolve(event.data);
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ type: 'probe', context, policy, auth });
      });
      setStatus(`Signed in Worker in ${result.signingMs} ms; checking Arc testnet…`);
      const client = createPublicClient({ transport: http(ARC_NETWORKS.testnet.rpcUrl, { timeout: 30_000 }) });
      const chainId = await client.getChainId();
      if (chainId !== ARC_NETWORKS.testnet.chainId) throw new Error(`Unexpected chain ID ${chainId}`);

      const verify = async (digest: Hex) => {
        const data = encodeFunctionData({
          abi: verifierAbi,
          functionName: 'verifySlhDsaSha2128s',
          args: [result.publicKey, digest, result.signature],
        });
        const response = await client.call({ to: PQ_VERIFIER_ADDRESS, data });
        if (!response.data) throw new Error('Empty verifier response');
        return decodeFunctionResult({ abi: verifierAbi, functionName: 'verifySlhDsaSha2128s', data: response.data });
      };
      const changedDigest = `0x${result.digest.slice(2, 3) === '0' ? '1' : '0'}${result.digest.slice(3)}` as Hex;
      const valid = await verify(result.digest);
      const mutated = await verify(changedDigest);
      if (!valid || mutated) throw new Error(`Unexpected verifier results: valid=${valid}, mutated=${mutated}`);
      setStatus(`PASS — Worker sign ${result.signingMs} ms; Arc testnet accepted the digest and rejected the changed digest. Digest: ${result.digest}`);
    } catch (error) {
      setStatus(`FAIL — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      worker.terminate();
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '3rem auto', fontFamily: 'system-ui', lineHeight: 1.5 }}>
      <h1>ArcMandate</h1>
      <p>P1 development harness: ephemeral Worker key, structured START digest, Arc testnet verifier.</p>
      <button disabled={busy} onClick={runProbe}>Run browser PQ check</button>
      <p role="status" style={{ overflowWrap: 'anywhere' }}>{status}</p>
      <p>No vault is deployed by this page. The key exists only during this check and is discarded when the Worker stops.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
