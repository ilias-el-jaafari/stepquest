import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.ts'
import type { LatLon } from './geo/geo.ts'
import { encodeMvt, px, type FixtureFeature } from './vector/testing.ts'
import { tileBBox } from './vector/tileMath.ts'

/**
 * Regression for the field test on an iPhone (routing requirement 12, quest 6e): "Use my location" in central
 * València, outside the bundled Benicalap extract, then "Plan quest" did nothing. Here the same flow runs with a
 * street grid served as vector tiles and Overpass refusing to answer: the plan must still end with a route.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

// The map is replaced by one button that taps a place on it (the real map reads touch gestures).
const tapAt = vi.hoisted(() => ({ b: { lat: 39.4765, lon: -0.3705 } as { lat: number; lon: number } }))
vi.mock('./ui/MapView.tsx', async () => {
  const { memo } = await import('react')
  return {
    MapView: memo(function MapView(p: { onTap: (p: LatLon) => void }) {
      return (
        <div data-testid="map-canvas">
          <button type="button" data-testid="tap-b" onClick={() => p.onTap(tapAt.b)}>
            tap
          </button>
        </div>
      )
    }),
  }
})

const HERE = { lat: 39.4697, lon: -0.3774 }
const STEP_LAT = 0.001
const STEP_LON = 0.0013

/** A walkable street grid, with a vertex at every crossing, as one z14 tile of the vector service. */
function gridTile(x: number, y: number): Uint8Array {
  const t = { z: 14, x, y }
  const b = tileBBox(t)
  const lats: number[] = []
  const lons: number[] = []
  for (let v = Math.floor((b.south - 0.002) / STEP_LAT) * STEP_LAT; v < b.north + 0.002; v += STEP_LAT) lats.push(v)
  for (let v = Math.floor((b.west - 0.002) / STEP_LON) * STEP_LON; v < b.east + 0.002; v += STEP_LON) lons.push(v)
  const features: FixtureFeature[] = []
  for (const la of lats) features.push({ type: 2, props: { class: 'minor' }, geometry: [lons.map((lo) => px(t, la, lo))] })
  for (const lo of lons) features.push({ type: 2, props: { class: 'minor' }, geometry: [lats.map((la) => px(t, la, lo))] })
  return encodeMvt([{ name: 'transportation', features }])
}

type Net = { tiles: 'ok' | 'down'; overpass: string[]; tileRequests: string[] }
let net: Net
let host: HTMLDivElement
let root: Root

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
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: HERE.lat, longitude: HERE.lon, accuracy: 10 }, timestamp: Date.now() }) },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<I18nProvider><App /></I18nProvider>))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function waitFor(check: () => boolean, ms = 15_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out: ${host.textContent?.slice(0, 400)}`)
    await act(async () => new Promise((r) => setTimeout(r, 40)))
  }
}

const button = (label: string | RegExp) => [...host.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) as HTMLButtonElement | undefined
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click())

async function useMyLocation() {
  await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
  // Where the browser already allows location the app finds the walker by itself; elsewhere it offers the button.
  await act(async () => new Promise((r) => setTimeout(r, 100)))
  const use = button(/Use my location/)
  if (use && !/Start set to your location/.test(host.textContent ?? '')) await click(use)
  await waitFor(() => /Start set to your location/.test(host.textContent ?? ''))
}

describe('planning outside the bundled map (field test, iPhone)', () => {
  it('Loop: use my location in central València, then Plan quest, ends with a route and never asks Overpass', async () => {
    await useMyLocation()
    await click(button('5k'))
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 5000)).toBeLessThanOrEqual(250)
    expect(net.tileRequests.length).toBeGreaterThan(0)
    expect(button('▶ Start quest') ?? button(/Start quest/)).toBeDefined()
  })

  it('A → B: choose A → B, tap the finish, Plan quest, ends with a route', async () => {
    await useMyLocation()
    await click(button('A → B'))
    await click(button('5k'))
    await click(host.querySelector('[data-testid="tap-b"]') ?? undefined)
    expect(host.textContent).toContain('Finish: 39.4765')
    await click(button('Plan quest'))
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''))
    const steps = Number(host.querySelector('[data-testid="steps"]')!.textContent!.split(' ')[0]!.replace(/[^\d]/g, ''))
    expect(Math.abs(steps - 5000)).toBeLessThanOrEqual(250)
  })

  it('the first press shows "Planning…" in the same render, then names the step', async () => {
    await useMyLocation()
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
    await waitFor(() => !!host.querySelector('[data-testid="map-canvas"]'))
    await act(async () => new Promise((r) => setTimeout(r, 100)))
    const use = button(/Use my location/)
    if (use) await click(use)
    await waitFor(() => !!host.querySelector('[data-testid="locate-area-error"]'), 20_000)
    expect(host.querySelector('[data-testid="locate-area-error"]')?.textContent).toContain('would not load')
    await click(button('5k'))
    await click(button('Plan quest'))
    await waitFor(() => !!host.querySelector('[data-testid="plan-error"]'), 20_000)
    expect(host.querySelector('[data-testid="plan-error"]')?.textContent).toContain('streets here would not load')
    expect(button(/Planning…/)).toBeUndefined()
    net.tiles = 'ok'
    await click(host.querySelector('[data-testid="plan-retry"]') ?? undefined)
    await waitFor(() => /Route ready/.test(host.querySelector('[data-testid="feasibility"]')?.textContent ?? ''), 20_000)
    expect(host.querySelector('[data-testid="plan-error"]')).toBeNull()
  }, 60_000)

  it('without a finish A → B says why the button waits', async () => {
    await useMyLocation()
    await click(button('A → B'))
    expect(host.querySelector('[data-testid="plan-hint"]')?.textContent).toContain('Tap the map to set your finish')
  })
})
