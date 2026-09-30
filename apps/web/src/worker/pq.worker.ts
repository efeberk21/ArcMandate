import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { bytesToHex, hexToBytes, type Address, type Hex } from 'viem';
import { decryptKeyfile, encryptKeyfile } from '@arcmandate/core/keyfile';
import {
  freezeDigest, startSessionDigest, withdrawDigest,
  type Authorization, type DigestContext, type Policy,
} from '@arcmandate/core/digest';

export type SigningIntent =
  | { action: 'START_SESSION'; context: DigestContext; auth: Authorization; policy: Policy }
  | { action: 'FREEZE'; context: DigestContext; auth: Authorization }
  | { action: 'WITHDRAW'; context: DigestContext; auth: Authorization; to: Address; amount: bigint };

export type WorkerRequest =
  | { id: number; type: 'generate' }
  | { id: number; type: 'export'; password: string }
  | { id: number; type: 'import'; keyfile: string; password: string; expectedPublicKey?: Hex }
  | { id: number; type: 'sign'; intent: SigningIntent }
  | { id: number; type: 'verify'; intent: SigningIntent; signature: Hex; publicKey: Hex }
  | { id: number; type: 'lock' };

export type WorkerResponse =
  | { id: number; type: 'generated' | 'imported'; publicKey: Hex; proofMs?: number }
  | { id: number; type: 'exported'; keyfile: string }
  | { id: number; type: 'signed'; digest: Hex; signature: Hex; signingMs: number }
  | { id: number; type: 'verified'; digest: Hex; valid: boolean }
  | { id: number; type: 'locked' }
  | { id: number; type: 'error'; message: string };

let secretKey: Uint8Array | undefined;
let publicKey: Hex | undefined;
let queue = Promise.resolve();

function digest(intent: SigningIntent): Hex {
  switch (intent.action) {
    case 'START_SESSION': return startSessionDigest(intent.context, intent.policy, intent.auth);
    case 'FREEZE': return freezeDigest(intent.context, intent.auth);
    case 'WITHDRAW': return withdrawDigest(intent.context, intent.to, intent.amount, intent.auth);
  }
}

function discardKey(): void {
  secretKey?.fill(0);
  secretKey = undefined;
  publicKey = undefined;
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  switch (request.type) {
    case 'generate': {
      discardKey();
      const pair = slh_dsa_sha2_128s.keygen();
      secretKey = pair.secretKey;
      publicKey = bytesToHex(pair.publicKey);
      return { id: request.id, type: 'generated', publicKey };
    }
    case 'export': {
      if (!secretKey || !publicKey) throw new Error('Key is locked');
      return { id: request.id, type: 'exported', keyfile: await encryptKeyfile(secretKey, publicKey, request.password) };
    }
    case 'import': {
      discardKey();
      const restored = await decryptKeyfile(request.keyfile, request.password);
      try {
        if (request.expectedPublicKey && restored.publicKey.toLowerCase() !== request.expectedPublicKey.toLowerCase()) {
          throw new Error('Keyfile does not match this vault’s onchain PQ public key');
        }
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const started = performance.now();
        const signature = slh_dsa_sha2_128s.sign(challenge, restored.secretKey);
        const proofMs = Math.round(performance.now() - started);
        if (!slh_dsa_sha2_128s.verify(signature, challenge, hexToBytes(restored.publicKey))) {
          throw new Error('Restored key failed signing check');
        }
        secretKey = restored.secretKey;
        publicKey = restored.publicKey;
        return { id: request.id, type: 'imported', publicKey, proofMs };
      } catch (error) {
        restored.secretKey.fill(0);
        throw error;
      }
    }
    case 'sign': {
      if (!secretKey || !publicKey) throw new Error('Key is locked');
      const message = digest(request.intent);
      const started = performance.now();
      const signature = slh_dsa_sha2_128s.sign(hexToBytes(message), secretKey);
      const signingMs = Math.round(performance.now() - started);
      if (!slh_dsa_sha2_128s.verify(signature, hexToBytes(message), hexToBytes(publicKey))) {
        throw new Error('Local signature verification failed');
      }
      return { id: request.id, type: 'signed', digest: message, signature: bytesToHex(signature), signingMs };
    }
    case 'verify': {
      const message = digest(request.intent);
      return {
        id: request.id, type: 'verified', digest: message,
        valid: slh_dsa_sha2_128s.verify(hexToBytes(request.signature), hexToBytes(message), hexToBytes(request.publicKey)),
      };
    }
    case 'lock': {
      discardKey();
      return { id: request.id, type: 'locked' };
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const response = await handle(request);
      self.postMessage(response);
      if (request.type === 'lock') self.close();
    } catch (error) {
      self.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
    }
  });
};
