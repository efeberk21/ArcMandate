// Development-only EIP-1193 bridge. Private keys stay in this Node process.
// It binds localhost, checks Origin/Host, uses a CSRF token, and refuses mainnet.
import { createServer } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const keys = JSON.parse(readFileSync('private/arc-testnet-keys.json', 'utf8'));
if (keys.chainId !== 5042002) throw new Error('Smoke wallet must use disposable Arc testnet accounts');
const chain = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } } });
const rpc = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0], { timeout: 30_000 }) });
if (await rpc.getChainId() !== 5042002) throw new Error('Refusing a non-testnet RPC');
const accounts = { owner: privateKeyToAccount(keys.owner.privateKey), relay: privateKeyToAccount(keys.relay.privateKey) };
const token = randomBytes(32).toString('hex');
const backupPath = resolve('private/web-smoke-keyfile.json');
const origin = 'http://127.0.0.1:5173';
const logPath = resolve('private/web-smoke-transactions.json');
const transactions = [];
const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 5173, strictPort: true }, plugins: [{
  name: 'arcmandate-local-smoke-wallet',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/__smoke/')) return next();
      const reply = (status, value) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
      if (request.headers.host !== '127.0.0.1:5173' || (request.headers.origin && request.headers.origin !== origin)) return reply(403, { error: 'Local origin required' });
      if (request.url === '/__smoke/config' && request.method === 'GET') return reply(200, { token, owner: accounts.owner.address, relay: accounts.relay.address });
      if (request.headers['x-smoke-token'] !== token) return reply(403, { error: 'Smoke token required' });
      try {
        if (request.url === '/__smoke/backup' && request.method === 'GET') return reply(200, { keyfile: existsSync(backupPath) ? readFileSync(backupPath, 'utf8') : null });
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 50000) throw new Error('Request too large'); }
        const payload = JSON.parse(body);
        if (request.url === '/__smoke/nonce' && request.method === 'POST') {
          const account = accounts[payload.role];
          if (!account) throw new Error('Wrong smoke account');
          const nonce = await rpc.getTransactionCount({ address: account.address, blockTag: 'pending' });
          return reply(200, { nonce: `0x${nonce.toString(16)}` });
        }
        if (request.url === '/__smoke/backup' && request.method === 'POST') {
          if (typeof payload.keyfile !== 'string' || Buffer.byteLength(payload.keyfile) > 16384) throw new Error('Invalid encrypted backup');
          const file = JSON.parse(payload.keyfile);
          if (file.format !== 'arcmandate-keyfile' || 'secretKey' in file) throw new Error('Only an encrypted keyfile can be captured');
          writeFileSync(backupPath, payload.keyfile);
          return reply(200, { saved: true });
        }
        if (request.url === '/__smoke/send' && request.method === 'POST') {
          const account = accounts[payload.role];
          const input = payload.transaction;
          if (!account || getAddress(input.from) !== account.address || Number(BigInt(input.chainId)) !== 5042002) throw new Error('Wrong smoke account or network');
          if (BigInt(input.gas) > 3_000_000n) throw new Error('Smoke gas bound exceeded');
          const wallet = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
          const nonce = Number(BigInt(input.nonce));
          if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Invalid smoke wallet nonce');
          const hash = await wallet.sendTransaction({ to: input.to, data: input.data, gas: BigInt(input.gas), nonce });
          transactions.push({ hash, role: payload.role, to: input.to ?? null, createdAt: new Date().toISOString() });
          writeFileSync(logPath, `${JSON.stringify(transactions, null, 2)}\n`);
          return reply(200, { hash });
        }
        reply(404, { error: 'Unknown smoke endpoint' });
      } catch (error) { reply(400, { error: error instanceof Error ? error.message : String(error) }); }
    });
  },
}] });
await server.listen();
console.log(`Development smoke page: ${origin}/smoke.html`);
console.log('Disposable testnet accounts only. Each Send button submits a testnet transaction.');
