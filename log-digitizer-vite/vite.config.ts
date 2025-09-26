import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages에서 서브폴더로 배포할 때 필요 (리포 구조 기준)
  base: '/log-digitizer-vite/'
});
