import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// base: './' — щоб застосунок працював і на GitHub Pages, і з будь-якої папки.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  // Тести завжди в поясі UTC, а не Риму: так вони доводять, що дати й час
  // рахуються за Europe/Rome незалежно від пояса пристрою — і на ноутбуці в
  // Італії, і в CI.
  test: { env: { TZ: 'UTC' } },
})
