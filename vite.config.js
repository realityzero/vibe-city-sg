import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const devPages = Object.fromEntries(readdirSync(resolve(__dirname, 'dev')).filter(f => f.endsWith('.html')).map(f => [`dev_${f.replace('.html', '')}`, resolve(__dirname, 'dev', f)]));

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...devPages } } },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
