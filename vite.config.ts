import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { APP_NAME } from './src/config/brand.ts'

// Project Pages site; the final repo name is still open, so BASE_PATH can override it.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'brand-html',
      transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  ],
  base: process.env.BASE_PATH ?? '/stepquest/',
  // The offline demo map is one lazily loaded ~1.3 MB chunk (≈410 kB gzip).
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
  },
})
