// Layout checks for the app shell on small, landscape and large screens (task 67): no sideways
// scrolling, the header and tab bar fit, the map keeps a usable height, and the main button of
// the planner can be reached (visible, or inside a scrollable panel). Safe-area insets cannot be
// emulated by the browser; `src/ui/shellCss.test.ts` checks their CSS.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port <free port> &
//        LAYOUT_URL=http://127.0.0.1:<port>/stepquest/ node scripts/check-layout.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.LAYOUT_URL ?? 'http://127.0.0.1:4191/stepquest/'
const outDir = resolve(process.env.LAYOUT_OUT ?? 'screenshots/shell-review')
await mkdir(outDir, { recursive: true })
let failures = 0
const fail = (msg) => {
  console.error('FAIL', msg)
  failures++
}

const SCREENS = [
  { name: 'phone-320', width: 320, height: 568, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'phone-landscape', width: 844, height: 390, mobile: true },
  { name: 'phone-small-landscape', width: 568, height: 320, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'wide', width: 2560, height: 1300, mobile: false },
]

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })

for (const s of SCREENS) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1, hasTouch: s.mobile, isMobile: s.mobile })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('stepquest.locale', 'es')
    localStorage.setItem('stepquest.onboarded', '1')
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.evaluate(() => document.fonts.load('10px "Press Start 2P"').then(() => document.fonts.ready))
  await page.waitForTimeout(200)
  const where = (what) => `${s.name} (${s.width}×${s.height}): ${what}`

  const measure = async (label) => {
    const m = await page.evaluate(() => {
      const doc = document.documentElement
      // Inside the viewport, or inside a panel that can scroll to it.
      const reachable = (el) => {
        const r = el.getBoundingClientRect()
        if (r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5) return true
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY
          if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return true
        }
        return false
      }
      const outside = [...document.querySelectorAll('.topbar *, .tabbar *')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)
        })
        .map((el) => el.className?.baseVal ?? el.className ?? el.tagName)
      const map = document.querySelector('.map-wrap')?.getBoundingClientRect()
      const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect()
      const plan = [...document.querySelectorAll('.planner .pix-btn')].find((b) => /Planear|Empezar/.test(b.textContent ?? ''))
      const rect = plan?.getBoundingClientRect()
      return {
        sideways: doc.scrollWidth > innerWidth + 1,
        outside,
        mapHeight: map?.height ?? 0,
        tabbarVisible: !!tabbar && tabbar.bottom <= innerHeight + 0.5 && tabbar.top >= 0,
        planReachable: plan ? reachable(plan) : false,
        planInView: !!rect && rect.bottom <= (innerWidth < 900 ? (tabbar?.top ?? innerHeight) : innerHeight) + 0.5 && rect.top >= 0,
      }
    })
    if (m.sideways) fail(where(`${label}: page scrolls sideways`))
    if (m.outside.length) fail(where(`${label}: ${[...new Set(m.outside)].join(', ')} stick out of the screen`))
    if (m.mapHeight < 110) fail(where(`${label}: map only ${Math.round(m.mapHeight)} px high`))
    if (!m.tabbarVisible) fail(where(`${label}: tab bar not fully on screen`))
    if (!m.planInView) fail(where(`${label}: the Plan quest button is hidden below the fold`))
    if (!m.planReachable) fail(where(`${label}: planner button cannot be reached`))
    return m
  }

  await measure('before planning')
  await page.screenshot({ path: `${outDir}/${s.name}-1.png` })
  await page.getByRole('button', { name: 'Planear misión' }).click()
  await page.getByRole('button', { name: '¡Empezar misión!' }).waitFor({ timeout: 90_000 })
  await page.waitForTimeout(300)
  await measure('route ready')
  await page.screenshot({ path: `${outDir}/${s.name}-2.png` })
  for (const tab of ['bag', 'hero', 'settings']) {
    await page.getByTestId(`tab-${tab}`).click()
    await page.waitForTimeout(150)
    const side = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    if (side) fail(where(`${tab} tab scrolls sideways`))
    await page.screenshot({ path: `${outDir}/${s.name}-${tab}.png` })
  }
  if (errors.length) fail(where(`page errors: ${errors.join('; ')}`))
  await page.close()
}
await browser.close()
if (failures) {
  console.error(`${failures} layout check(s) failed`)
  process.exit(1)
}
console.log('layout checks passed')
