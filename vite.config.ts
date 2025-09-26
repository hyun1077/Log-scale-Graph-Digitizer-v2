import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 저장소 이름으로 바꾸세요: /{repo-name}/
export default defineConfig({
  plugins: [react()],
  base: '/{Log-scale-Graph-Digitizer}/',
})
