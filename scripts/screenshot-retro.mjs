// Retro UX checks on a phone (390×844) and a desktop window: every control
// offers a press area of at least 48 px (its own box or its invisible ::after
// area), the quest map sits in the console screen and stays large, panels have
// no rounded corners (panels use notched box-shadow corners; the pill and round
// buttons are the intended exception and get stepped corners from a clip-path
// polygon, never border-radius), and the Hero tab dresses the walker. Screenshots go to
// screenshots/retro-ux/.
// Usage: npm run build && npx vite preview --host 127.0.0.1 --port 4190 &
//        RETRO_URL=http://127.0.0.1:4190/stepquest/ node scripts/screenshot-retro.mjs
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.env.RETRO_URL ?? 'http://127.0.0.1:4190/stepquest/'
const outDir = resolve(process.env.RETRO_OUT ?? 'screenshots/retro-ux')
await mkdir(outDir, { recursive: true })
let failures = 0
const fail = (msg) => {
  console.error('FAIL', msg)
  failures++
}

/** Smallest press area among visible controls, with the offenders. */
async function pressAreas(page) {
  return page.evaluate(() => {
    const small = []
    for (const el of document.querySelectorAll('button, [role="tab"], [role="radio"], .chip, .check, select, summary')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue
      const a = getComputedStyle(el, '::after')
      const ext = (v) => (a.content !== 'none' && a.position === 'absolute' ? Math.max(0, -parseFloat(v) || 0) : 0)
      const w = r.width + ext(a.left) + ext(a.right)
      const h = r.height + ext(a.top) + ext(a.bottom)
      if (Math.min(w, h) < 47.5) small.push(`${el.className || el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" ${Math.round(w)}×${Math.round(h)}`)
    }
    return small
  })
}

async function roundCorners(page) {
  return page.evaluate(() => {
    const radius = [...document.querySelectorAll('.box, .hud, .dialog, .pix-btn, .swatch, .avatar, .steps-pill, .complete-box, .console, .console-bezel')]
      .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0)
      .map((el) => el.className)
    // Pill and round buttons: stepped corners (clip-path on the outline and the fill), square box for the press area.
    const flat = [...document.querySelectorAll('.pix-btn')]
      .filter((el) => getComputedStyle(el, '::before').clipPath === 'none' || getComputedStyle(el, '::after').clipPath === 'none')
      .map((el) => `${el.className} (no stepped corners)`)
    const round = [...document.querySelectorAll('.pix-btn.round')]
      .filter((el) => Math.abs(el.getBoundingClientRect().width - el.getBoundingClientRect().height) > 0.5)
      .map((el) => `${el.className} (not square)`)
    return [...radius, ...flat, ...round]
  })
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--headless=new', '--no-sandbox', '--disable-gpu'] })
const errors = []

async function open(viewport, mobile) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('stepquest.locale', 'en')
    localStorage.setItem('stepquest.onboarded', '1') // skip the first-run intro
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByTestId('map-canvas').waitFor()
  await page.locator('[aria-label="Close"]').click().catch(() => {})
  return page
}

const page = await open({ width: 390, height: 844 }, true)
await page.getByRole('button', { name: 'Plan quest' }).click()
await page.getByRole('button', { name: 'Start quest' }).waitFor({ timeout: 90_000 })
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/1-planned.png` })
for (const s of await pressAreas(page)) fail(`press area under 48 px on the map tab: ${s}`)
await page.getByRole('button', { name: 'Edit' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/2-planner-open.png` })
for (const s of await pressAreas(page)) fail(`press area under 48 px in the open planner: ${s}`)
await page.getByRole('button', { name: 'Hide' }).click()

// Hero: dress the walker.
await page.getByTestId('tab-hero').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/3-hero.png`, fullPage: false })
for (const s of await pressAreas(page)) fail(`press area under 48 px on the hero tab: ${s}`)
await page.getByRole('radio', { name: 'Girl' }).click()
await page.getByRole('radio', { name: 'Cap: colour 6' }).click()
await page.getByRole('radio', { name: 'Shirt: colour 4' }).click()
await page.getByRole('radio', { name: 'Hair: colour 5' }).click()
await page.getByRole('radio', { name: 'Skin: colour 5' }).click()
await page.getByRole('radio', { name: 'Pants: colour 2' }).click()
await page.waitForTimeout(400)
await page.getByTestId('walker-preview').scrollIntoViewIfNeeded()
await page.screenshot({ path: `${outDir}/4-hero-dressed.png` })
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('stepquest.look')))
console.log('saved look:', JSON.stringify(saved))
if (saved?.body !== 'girl' || saved.cap !== 5) fail('look not saved')
const xp = await page.locator('.sheet:not([hidden])').filter({ hasText: /\bXP\b|level/i }).count()
if (xp) fail('hero tab mentions XP or levels')

// Settings sheet.
await page.getByTestId('tab-settings').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/5-settings.png` })
for (const s of await pressAreas(page)) fail(`press area under 48 px in settings: ${s}`)

// Quest in the console.
await page.getByTestId('tab-bag').click()
await page.getByText('Simulate walk').click()
await page.getByTestId('tab-map').click()
await page.getByRole('button', { name: 'Start quest' }).click()
await page.getByTestId('hud').waitFor()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${outDir}/6-quest-dialog.png` })
for (let i = 0; i < 4 && (await page.locator('.dialog').count()); i++) {
  await page.locator('.dialog').click()
  await page.waitForTimeout(300)
}
await page.waitForTimeout(3000)
const screen = await page.getByTestId('console-screen').boundingBox()
const share = (screen.width * screen.height) / (390 * 844)
console.log(`console screen ${Math.round(screen.width)}×${Math.round(screen.height)} = ${(share * 100).toFixed(0)} % of the phone`)
if (share < 0.8) fail('map screen too small inside the console')
for (const s of await pressAreas(page)) fail(`press area under 48 px in the quest: ${s}`)
const round = await roundCorners(page)
if (round.length) fail(`rounded corners: ${round.join(', ')}`)
await page.screenshot({ path: `${outDir}/7-quest.png` })
await page.close()

// Desktop quest.
const desk = await open({ width: 1280, height: 800 }, false)
await desk.getByRole('button', { name: 'Plan quest' }).click()
await desk.getByRole('button', { name: 'Start quest' }).waitFor({ timeout: 90_000 })
await desk.getByTestId('tab-bag').click()
await desk.getByText('Simulate walk').click()
await desk.getByTestId('tab-map').click()
await desk.getByRole('button', { name: 'Start quest' }).click()
await desk.getByTestId('hud').waitFor()
for (let i = 0; i < 4 && (await desk.locator('.dialog').count()); i++) {
  await desk.locator('.dialog').click()
  await desk.waitForTimeout(300)
}
await desk.waitForTimeout(2500)
await desk.screenshot({ path: `${outDir}/8-desktop-quest.png` })
await desk.close()

if (errors.length) fail(`page errors: ${errors.join(' | ')}`)
await browser.close()
if (failures) process.exit(1)
console.log('ok')
