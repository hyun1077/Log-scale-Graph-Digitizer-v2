import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 레포 이름이 'Log-scale-Graph-Digitizer-' 인 것으로 보입니다.
// Pages 루트가 레포 이름일 때 base는 '/<레포이름>/' 로!
export default defineConfig({
  plugins: [react()],
  base: '/Log-scale-Graph-Digitizer-/'  // ← 레포 이름과 정확히 일치시켜 주세요
});
