// Phase 4 screenshots: the sound controls (planner header and quest HUD), plus a
// check that the Web Audio graph runs in a real browser during a simulated walk.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4188 &
//        PHASE4_URL=http://127.0.0.1:4188/stepquest/ node scripts/screenshot-phase4.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.PHASE4_URL ?? 'http://127.0.0.1:4188/stepquest/'
const outDir = resolve('screenshots/phase4')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es-ES', ui: { plan: 'Planear misión', start: 'Empezar misión', sim: 'Simular paseo' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en-US', ui: { plan: 'Plan quest', start: 'Start quest', sim: 'Simulate walk' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] })
let failures = 0

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile, locale: vp.locale })
  // Count what the app asks of Web Audio.
  await page.addInitScript(() => {
    const stats = { contexts: 0, oscillators: 0, buffers: 0, sources: 0, maxBufferSeconds: 0 }
    window.__audioStats = stats
    const C = window.AudioContext
    window.AudioContext = class extends C {
      constructor(...args) {
        super(...args)
        stats.contexts++
        window.__ctx = this
      }
      createOscillator() {
        stats.oscillators++
        return super.createOscillator()
      }
      createBufferSource() {
        stats.sources++
        return super.createBufferSource()
      }
      createBuffer(ch, len, sr) {
        stats.buffers++
        stats.maxBufferSeconds = Math.max(stats.maxBufferSeconds, len / sr)
        return super.createBuffer(ch, len, sr)
      }
    }
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('stepquest.onboarded', '1')
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)
  const before = await page.evaluate(() => window.__audioStats.contexts)
  if (before !== 0) {
    console.error('AudioContext created before any gesture')
    failures++
  }

  // Planner: the sound button in the header, panel open.
  await page.getByTestId('sound-button').click()
  await page.getByTestId('sound-panel').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(outDir, `${vp.name}-planner-sound-menu.png`) })
  await page.keyboard.press('Escape')

  // Simulated quest at 120×: music, voice and effects run.
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('distance').waitFor()
  await page.getByLabel(vp.ui.sim).check()
  await page.locator('select').last().selectOption('120')
  await page.getByRole('button', { name: vp.ui.start }).click()
  await page.locator('.dialog[data-kind="pickup"]').waitFor({ timeout: 120_000 })
  await page.waitForTimeout(800)
  await page.locator('.hud-bottom [data-testid="sound-button"]').click()
  await page.getByTestId('sound-panel').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(outDir, `${vp.name}-quest-sound-menu.png`) })
  const stats = await page.evaluate(() => ({ ...window.__audioStats, state: window.__ctx?.state }))
  console.log(vp.name, JSON.stringify(stats))
  if (stats.contexts !== 1 || stats.state !== 'running' || stats.oscillators < 50 || stats.maxBufferSeconds < 1) {
    console.error('audio did not run as expected')
    failures++
  }
  // Reload mid-quest: the quest resumes silently and sound waits for the first tap.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('hud').waitFor()
  await page.waitForTimeout(500)
  const afterReload = await page.evaluate(() => window.__audioStats.contexts)
  if (afterReload !== 0) {
    console.error('AudioContext created on reload without a gesture')
    failures++
  }
  await page.getByTestId('sound-resume').click()
  await page.waitForTimeout(500)
  const resumed = await page.evaluate(() => ({ contexts: window.__audioStats.contexts, state: window.__ctx?.state, chip: !!document.querySelector('[data-testid="sound-resume"]') }))
  console.log(vp.name, 'after reload + tap', JSON.stringify(resumed))
  if (resumed.contexts !== 1 || resumed.state !== 'running' || resumed.chip) {
    console.error('sound did not resume after the tap')
    failures++
  }
  if (errors.length) {
    console.error('errors:', errors)
    failures++
  }
  await page.close()
}
await browser.close()
if (failures) process.exit(1)
