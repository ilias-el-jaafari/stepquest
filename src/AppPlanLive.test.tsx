import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.ts'
import { en } from './i18n/en.ts'
import type { LatLon } from './geo/geo.ts'
import { haversine } from './geo/geo.ts'
import { LodLayer } from './lod/layer.ts'
import { LodStore } from './lod/store.ts'
import { tileToLod } from './lod/tile.ts'
import { encodeMvt, px, type FixtureFeature } from './vector/testing.ts'
import { tileBBox, tilesInBBox } from './vector/tileMath.ts'
import { RETRY_MS } from './world/walkArea.ts'

/**
 * Regression for the field test on an iPhone (routing requirement 12, quest 6e): "Use my location" in central
 * València, outside the bundled Benicalap extract, then "Plan quest" did nothing. Here the same flow runs with a
 * street grid served as vector tiles and Overpass refusing to answer: the plan must still end with a route.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

// The map is replaced by one button that taps a place on it (the real map reads touch gestures).
const tapAt = vi.hoisted(() => ({ b: { lat: 39.4765, lon: -0.3705 } as { lat: number; lon: number }, zoom: undefined as number | undefined }))
vi.mock('./ui/MapView.tsx', async () => {
  const { memo } = await import('react')
  return {
    MapView: memo(function MapView(p: { onTap: (p: LatLon, zoom: number) => void }) {
      return (
        <div data-testid="map-canvas">
          <button type="button" data-testid="tap-b" onClick={() => p.onTap(tapAt.b, tapAt.zoom as number)}>
            tap
          </button>
        </div>
      )
    }),
  }
})

// The level-of-detail layer is off under Vitest, so a test that taps a street far away gives the app a layer filled from the same tiles.
const lodTest = vi.hoisted(() => ({ layer: undefined as LodLayer | undefined }))
vi.mock('./app/useLod.ts', async (original) => {
  const real = await original<typeof import('./app/useLod.ts')>()
  return {
    ...real,
    useLod: (args: Parameters<typeof real.useLod>[0]) => {
      const r = real.useLod(args)
      const l = lodTest.layer
      return l ? { ...r, snapAt: (...a: Parameters<LodLayer['snapAt']>) => l.snapAt(...a), snapAnswer: (...a: Parameters<LodLayer['snapAnswer']>) => l.snapAnswer(...a) } : r
    },
  }
})

const HERE = { lat: 39.4697, lon: -0.3774 }
const STEP_LAT = 0.001
const STEP_LON = 0.0013

/**
 * The field repro (Carretera Bétera - Riba-roja): 9 km north of the start a primary road marked foot=no crosses a gap in the
 * grid. The nearest walkable street is a tertiary "Calle Norte" 167 m south of it (the grid's own nodes are 167 m and more away
 * from the road, beyond the 150 m the planner accepts). Name lines carry no access tags, as in the real tiles.
 */
const ROAD_LAT = Math.round((HERE.lat + 9_000 / 111_195) / STEP_LAT) * STEP_LAT + 0.0005
const STREET_LAT = Math.round((ROAD_LAT - 0.0005) / STEP_LAT) * STEP_LAT - STEP_LAT
const GAP = { south: STREET_LAT + 1e-9, north: ROAD_LAT + 0.0020 }
const inGap = (la: number) => la > GAP.south && la < GAP.north
let withGap = false

/** A walkable street grid, with a vertex at every crossing, as one z14 tile of the vector service. */
function gridTile(x: number, y: number): Uint8Array {
  const t = { z: 14, x, y }
  const b = tileBBox(t)
  const lats: number[] = []
  const lons: number[] = []
  for (let v = Math.floor((b.south - 0.002) / STEP_LAT) * STEP_LAT; v < b.north + 0.002; v += STEP_LAT) lats.push(v)
  for (let v = Math.floor((b.west - 0.002) / STEP_LON) * STEP_LON; v < b.east + 0.002; v += STEP_LON) lons.push(v)
  const features: FixtureFeature[] = []
  const names: FixtureFeature[] = []
  const gap = withGap
  const isStreet = (la: number) => gap && Math.abs(la - STREET_LAT) < 1e-9
  for (const la of lats) {
    if (gap && inGap(la)) continue
    const geometry: [number, number][][] = [lons.map((lo) => px(t, la, lo))]
    features.push({ type: 2, props: { class: isStreet(la) ? 'tertiary' : 'minor' }, geometry })
    if (isStreet(la)) names.push({ type: 2, props: { class: 'tertiary', name: 'Calle Norte' }, geometry })
  }
  for (const lo of lons) {
    // The N-S streets stop at the gap and go on after it.
    const runs: number[][] = [[]]
    for (const la of lats) {
      if (gap && inGap(la)) runs.push([])
      else runs[runs.length - 1]!.push(la)
    }
    features.push({ type: 2, props: { class: 'minor' }, geometry: runs.filter((r) => r.length > 1).map((r) => r.map((la) => px(t, la, lo))) })
  }
  if (gap) {
    const road: [number, number][][] = [[px(t, ROAD_LAT, b.west - 0.002), px(t, ROAD_LAT, b.east + 0.002)]]
    features.push({ type: 2, props: { class: 'primary', foot: 'no' }, geometry: road })
    names.push({ type: 2, props: { class: 'primary', name: 'Carretera Bétera - Riba-roja' }, geometry: road })
  }
  return encodeMvt([
    { name: 'transportation', features },
    ...(names.length ? [{ name: 'transportation_name', features: names }] : []),
  ])
}

