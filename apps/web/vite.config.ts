import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'VITE_ARC_');
  const publicNames = ['VITE_ARC_TESTNET_RPC_URL', 'VITE_ARC_MAINNET_RPC_URL'];
  const define: Record<string, string> = {};
  for (const name of publicNames) {
    const value = env[name];
    if (value !== undefined) {
      let endpoint: URL;
      try { endpoint = new URL(value); } catch { throw new Error(`${name} must be a public RPC URL`); }
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !value.trim()) {
        throw new Error(`${name} must not contain credentials, query parameters or fragments`);
      }
    }
    define[`import.meta.env.${name}`] = value === undefined ? 'undefined' : JSON.stringify(value);
  }
  return {
    envDir: '../..',
    // No automatic VITE_* injection: only the two intentionally public RPC URLs above.
    envPrefix: [],
    define,
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { headers: { 'Cache-Control': 'no-cache' } },
    // Open wallet reviews may still import a chunk from the preceding build.
    // Keep hashed assets available while the preview is running.
    build: { emptyOutDir: false },
    worker: { format: 'es' },
    plugins: [react()],
    optimizeDeps: {
      include: ['@noble/post-quantum/slh-dsa.js', '@noble/hashes/scrypt.js'],
      entries: ['index.html', 'src/worker/pq.worker.ts']
    }
  };
});
