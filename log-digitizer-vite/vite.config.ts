import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 레포: Log-scale-Graph-Digitizer-  /  앱 폴더: log-digitizer-vite
  base: '/Log-scale-Graph-Digitizer-/log-digitizer-vite/',
})
