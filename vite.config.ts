import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { APP_NAME } from './src/config/brand.ts'

// Project Pages site at /stepquest/; the deploy workflow sets BASE_PATH from the repo name.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'brand-html',
      transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  ],
  base: process.env.BASE_PATH ?? '/stepquest/',
  // The offline demo map (with street names and safety data) is one lazily loaded ~1.5 MB chunk.
  build: { chunkSizeWarningLimit: 1700 },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
  },
})
