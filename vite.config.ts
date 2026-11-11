import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
