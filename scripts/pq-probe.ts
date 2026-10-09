import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { BaseError, createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, toHex } from 'viem';
import { ARC_NETWORKS, PQ_VERIFIER_ADDRESS } from '../packages/core/src/config.js';

if (existsSync('.env')) loadEnvFile('.env');
const options = process.argv.slice(2);
const selectedNetwork = options.length === 0 ? null : options.length === 2 && options[0] === '--network' && ['mainnet','testnet'].includes(options[1]) ? options[1] : (() => { throw new Error('Usage: pq-probe.ts [--network mainnet|testnet]'); })();
const verifierAbi = parseAbi(['function verifySlhDsaSha2128s(bytes vk, bytes message, bytes sig) returns (bool)']);
const message = randomBytes(32);
const { publicKey, secretKey } = slh_dsa_sha2_128s.keygen();
const started = performance.now();
const signature = slh_dsa_sha2_128s.sign(message, secretKey);
secretKey.fill(0);
const signingMs = Math.round(performance.now() - started);
const localValid = slh_dsa_sha2_128s.verify(signature, message, publicKey);
if (!localValid || publicKey.length !== 32 || signature.length !== 7856) {
  throw new Error(`Local PQ mismatch: verified=${localValid}, publicKey=${publicKey.length}, signature=${signature.length}`);
}
console.log(`Local SLH-DSA-SHA2-128s: valid; key=${publicKey.length} bytes; signature=${signature.length} bytes; sign=${signingMs} ms`);

const badMessage = Uint8Array.from(message);
badMessage[0] ^= 1;
const badSignature = Uint8Array.from(signature); badSignature[0] ^= 1;
const otherKey = slh_dsa_sha2_128s.keygen().publicKey;
const calls = [
  { label: 'valid', bytes: message, signature, publicKey },
  { label: 'mutated', bytes: badMessage, signature, publicKey },
  { label: 'mutated-signature', bytes: message, signature: badSignature, publicKey },
  { label: 'other-key', bytes: message, signature, publicKey: otherKey },
  { label: 'short-signature', bytes: message, signature: signature.subarray(0, signature.length - 1), publicKey },
  { label: 'long-signature', bytes: message, signature: new Uint8Array([...signature, 0]), publicKey },
] as const;

for (const [name, config] of Object.entries(ARC_NETWORKS)) {
  if (selectedNetwork && name !== selectedNetwork) continue;
  const rpcUrl = process.env[name === 'testnet' ? 'ARC_TESTNET_RPC_URL' : 'ARC_MAINNET_RPC_URL'] ?? config.rpcUrl;
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });
  try {
    const chainId = await client.getChainId();
    if (chainId !== config.chainId) throw new Error(`chain ID ${chainId}, expected ${config.chainId}`);
    for (const { label, bytes, signature: callSignature, publicKey: callKey } of calls) {
      const data = encodeFunctionData({ abi: verifierAbi, functionName: 'verifySlhDsaSha2128s', args: [toHex(callKey), toHex(bytes), toHex(callSignature)] });
      try {
        const response = await client.call({ to: PQ_VERIFIER_ADDRESS, data });
        if (!response.data) throw new Error('empty return data');
        const accepted = decodeFunctionResult({ abi: verifierAbi, functionName: 'verifySlhDsaSha2128s', data: response.data });
        console.log(`${name} ${label}: ${accepted}`);
        if (accepted !== (label === 'valid')) process.exitCode = 1;
      } catch (error) {
        const message = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message.split('\n')[0] : String(error);
        if ((label === 'short-signature' || label === 'long-signature') && message.includes('Invalid signature length')) {
          console.log(`${name} ${label}: reverted (Invalid signature length)`);
        } else {
          console.error(`${name} ${label}: RPC call failed: ${message}`);
          process.exitCode = 1;
        }
      }
    }
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
