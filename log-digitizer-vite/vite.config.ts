import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/Log-scale-Graph-Digitizer-v2/' : '/',
  server: {
    port: 4173,
    host: true,
    strictPort: false,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
