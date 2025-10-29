import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages에서 하위 경로에 배포되더라도 정적 자산이 제대로 로드되도록 상대(base) 경로 사용
  base: './',
});
