import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Log-scale-Graph-Digitizer-/' // 레포 이름과 동일해야 함
});
