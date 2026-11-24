// Field-test fixes, part B, on a phone (390×844): footprints on the planned
// route and during a demo walk (walked prints darker), and the "Load this area"
// toast after panning off the loaded map (optionally downloading it: FF_LOAD=1).
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4190 &
//        FF_URL=http://127.0.0.1:4190/stepquest/ node scripts/screenshot-field-fixes-b.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.FF_URL ?? 'http://127.0.0.1:4190/stepquest/'
const outDir = resolve(process.env.FF_OUT ?? 'screenshots/field-fixes')
await mkdir(outDir, { recursive: true })
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failures = 0
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'es')
  localStorage.setItem('stepquest.onboarded', '1')
})
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByTestId('map-canvas').waitFor()
await page.getByRole('button', { name: 'Planear misión' }).click()
await page.getByRole('button', { name: 'Empezar misión' }).waitFor({ timeout: 60_000 })
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/b-1-footprints-planned.png` })

// Demo walk: footprints behind the walker turn darker.
await page.getByTestId('tab-bag').click()
await page.getByText('Simular paseo').click()
await page.getByTestId('tab-map').click()
await page.getByRole('button', { name: 'Empezar misión' }).click()
await page.getByTestId('hud').waitFor()
for (let i = 0; i < 4 && (await page.locator('.dialog').count()); i++) {
  await page.locator('.dialog').click()
  await page.waitForTimeout(300)
}
await page.waitForTimeout(6000)
await page.screenshot({ path: `${outDir}/b-2-footprints-walked.png` })
await page.getByRole('button', { name: 'Terminar' }).click().catch(() => {})
page.once('dialog', (d) => d.accept())
await page.getByRole('button', { name: 'Terminar' }).click().catch(() => {})
await page.waitForTimeout(500)

// Pan off the loaded map: the toast offers loading that area and never covers the map buttons.
await page.getByTestId('tab-map').click().catch(() => {})
const canvas = await page.getByTestId('map-canvas').boundingBox()
for (let i = 0; i < 4; i++) {
  await page.mouse.move(canvas.x + 40, canvas.y + 200)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 360, canvas.y + 200, { steps: 6 })
  await page.mouse.up()
}
const toast = page.getByTestId('load-area')
await toast.waitFor({ timeout: 5000 }).catch(() => {
  console.error('no "Load this area" toast after panning away')
  failures++
})
const tb = await page.getByTestId('area-toast').boundingBox()
for (const b of await page.locator('.map-buttons button').all()) {
  if (overlap(tb, await b.boundingBox())) {
    console.error('toast covers a map button')
    failures++
  }
}
await page.screenshot({ path: `${outDir}/b-3-load-this-area.png` })
if (process.env.FF_LOAD) {
  const t0 = Date.now()
  await toast.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${outDir}/b-4-loading.png` })
  const done = await page.getByTestId('load-area').waitFor({ state: 'detached', timeout: 90_000 }).then(() => page.getByText(/Cargando el mapa/).waitFor({ state: 'detached', timeout: 90_000 })).then(() => true, () => false)
  console.log('live area load', done ? `ok in ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'did not finish', await page.locator('.area-error').textContent().catch(() => ''))
  await page.screenshot({ path: `${outDir}/b-5-loaded.png` })
}
if (errors.length) {
  console.error('errors:', errors)
  failures++
}
await browser.close()
if (failures) {
  console.error(`${failures} problem(s)`)
  process.exit(1)
}
console.log('ok')
