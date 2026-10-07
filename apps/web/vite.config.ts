import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: '../..',
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
});
