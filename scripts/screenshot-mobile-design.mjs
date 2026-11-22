// Mobile design screenshots: every tab on a phone (390×844, Spanish), the
// desktop layout (1280×800, English) and a quest dialogue on the phone (to
// check it no longer covers the map credit line).
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4190 &
//        MD_URL=http://127.0.0.1:4190/stepquest/ node scripts/screenshot-mobile-design.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.MD_URL ?? 'http://127.0.0.1:4190/stepquest/'
const outDir = resolve(process.env.MD_OUT ?? 'screenshots/mobile-design')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es', ui: { plan: 'Planear misión', start: 'Empezar misión', sim: 'Simular paseo' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en', ui: { plan: 'Plan quest', start: 'Start quest', sim: 'Simulate walk' } },
]
const tabs = ['map', 'bag', 'hero', 'settings']

const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

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
    localStorage.setItem('stepquest.avoidStreets', JSON.stringify(['Carrer del Pintor Matarana']))
    localStorage.setItem('stepquest.dailySteps', JSON.stringify({ day: new Date().toLocaleDateString('sv'), steps: 4280 }))
  }, vp.locale)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)
  // The page itself must not scroll: the app fills the screen.
  const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }))
  if (scroll.w > vp.width + 1 || scroll.h > vp.height + 1) {
    console.error(vp.name, 'page overflows', scroll)
    failures++
  }
  await page.screenshot({ path: `${outDir}/${vp.name}-map.png` })
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByRole('button', { name: vp.ui.start }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${outDir}/${vp.name}-map-planned.png` })
  for (const tab of tabs.slice(1)) {
    await page.getByTestId(`tab-${tab}`).click()
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${outDir}/${vp.name}-${tab}.png` })
  }
  await page.getByTestId('info-button').click()
  await page.getByTestId('info-panel').waitFor()
  await page.screenshot({ path: `${outDir}/${vp.name}-settings-info.png` })
  await page.keyboard.press('Escape')
  await page.getByTestId('tab-map').click()

  // Quest: the dialogue box must not cover the map credit line.
  await page.getByTestId('tab-bag').click()
  await page.getByText(vp.ui.sim).click()
  await page.getByTestId('tab-map').click()
  await page.getByRole('button', { name: vp.ui.start }).click()
  await page.locator('.dialog').waitFor()
  await page.waitForTimeout(600)
  const dialog = await page.locator('.dialog').boundingBox()
  const credit = await page.locator('.quest .map-attribution').boundingBox()
  if (overlap(dialog, credit)) {
    console.error(vp.name, 'dialogue covers the credit line', dialog, credit)
    failures++
  }
  await page.screenshot({ path: `${outDir}/${vp.name}-quest-dialogue.png` })
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
