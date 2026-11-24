import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { APP_NAME } from './src/config/brand.ts'

/** Files of `public/` as paths relative to it (they are copied to the output unchanged). */
function publicFiles(dir = 'public', prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? publicFiles(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
}

/** Writes `sw.js` from `src/pwa/sw.template.js`: the list of files to keep offline and a build id that changes with them. */
function serviceWorker(): Plugin {
  return {
    name: 'stepquest-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...new Set(['./', ...Object.keys(bundle), ...publicFiles()])].sort()
      const html = bundle['index.html']
      const id = createHash('sha1')
        .update(JSON.stringify(files))
        .update(html && 'source' in html ? String(html.source) : '')
        .digest('hex')
        .slice(0, 12)
      const source = readFileSync('src/pwa/sw.template.js', 'utf8').replace('__BUILD_ID__', id).replace('/* __PRECACHE__ */ []', JSON.stringify(files))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// Project Pages site at /stepquest/; the deploy workflow sets BASE_PATH from the repo name.
export default defineConfig({
  plugins: [
    react(),
    serviceWorker(),
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
    // Lets tests read src/index.css as text (?raw); other CSS stays stubbed.
    css: { include: [/index\.css\?raw/] },
  },
})
