// Phase 3 screenshots: the town look, the route, and close-ups near a supermarket,
// a health centre and a metro station, plus (after) the dialogue boxes.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4188 &
//        PHASE3_URL=http://127.0.0.1:4188/stepquest/ PHASE3_TAG=after node scripts/screenshot-phase3.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.PHASE3_URL ?? 'http://127.0.0.1:4188/stepquest/'
const tag = process.env.PHASE3_TAG ?? 'after'
const outDir = resolve('screenshots/phase3')
await mkdir(outDir, { recursive: true })

// Demo start and the places we look at (OpenStreetMap data, Benicalap, València).
const START = { lat: 39.4935, lon: -0.392 }
const PLACES = {
  supermarket: { lat: 39.49323, lon: -0.39294 },
  'health-centre': { lat: 39.49355, lon: -0.39055 },
  'metro-station': { lat: 39.49087, lon: -0.39939 },
}
const METRES_PER_TILE = 5
const START_ZOOM = 24 // CSS px per tile when the app centres on the start

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es-ES', ui: { plan: 'Planear misión', home: 'Ir a la salida', start: 'Empezar misión', sim: 'Simular paseo' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en-US', ui: { plan: 'Plan quest', home: 'Go to the start', start: 'Start quest', sim: 'Simulate walk' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'] })

async function open(vp) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile, locale: vp.locale })
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  return page
}

/** Drag the map so `p` ends up in the centre (the app starts centred on START at START_ZOOM). */
async function panTo(page, p) {
  const box = await page.getByTestId('map-canvas').boundingBox()
  await page.getByTestId('map-canvas').scrollIntoViewIfNeeded()
  const box2 = await page.getByTestId('map-canvas').boundingBox()
  const cx = box2.x + box2.width / 2
  const cy = box2.y + box2.height / 2
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos((START.lat * Math.PI) / 180)
  let dx = -((p.lon - START.lon) * mPerDegLon / METRES_PER_TILE) * START_ZOOM
  let dy = ((p.lat - START.lat) * mPerDegLat / METRES_PER_TILE) * START_ZOOM
  const maxStep = Math.min(box.width, box.height) * 0.4
  while (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    const sx = Math.max(-maxStep, Math.min(maxStep, dx))
    const sy = Math.max(-maxStep, Math.min(maxStep, dy))
    await page.mouse.move(cx - sx / 2, cy - sy / 2)
    await page.mouse.down()
    await page.mouse.move(cx + sx / 2, cy + sy / 2, { steps: 8 })
    await page.mouse.up()
    dx -= sx
    dy -= sy
  }
  await page.waitForTimeout(300)
}

async function shot(page, vp, name) {
  await page.waitForTimeout(350)
  const path = resolve(outDir, `${tag}-${vp.name}-${name}.png`)
  await page.screenshot({ path })
  console.log('wrote', path)
}

for (const vp of viewports) {
  // Town view at the start.
  let page = await open(vp)
  await page.getByTestId('map-canvas').scrollIntoViewIfNeeded()
  await shot(page, vp, 'town')

  // Close-ups.
  for (const [name, p] of Object.entries(PLACES)) {
    await page.close()
    page = await open(vp)
    await panTo(page, p)
    await shot(page, vp, name)
  }

  // Planned route, then the detail view at the start.
  await page.close()
  page = await open(vp)
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('distance').waitFor()
  await page.getByRole('button', { name: vp.ui.home }).click()
  await page.getByTestId('map-canvas').scrollIntoViewIfNeeded()
  await shot(page, vp, 'route-detail')

  if (tag === 'after') {
    // Simulated quest: start dialogue, a pickup dialogue, the finish dialogue.
    await page.getByLabel(vp.ui.sim).check()
    await page.locator('select').last().selectOption('120')
    await page.getByRole('button', { name: vp.ui.start }).click()
    await page.locator('.dialog').first().waitFor()
    await page.waitForTimeout(1500)
    await shot(page, vp, 'dialog-start')
    await page.locator('.dialog[data-kind="pickup"]').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(1200)
    await shot(page, vp, 'dialog-pickup')
    await page.locator('.dialog[data-kind="finish"]').waitFor({ timeout: 300_000 })
    await page.waitForTimeout(1500)
    await shot(page, vp, 'dialog-finish')
    // Tap through the speech to the results (singular/plural wording, no signal banner).
    for (let i = 0; i < 6 && !(await page.getByTestId('complete').isVisible()); i++) {
      await page.locator('.dialog').first().click().catch(() => {})
      await page.waitForTimeout(400)
    }
    await page.getByTestId('complete').waitFor()
    await shot(page, vp, 'complete')
  }
  await page.close()
}
await browser.close()
