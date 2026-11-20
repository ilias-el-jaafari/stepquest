// Phase 1 screenshots: a 10k-step loop and an A→B route, on mobile and desktop.
// Usage: npm run build && npx vite preview --port 4174 & node scripts/screenshot-phase1.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.PHASE1_URL ?? 'http://127.0.0.1:4174/stepquest/'
const outDir = resolve('screenshots/phase1')
await mkdir(outDir, { recursive: true })

const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true, locale: 'es-ES', ui: { plan: 'Planear misión', oneway: 'A → B', home: 'Ir a la salida', fit: 'Ver toda la ruta' } },
  { name: 'desktop-1280x800', width: 1280, height: 800, mobile: false, locale: 'en-US', ui: { plan: 'Plan quest', oneway: 'A → B', home: 'Go to the start', fit: 'Show whole route' } },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
const shots = []

for (const vp of viewports) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
    locale: vp.locale,
  })
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.ready)

  const shot = async (name, fullPage = false) => {
    await page.waitForTimeout(350)
    const path = resolve(outDir, `${vp.name}-${name}.png`)
    await page.screenshot({ path, fullPage })
    shots.push(path)
    console.log('wrote', path)
  }

  // 1) 10,000-step loop from the demo start.
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('distance').waitFor()
  console.log(vp.name, 'loop:', await page.getByTestId('distance').innerText(), '|', await page.getByTestId('steps').innerText())
  await shot('loop-10k')
  if (vp.mobile) await shot('loop-10k-fullpage', true)
  await page.getByRole('button', { name: vp.ui.home }).click()
  await shot('loop-10k-detail')

  // 2) A→B with the same 10,000-step goal (needs a detour).
  await page.getByRole('radio', { name: vp.ui.oneway }).click()
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('distance').waitFor()
  console.log(vp.name, 'A→B:', await page.getByTestId('distance').innerText(), '|', await page.getByTestId('steps').innerText())
  await shot('a-to-b-10k')
  if (vp.mobile) await shot('a-to-b-10k-fullpage', true)

  // 3) Infeasible: a goal below the direct distance.
  await page.getByRole('spinbutton').first().fill('1000')
  await page.getByRole('button', { name: vp.ui.plan }).click()
  await page.getByTestId('feasibility').waitFor()
  console.log(vp.name, 'too short:', await page.getByTestId('feasibility').innerText())
  await shot('a-to-b-too-short', vp.mobile)

  await page.close()
}

await browser.close()
console.log(shots.join('\n'))
