// Renders the pixel favicon (public/favicon.svg) into the PNG app icons used by
// the web app manifest and iOS (apple-touch-icon). Run after changing the icon:
//   node scripts/build-icons.mjs
import { chromium } from 'playwright-core'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const svg = await readFile(resolve('public/favicon.svg'), 'utf8')
const outDir = resolve('public/icons')
await mkdir(outDir, { recursive: true })
// [file, size, inset fraction (maskable icons keep the art inside the safe zone)]
const icons = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.2],
  ['apple-touch-icon.png', 180, 0.08],
]
const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox'] })
for (const [file, size, inset] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const pad = Math.round(size * inset)
  await page.setContent(`<html><body style="margin:0;background:#1b1a2e;width:${size}px;height:${size}px;display:grid;place-items:center">
    <div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px;image-rendering:pixelated">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`)
  await page.screenshot({ path: `${outDir}/${file}`, omitBackground: false })
  await page.close()
  console.log(file)
}
await browser.close()
