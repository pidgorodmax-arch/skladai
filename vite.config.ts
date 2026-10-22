import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' — щоб застосунок працював і на GitHub Pages, і з будь-якої папки.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
})
