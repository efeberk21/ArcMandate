import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { hexToBytes, toHex } from 'viem';
import { startSessionDigest, type Authorization, type DigestContext, type Policy } from '@arcmandate/core/digest';

type ProbeRequest = {
  type: 'probe';
  context: DigestContext;
  policy: Policy;
  auth: Authorization;
};

self.onmessage = (event: MessageEvent<ProbeRequest>) => {
  if (event.data.type !== 'probe') return;
  try {
    const { publicKey, secretKey } = slh_dsa_sha2_128s.keygen();
    const digest = startSessionDigest(event.data.context, event.data.policy, event.data.auth);
    const message = hexToBytes(digest);
    const started = performance.now();
    const signature = slh_dsa_sha2_128s.sign(message, secretKey);
    const signingMs = Math.round(performance.now() - started);
    if (!slh_dsa_sha2_128s.verify(signature, message, publicKey)) throw new Error('Local verification failed');
    self.postMessage({ type: 'result', publicKey: toHex(publicKey), digest, signature: toHex(signature), signingMs });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