type Net = { tiles: 'ok' | 'down'; overpass: string[]; tileRequests: string[] }
let net: Net
let host: HTMLDivElement
let root: Root | undefined
const REAL_RETRY_MS = [...RETRY_MS]

function fakeFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  if (/interpreter/.test(url)) {
    net.overpass.push(url)
    return Promise.reject(new TypeError('offline'))
  }
  if (url.endsWith('/planet')) return Promise.resolve(new Response(JSON.stringify({ tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'], maxzoom: 14 })))
  const m = /tiles\.test\/14\/(\d+)\/(\d+)\.pbf/.exec(url)
  if (m) {
    net.tileRequests.push(url)
    if (net.tiles === 'down') return Promise.reject(new TypeError('offline'))
    return Promise.resolve(new Response(gridTile(Number(m[1]), Number(m[2])).slice().buffer as ArrayBuffer))
  }
  return Promise.reject(new TypeError(`unexpected ${url}`))
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'en')
  localStorage.setItem('stepquest.onboarded', '1')
  net = { tiles: 'ok', overpass: [], tileRequests: [] }
  withGap = false
  lodTest.layer = undefined
  tapAt.zoom = undefined
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lon, accuracy: 10 }, timestamp: Date.now() }) },
  })
  // The tile back-off (1 s, then 2 s, per tile) runs on real timers; here it is a few ms so the failure path
  // does not depend on how fast the machine is. Production keeps its values.
  RETRY_MS.splice(0, RETRY_MS.length, 5, 10)
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  host.remove()
  RETRY_MS.splice(0, RETRY_MS.length, ...REAL_RETRY_MS)
  vi.unstubAllGlobals()
  lodTest.layer = undefined
  withGap = false
})

/**
 * Start the app. Where the browser already allows location the app finds the walker by itself right after
 * start-up, so a test that needs the tiles down must set `net.tiles` before this, never after.
 */
async function mount() {
  if (root) return
  root = createRoot(host)
  await act(async () => root!.render(<I18nProvider><App /></I18nProvider>))
}

