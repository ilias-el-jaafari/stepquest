// Safe-route screenshots: the safety box, street search, avoid list and the
// safety summary after planning, on mobile (Spanish) and desktop (English).
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4189 &
//        SAFE_URL=http://127.0.0.1:4189/stepquest/ node scripts/screenshot-safe-route.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.SAFE_URL ?? 'http://127.0.0.1:4189/stepquest/'
const outDir = resolve(process.env.SAFE_OUT ?? 'screenshots/safe-route')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es', ui: { plan: 'Planear misión', search: 'Buscar una calle', add: 'Evitar', notice: '% por calles preferidas' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en', ui: { plan: 'Plan quest', search: 'Search a street', add: 'Avoid', notice: '% on preferred streets' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
let failures = 0
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile })
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
  const safety = page.getByTestId('safety')
  const safeOn = await safety.locator('input[type="checkbox"]').first().isChecked()
  if (!safeOn) {
    console.error(vp.name, 'safe route is not on by default')
    failures++
  }

  // Search a street and add it to the avoid list.
  await page.getByLabel(vp.ui.search).fill('Burjassot')
  await safety.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${outDir}/${vp.name}-search.png` })
  await safety.screenshot({ path: `${outDir}/${vp.name}-safety-box-search.png` })
  await safety.getByRole('button', { name: new RegExp(`^\\+ ${vp.ui.add} `) }).first().click()

  // Plan with the safe route and the avoid list.
  await page.getByRole('button', { name: vp.ui.plan }).click()
  const notice = page.getByTestId('safety-notice')
  await notice.waitFor({ timeout: 60_000 })
  const text = await notice.textContent()
  console.log(vp.name, 'notice:', text)
  if (!text?.includes(vp.ui.notice)) {
    console.error(vp.name, 'no safety summary')
    failures++
  }
  await safety.screenshot({ path: `${outDir}/${vp.name}-safety-box.png` })
  await notice.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${outDir}/${vp.name}-planned.png` })
  if (!vp.mobile) await page.screenshot({ path: `${outDir}/${vp.name}-planned-full.png`, fullPage: true })
  else {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${outDir}/${vp.name}-map.png` })
  }
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
