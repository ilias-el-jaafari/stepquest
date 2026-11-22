// Field-test fixes on a phone (390×844): a real-GPS quest where the walker
// leaves the route next to the tram tracks. Checks that no message, dialogue
// or banner covers a map button, and that the locate button centres on the walker.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4190 &
//        FF_URL=http://127.0.0.1:4190/stepquest/ FF_PART=a node scripts/screenshot-field-fixes.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.FF_URL ?? 'http://127.0.0.1:4190/stepquest/'
const part = process.env.FF_PART ?? 'a'
const outDir = resolve(process.env.FF_OUT ?? 'screenshots/field-fixes')
await mkdir(outDir, { recursive: true })

const start = { latitude: 39.4935, longitude: -0.392 }
// Walk south towards the metro line, away from the planned route.
const rail = { latitude: 39.4907, longitude: -0.3915 }
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, geolocation: { ...start, accuracy: 5 }, permissions: ['geolocation'] })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failures = 0
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
})
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByTestId('map-canvas').waitFor()
await page.getByRole('button', { name: 'Plan quest' }).click()
await page.getByRole('button', { name: 'Start quest' }).waitFor({ timeout: 60_000 })
await page.screenshot({ path: `${outDir}/${part}-1-planned.png` })
await page.getByRole('button', { name: 'Start quest' }).click()
await page.getByTestId('hud').waitFor()
// Close the opening dialogue.
for (let i = 0; i < 4 && (await page.locator('.dialog').count()); i++) {
  await page.locator('.dialog').click()
  await page.waitForTimeout(300)
}
const steps = 16
for (let i = 1; i <= steps; i++) {
  const k = i / steps
  await context.setGeolocation({ latitude: start.latitude + (rail.latitude - start.latitude) * k, longitude: start.longitude + (rail.longitude - start.longitude) * k, accuracy: 5 })
  await page.waitForTimeout(1200)
}
await page.waitForTimeout(800)
const covers = async () => {
  const buttons = await page.locator('.quest .map-buttons button').all()
  const boxes = await Promise.all(buttons.map((b) => b.boundingBox()))
  const overlays = await page.locator('.quest .hud-msg, .quest .dialog, .quest .hud').all()
  for (const o of overlays) {
    const ob = await o.boundingBox()
    for (const b of boxes) if (overlap(ob, b)) return { overlay: await o.getAttribute('class'), ob, b }
  }
  return undefined
}
const msg = await page.locator('.hud-msg').count()
if (!msg) {
  console.error('expected the off-route message')
  failures++
}
const hit = await covers()
if (hit) {
  console.error('overlay covers a map button', hit)
  failures++
}
// Pan away, then the locate button must bring the walker back to the centre.
const canvas = await page.getByTestId('map-canvas').boundingBox()
await page.mouse.move(canvas.x + 200, canvas.y + 400)
await page.mouse.down()
await page.mouse.move(canvas.x + 60, canvas.y + 600, { steps: 8 })
await page.mouse.up()
await page.getByTestId('map-locate').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/${part}-2-off-route-tracks.png` })
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
