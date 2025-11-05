import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Log-scale-Graph-Digitizer-v2/',
  server: {
    port: 4173,
    host: true, // 모든 네트워크 인터페이스에서 접근 가능
    strictPort: false, // 포트가 사용 중이면 다른 포트 사용
    hmr: {
      overlay: false,
    },
  },
});
