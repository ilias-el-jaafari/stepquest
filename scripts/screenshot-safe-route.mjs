// Safe-route screenshots: avoided streets drawn as hazard tape and a night
// route (clock fixed after sunset), plus the Info / FAQ panel, on mobile
// (Spanish) and desktop (English).
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4189 &
//        SAFE_URL=http://127.0.0.1:4189/stepquest/ node scripts/screenshot-safe-route.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.SAFE_URL ?? 'http://127.0.0.1:4189/stepquest/'
const outDir = resolve(process.env.SAFE_OUT ?? 'screenshots/safe-route')
// 19:30 Madrid time on 22 Nov 2026, well after sunset (17:41).
const NIGHT = new Date('2026-11-22T19:30:00+01:00')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es', ui: { plan: 'Planear misión', search: 'Buscar una calle', add: 'Evitar', info: 'Info y preguntas', safeQ: '¿Son seguras las rutas?' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en', ui: { plan: 'Plan quest', search: 'Search a street', add: 'Avoid', info: 'Info and FAQ', safeQ: 'Are the routes safe?' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
let failures = 0
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile })
  await page.clock.setFixedTime(NIGHT)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate((locale) => {
    localStorage.clear()
    localStorage.setItem('stepquest.locale', locale)
  }, vp.locale)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)
  if ((await page.locator('main input[type="checkbox"]').count()) > 1) {
    console.error(vp.name, 'unexpected switches on the main screen')
    failures++
  }

  // Avoid two streets by name (a long avenue and a street next to the start).
  const box = page.getByTestId('avoid-streets')
  for (const q of ['Burjassot', 'Pintor Matarana']) {
    await page.getByLabel(vp.ui.search).fill(q)
    await box.getByRole('button', { name: new RegExp(`^\\+ ${vp.ui.add} `) }).first().click()
  }
  await box.screenshot({ path: `${outDir}/${vp.name}-avoid-box.png` })

  // Plan at night.
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('distance').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(400)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${outDir}/${vp.name}-night-route.png` })
  // Closer look at the hazard tape around the start.
  await page.locator('.map-buttons button').nth(3).click()
  if (vp.mobile) await page.locator('.map-buttons button').nth(1).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/${vp.name}-avoided-zoom.png` })
  if (!vp.mobile) await page.screenshot({ path: `${outDir}/${vp.name}-night-route-full.png`, fullPage: true })

  // Info / FAQ explains safety and night.
  await page.getByTestId('info-button').click()
  const info = page.getByTestId('info-panel')
  await info.waitFor()
  if (!(await info.textContent())?.includes(vp.ui.safeQ)) {
    console.error(vp.name, 'info panel missing the safety answer')
    failures++
  }
  await page.screenshot({ path: `${outDir}/${vp.name}-info.png` })

  if (errors.length) {
    console.error(vp.name, 'errors:', errors)
    failures++
  }
  await page.close()
}
await browser.close()
if (failures) {
  console.error(`${failures} problem(s)`)
  process.exit(1)
}
console.log('ok')
