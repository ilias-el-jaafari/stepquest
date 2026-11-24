// Phase 2 screenshots: active quest HUD mid-route, a checkpoint pickup and the
// quest complete screen, using the built-in walk simulator.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4188 &
//        PHASE2_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase2.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.PHASE2_URL ?? 'http://127.0.0.1:4188/stepquest/'
const outDir = resolve('screenshots/phase2')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es-ES', ui: { plan: 'Planear misión', start: 'Empezar misión', sim: 'Simular paseo (demo)', speed: 'Velocidad' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en-US', ui: { plan: 'Plan quest', start: 'Start quest', sim: 'Simulate walk (demo)', speed: 'Speed' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] })
const shots = []

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile, locale: vp.locale })
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('stepquest.onboarded', '1')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)

  const shot = async (name) => {
    const path = resolve(outDir, `${vp.name}-${name}.png`)
    await page.screenshot({ path })
    shots.push(path)
    console.log('wrote', path)
  }

  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByRole('button', { name: vp.ui.start }).waitFor()
  await page.getByRole('checkbox', { name: vp.ui.sim }).check()
  await page.getByRole('combobox', { name: vp.ui.speed }).selectOption('120')
  await page.getByRole('button', { name: vp.ui.start }).click()
  await page.getByTestId('hud').waitFor()

  // 1) Mid-route HUD after the third checkpoint, once the toast is gone.
  await page.getByTestId('collected').filter({ hasText: '3/10' }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(2200)
  console.log(vp.name, 'HUD:', (await page.getByTestId('hud').innerText()).replace(/\s+/g, ' '))
  await shot('quest-hud-mid-route')

  // 2) The pickup of checkpoint 4: toast + sparkle burst.
  await page.getByTestId('pickup-toast').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(250)
  await shot('checkpoint-pickup')

  // 3) Quest complete.
  await page.getByTestId('complete').waitFor({ timeout: 120_000 })
  await page.waitForTimeout(700)
  console.log(vp.name, 'complete:', (await page.getByTestId('complete').innerText()).replace(/\s+/g, ' '))
  await shot('quest-complete')
  await page.close()
}

await browser.close()
console.log(shots.join('\n'))
