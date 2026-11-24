// Polish checks on a phone (390×844): the planner folds once a route is
// planned (and must then take under a quarter of the screen), the quest HUD
// starts folded, and nothing covers the map buttons. POL_STEP names the files.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4190 &
//        POL_URL=http://127.0.0.1:4190/stepquest/ POL_STEP=1 node scripts/screenshot-polish.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.POL_URL ?? 'http://127.0.0.1:4190/stepquest/'
const step = process.env.POL_STEP ?? 'x'
const mode = process.env.POL_MODE ?? 'loop'
const steps = process.env.POL_STEPS ?? ''
const outDir = resolve(process.env.POL_OUT ?? 'screenshots/polish')
await mkdir(outDir, { recursive: true })
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let failures = 0
await page.goto(url, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
  localStorage.setItem('stepquest.onboarded', '1')
})
await page.goto(url, { waitUntil: 'networkidle' })
await page.getByTestId('map-canvas').waitFor()
await page.locator('[aria-label="Close"]').click().catch(() => {})
if (mode === 'oneway') await page.getByRole('radio', { name: 'A → B' }).click()
if (steps) {
  const input = page.locator('input[name="steps"]')
  await input.fill(steps)
  await input.press('Enter')
}
await page.getByRole('button', { name: 'Plan quest' }).click()
await page.getByRole('button', { name: 'Start quest' }).waitFor({ timeout: 90_000 })
await page.waitForTimeout(400)
const sheet = await page.locator('.sheet.planner').boundingBox()
const share = sheet.height / 844
console.log(`planner folded: ${Math.round(sheet.height)} px = ${(share * 100).toFixed(0)} % of the screen`)
if (share > 0.25) {
  console.error('folded planner too tall')
  failures++
}
console.log('route line:', await page.getByTestId('route-line').textContent())
await page.screenshot({ path: `${outDir}/${step}-planned.png` })
if (process.env.POL_QUEST) {
  await page.getByTestId('tab-bag').click()
  await page.getByText('Simulate walk').click()
  await page.getByTestId('tab-map').click()
  await page.getByRole('button', { name: 'Start quest' }).click()
  await page.getByTestId('hud').waitFor()
  for (let i = 0; i < 4 && (await page.locator('.dialog').count()); i++) {
    await page.locator('.dialog').click()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(Number(process.env.POL_WAIT ?? 4000))
  const buttons = await Promise.all((await page.locator('.quest .map-buttons button').all()).map((b) => b.boundingBox()))
  for (const o of await page.locator('.quest .hud, .quest .hud-msg').all()) {
    const ob = await o.boundingBox()
    if (buttons.some((b) => overlap(ob, b))) {
      console.error('HUD covers a map button')
      failures++
    }
  }
  console.log('next:', await page.getByTestId('next-distance').textContent())
  await page.screenshot({ path: `${outDir}/${step}-quest.png` })
}
if (errors.length) {
  console.error('errors:', errors)
  failures++
}
await browser.close()
if (failures) process.exit(1)
console.log('ok')
