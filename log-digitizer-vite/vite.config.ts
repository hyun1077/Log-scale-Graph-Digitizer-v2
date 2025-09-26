import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 저장소명이 Log-scale-Graph-Digitizer- 이고,
// 앱이 log-digitizer-vite/ 폴더에 있으므로 아래처럼 설정
export default defineConfig({
  plugins: [react()],
  base: '/Log-scale-Graph-Digitizer-/log-digitizer-vite/',
})
