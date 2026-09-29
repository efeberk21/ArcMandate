import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';

const path = 'private/arc-testnet-keys.json';
if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite test keys`);
mkdirSync('private', { recursive: true });

const owner = generatePrivateKey();
const agent = generatePrivateKey();
const relay = generatePrivateKey();
const pq = slh_dsa_sha2_128s.keygen();
const data = {
  purpose: 'Disposable Arc testnet integration accounts only. Never fund on mainnet.',
  chainId: 5_042_002,
  owner: { address: privateKeyToAccount(owner).address, privateKey: owner },
  agent: { address: privateKeyToAccount(agent).address, privateKey: agent },
  relay: { address: privateKeyToAccount(relay).address, privateKey: relay },
  pq: { publicKey: toHex(pq.publicKey), secretKey: toHex(pq.secretKey) },
};
writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log(`Saved disposable testnet keys to ignored ${path}`);
console.log(`Owner (faucet destination): ${data.owner.address}`);
console.log(`Agent: ${data.agent.address}`);
console.log(`Relay: ${data.relay.address}`);
console.log(`PQ public key: ${data.pq.publicKey}`);