async function waitFor(check: () => boolean, ms = 15_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out: ${host.textContent?.slice(0, 400)}`)
    await act(async () => new Promise((r) => setTimeout(r, 40)))
  }
}

const button = (label: string | RegExp) => [...host.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) as HTMLButtonElement | undefined
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click())

async function startAtMyLocation() {
  await mount()
  await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
  // Where the browser already allows location the app finds the walker by itself; elsewhere it offers the button.
  await act(async () => new Promise((r) => setTimeout(r, 100)))
  const use = button(/Use my location/)
  if (use && !/Start set to your location/.test(host.textContent ?? '')) await click(use)
  await waitFor(() => /Start set to your location/.test(host.textContent ?? ''))
}

describe('planning outside the bundled map (field test, iPhone)', () => {
  it('Loop: use my location in central València, then Plan quest, ends with a route and never asks Overpass', async () => {
    await startAtMyLocation()
    await click(button('5k'))
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 5000)).toBeLessThanOrEqual(250)
    expect(net.tileRequests.length).toBeGreaterThan(0)
    expect(button('▶ Start quest') ?? button(/Start quest/)).toBeDefined()
  })

  it('A → B: choose A → B, tap the finish, Plan quest, ends with a route', async () => {
    await startAtMyLocation()
    await click(button('A → B'))
    await click(button('5k'))
    await click(host.querySelector('[data-testid="tap-b"]') ?? undefined)
    expect(host.textContent).toContain('Finish: 39.4765')
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 5000)).toBeLessThanOrEqual(250)
  })

  it('A → B to a street 8.5 km away: the streets along the way load (not just around the start) and the plan crosses them', async () => {
    tapAt.b = { lat: HERE.lat + 8_500 / 111_195, lon: HERE.lon }
    await startAtMyLocation()
    await click(button('A → B'))
    // 8k (6 km) is shorter than the way across, so the answer names the nearest goal; 12k would fit and plan at once.
    await click(button('8k'))
    await click(host.querySelector('[data-testid="tap-b"]') ?? undefined)
    expect(host.textContent).toContain('Finish: 39.54')
    await click(button('Plan quest'))
    // The streets between the two points are in the network, so the planner knows the way across and names the nearest goal.
    await waitFor(() => !!button(/^Use [\d,]+ steps$/), 30_000)
    expect(host.querySelector('[data-testid="feasibility"]')).not.toBeNull()
    const use = button(/^Use [\d,]+ steps$/)!
    const goal = Number(/[\d,]+/.exec(use.textContent!)![0].replace(/,/g, ''))
    expect(goal).toBeGreaterThan(11_000)
    expect(goal).toBeLessThan(15_000)
    await click(use)
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''), 30_000)
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - goal)).toBeLessThanOrEqual(goal * 0.05)
    // Tiles were asked for along the line: some more than 4 km and some more than 7 km north of the start, none twice.
    const norths = net.tileRequests.map((u) => tileBBox({ z: 14, x: Number(/14\/(\d+)\/(\d+)/.exec(u)![1]), y: Number(/14\/(\d+)\/(\d+)/.exec(u)![2]) }).south - HERE.lat)
    expect(norths.some((d) => d > 0.04)).toBe(true)
    expect(norths.some((d) => d > 0.065)).toBe(true)
    expect(new Set(net.tileRequests).size).toBe(net.tileRequests.length)
    expect(net.tileRequests.length).toBeLessThanOrEqual(36)
    expect(net.overpass.filter((u) => /nothing/.test(u))).toHaveLength(0)
  }, 60_000)

  it('the first press shows "Planning…" in the same render, then names the step', async () => {
    await startAtMyLocation()
    await click(button('5k'))
    // Streets that are slow: the busy state must already be there.
    const plan = button('Plan quest')!
    act(() => {
      plan.click()
    })
    expect(button(/Planning…/)?.disabled).toBe(true)
    expect(button(/Planning…/)?.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''))
  })

  it('when the streets cannot be loaded the plan ends with a message and Retry, and Retry works once they can', async () => {
    net.tiles = 'down'
    await mount()
    await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
    await act(async () => new Promise((r) => setTimeout(r, 100)))
    const use = button(/Use my location/)
    if (use) await click(use)
    await waitFor(() => !!host.querySelector('[data-testid="locate-area-error"]'), 20_000)
    expect(host.querySelector('[data-testid="locate-area-error"]')?.textContent).toContain(en['loc.areaFailed'])
    await click(button('5k'))
    await click(button('Plan quest'))
    await waitFor(() => !!host.querySelector('[data-testid="plan-error"]'), 20_000)
    expect(host.querySelector('[data-testid="plan-error"]')?.textContent).toContain(en['error.planStreets'])
    expect(button(/Planning…/)).toBeUndefined()
    net.tiles = 'ok'
    await click(host.querySelector('[data-testid="plan-retry"]') ?? undefined)
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''), 20_000)
    expect(host.querySelector('[data-testid="plan-error"]')).toBeNull()
  }, 60_000)

  it('without a finish A → B says why the button waits', async () => {
    await startAtMyLocation()
    await click(button('A → B'))
    expect(host.querySelector('[data-testid="plan-hint"]')?.textContent).toContain('Tap the map to set your finish')
  })
})

/** The level-of-detail tiles around the finish, as the app would have loaded them, in a layer the app's tap reads. */
function loadLodAroundFinish() {
  const store = new LodStore()
  const layer = new LodLayer(store)
  layer.setHero(HERE)
  const box = { south: ROAD_LAT - 0.03, north: ROAD_LAT + 0.03, west: HERE.lon - 0.05, east: HERE.lon + 0.05 }
  for (const id of tilesInBBox(box, 14)) store.put(tileToLod(gridTile(id.x, id.y), id))
  lodTest.layer = layer
}

describe('A → B finish on a road the walkers may not use (requirement 26.7 to 26.9, routing 14.5)', () => {
  const note = () => host.querySelector('[data-testid="finish-note"]')
  async function placeFinish(zoom: number) {
    withGap = true
    loadLodAroundFinish()
    tapAt.b = { lat: ROAD_LAT, lon: HERE.lon }
    tapAt.zoom = zoom
    await startAtMyLocation()
    await click(button('A → B'))
    await click(button('8k'))
    await click(host.querySelector('[data-testid="tap-b"]') ?? undefined)
    // The line is hidden while the streets of the corridor load, then comes back.
    await waitFor(() => !!note(), 30_000)
  }

  it('the finish snaps to the walkable street, the banner names that street with the distance, and the plan works', async () => {
    await placeFinish(0.5)
    // Not the primary road with foot=no that lies under the tap, but the walkable street 167 m south of it.
    expect(note()?.textContent).toMatch(/^Finish: Calle Norte · 8\.9 km$/)
    expect(note()?.textContent).not.toContain('Carretera')
    const expected = haversine(HERE, { lat: STREET_LAT, lon: HERE.lon })
    expect(Math.abs(Number(note()?.getAttribute('data-finish-m')) - expected)).toBeLessThan(4)
    await click(button('Plan quest'))
    await waitFor(() => !!button(/^Use [\d,]+ steps$/) || /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''), 30_000)
    expect(host.querySelector('[data-testid="plan-error"]')).toBeNull()
    expect(host.textContent).not.toContain(en['error.unreachable'])
    await click(button(/^Use [\d,]+ steps$/))
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''), 30_000)
  }, 60_000)

  it('says at once, at tap time, when no walkable street is within reach of the tap', async () => {
    // Zoomed in (reach 12 m) the road under the tap is the only line there, and it is not walkable.
    await placeFinish(24)
    expect(note()?.textContent).toBe(en['map.finishNone'])
    expect(note()?.textContent).not.toContain('Carretera')
  }, 60_000)
})
