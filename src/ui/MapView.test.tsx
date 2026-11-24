import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { drawBubble } from '../render/bubble.ts'
import { MapRenderer } from '../render/MapRenderer.ts'
import { OSM_ATTRIBUTION } from '../osm/types.ts'
import { TileGrid } from '../tiles/grid.ts'
import { MapView } from './MapView.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('stepquest.locale', 'en')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const grid = new TileGrid({ south: 39.49, west: -0.4, north: 39.5, east: -0.39 })
const start = { lat: 39.491, lon: -0.399 }
const walker = { lat: 39.497, lon: -0.392 }

describe('map buttons during a quest', () => {
  it('centres the locate button on the walker, not the start, and turns follow back on', async () => {
    const centerOn = vi.spyOn(MapRenderer.prototype, 'centerOn')
    const onLocate = vi.fn()
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="q" onTap={() => {}} home={start} quest={{ player: walker, accuracyM: 5, collected: 0, alongM: 0 }} follow={false} onLocate={onLocate} />
        </I18nProvider>,
      ),
    )
    centerOn.mockClear()
    const locate = host.querySelector<HTMLButtonElement>('[data-testid="map-locate"]')!
    expect(locate.getAttribute('aria-label')).toBe('Centre on me and follow')
    await act(async () => locate.click())
    expect(centerOn).toHaveBeenCalledTimes(1)
    expect(centerOn.mock.calls[0]![0]).toEqual(walker)
    expect(onLocate).toHaveBeenCalledTimes(1)
    // The "frame everything" and "go to start" buttons, which jumped back to the start, are gone in a quest.
    expect(host.querySelector('[aria-label="Show whole route"], [aria-label="Go to the start"]')).toBeNull()
    expect(host.querySelectorAll('.map-buttons button')).toHaveLength(3)
  })

  it('keeps fit, start and locate buttons on the planning map', async () => {
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="p" onTap={() => {}} home={start} onLocate={() => {}} />
        </I18nProvider>,
      ),
    )
    expect(host.querySelectorAll('.map-buttons button')).toHaveLength(5)
    expect(host.querySelector('[data-testid="map-locate"]')!.getAttribute('aria-label')).toBe('Use my location')
  })

  it('reports the map centre after the user zooms or pans (to offer loading that area)', async () => {
    vi.useFakeTimers()
    const onView = vi.fn()
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="v" onTap={() => {}} home={start} onView={onView} />
        </I18nProvider>,
      ),
    )
    const canvas = host.querySelector('canvas')!
    await act(async () => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
    })
    expect(onView).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(200))
    vi.useRealTimers()
    expect(onView).toHaveBeenCalledTimes(1)
    expect(onView.mock.calls[0]![0]).toHaveProperty('lat')
  })
})

describe('credit and button stack', () => {
  it('credits OpenFreeMap, OpenMapTiles and OpenStreetMap, each linked, OpenStreetMap to its copyright page', async () => {
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="a" onTap={() => {}} home={start} />
        </I18nProvider>,
      ),
    )
    const credit = host.querySelector<HTMLElement>('.map-attribution')!
    expect(credit.textContent).toBe(OSM_ATTRIBUTION)
    // The strip is a flex box, which drops whitespace between its items ("OpenFreeMap© OpenMapTiles©"
    // in the field check): the links and the spaces between them sit in one inline span.
    expect(credit.children).toHaveLength(1)
    expect(credit.firstElementChild!.tagName).toBe('SPAN')
    expect([...credit.childNodes].every((n) => n.nodeType === 1)).toBe(true)
    expect(credit.firstElementChild!.textContent).toBe(OSM_ATTRIBUTION)
    const links = [...credit.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([
      ['OpenFreeMap', 'https://openfreemap.org'],
      ['© OpenMapTiles', 'https://www.openmaptiles.org/'],
      ['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'],
    ])
    expect(host.querySelector('[data-testid="map-more"]')).toBeNull()
  })

  it('collapses buttons behind More when the map is short, and opens them on tap', async () => {
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160)
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320)
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="m" onTap={() => {}} home={start} onLocate={() => {}} />
        </I18nProvider>,
      ),
    )
    h.mockRestore()
    w.mockRestore()
    const more = host.querySelector<HTMLButtonElement>('[data-testid="map-more"]')!
    expect(more.getAttribute('aria-label')).toBe('More map buttons')
    expect(host.querySelector('[data-testid="map-more-row"]')).toBeNull()
    await act(async () => more.click())
    expect(host.querySelectorAll('[data-testid="map-more-row"] button').length).toBeGreaterThan(0)
  })
})

describe('speech bubble', () => {
  it('hands the spoken text to the renderer and clears it when the phrase ends', async () => {
    const setBubble = vi.spyOn(MapRenderer.prototype, 'setBubble')
    const view = (bubble?: string) => (
      <I18nProvider>
        <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="b" onTap={() => {}} home={start} quest={{ player: walker, accuracyM: 5, collected: 0, alongM: 0 }} bubble={bubble} />
      </I18nProvider>
    )
    await act(async () => root.render(view('Turn left.')))
    expect(setBubble).toHaveBeenLastCalledWith('Turn left.')
    await act(async () => root.render(view(undefined)))
    expect(setBubble).toHaveBeenLastCalledWith(undefined)
  })
})


describe('speech bubble drawing', () => {
  it('draws every wrapped line of the text, kept inside the canvas', () => {
    const texts: string[] = []
    const rects: number[][] = []
    const ctx = new Proxy({ fillText: (t: string) => texts.push(t), fillRect: (...a: number[]) => rects.push(a) } as Record<string, unknown>, {
      get: (o, k) => (k in o ? o[k as string] : () => {}),
      set: () => true,
    })
    drawBubble(ctx as never, 'Checkpoint 3 of 10. Next one in 400 metres.', { x: 290, y: 200, size: 48 }, 1, 300, 400)
    expect(texts.join(' ')).toBe('Checkpoint 3 of 10. Next one in 400 metres.')
    for (const [x, , w] of rects) expect(x! >= 0 && x! + w! <= 300 + 2).toBe(true)
  })
})

describe('map drawing without holes', () => {
  const big = new TileGrid({ south: 39.45, west: -0.45, north: 39.5, east: -0.38 })
  const fills: string[] = []
  const images: number[][] = []
  let clock = 0

  beforeEach(() => {
    fills.length = 0
    images.length = 0
    clock = 0
    const ctx = new Proxy(
      { fillRect: () => {}, drawImage: (...a: number[]) => images.push(a), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) } as Record<string, unknown>,
      {
        get: (o, k) => (k in o ? o[k as string] : () => {}),
        set: (_o, k, v) => {
          if (k === 'fillStyle') fills.push(String(v))
          return true
        },
      },
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
    // Every clock read costs 10 ms, so the 6 ms frame budget allows a single new chunk per frame.
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 10))
  })

  it('clears to the ground colour, never ink black', () => {
    const r = new MapRenderer(document.createElement('canvas'), big)
    r.zoom = 0.5
    r.render()
    expect(fills[0]).toBe('#c9df8f')
    expect(fills).not.toContain('#1b1a2e')
  })

  it('paints one chunk per frame under load, stands in with the town map for the rest, and finishes over frames', () => {
    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'clientWidth', { value: 1200 })
    Object.defineProperty(canvas, 'clientHeight', { value: 900 })
    const r = new MapRenderer(canvas, big)
    r.zoom = 8
    r.camX = big.cols / 2
    r.camY = big.rows / 2
    r.render()
    expect(r.chunkCount).toBe(1)
    const isStandIn = (a: unknown[]) => a.length === 9 && (a[0] as HTMLCanvasElement).width === big.cols && (a[0] as HTMLCanvasElement).height === big.rows
    const standIns = images.filter(isStandIn).length
    expect(standIns).toBeGreaterThan(5)
    for (let i = 0; i < 80; i++) r.render()
    // The whole screen and its ring are painted; nothing is left as a stand-in.
    images.length = 0
    r.render()
    expect(images.filter(isStandIn)).toHaveLength(0)
    expect(r.chunkCount).toBeGreaterThan(20)
  })

  it('keeps zoomed-out views of unloaded surroundings filled (no clear to black at any zoom)', () => {
    const r = new MapRenderer(document.createElement('canvas'), big)
    for (const z of [0.5, 1, 4, 8, 16]) {
      fills.length = 0
      r.zoom = z
      r.camX = -50
      r.render()
      expect(fills[0]).toBe('#c9df8f')
    }
  })
})

describe('map load state on the canvas (requirement 20.10)', () => {
  const canvas = () => host.querySelector<HTMLCanvasElement>('[data-testid="map-canvas"]')!
  const render = (load?: { ready: 'loading' | 'coarse' | 'full'; pending: number }) =>
    act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="l" onTap={() => {}} home={start} load={load} />
        </I18nProvider>,
      ),
    )

  it('says full with nothing pending when no loading runs', async () => {
    await render()
    expect(canvas().dataset.mapReady).toBe('full')
    expect(canvas().dataset.mapPending).toBe('0')
  })

  it('follows the load state, and adds nothing visible', async () => {
    await render({ ready: 'loading', pending: 12 })
    expect(canvas().dataset.mapReady).toBe('loading')
    expect(canvas().dataset.mapPending).toBe('12')
    await render({ ready: 'coarse', pending: 3 })
    expect(canvas().dataset.mapReady).toBe('coarse')
    expect(canvas().dataset.mapPending).toBe('3')
    await render({ ready: 'full', pending: 0 })
    expect(canvas().dataset.mapReady).toBe('full')
    // Only data attributes: no extra element and no text for the player.
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
    expect(host.textContent).not.toMatch(/loading|coarse|pending/i)
  })
})

describe('the frame follows the view (requirement 20.17)', () => {
  it('rebuilds the renderer on the new grid at the same place and zoom, and sets the quest again', async () => {
    const { LiveWorld } = await import('../world/liveWorld.ts')
    const { makeRecord } = await import('../world/testing.ts')
    const lw = new LiveWorld({ i: 3949, j: -40 }, [makeRecord({ i: 3949, j: -40 }, [])])
    const centerOn = vi.spyOn(MapRenderer.prototype, 'centerOn')
    const setQuest = vi.spyOn(MapRenderer.prototype, 'setQuest')
    const dispose = vi.spyOn(MapRenderer.prototype, 'dispose')
    const quest = { player: undefined, accuracyM: undefined, collected: 0, alongM: 0 }
    await act(async () =>
      root.render(
        <I18nProvider>
          <MapView map={lw} route={undefined} markers={{ start }} focus={[start]} focusKey="f" onTap={() => {}} home={start} quest={quest} />
        </I18nProvider>,
      ),
    )
    const grid = lw.grid
    centerOn.mockClear()
    setQuest.mockClear()
    await act(async () => lw.recentre({ i: 3955, j: -46 }))
    expect(lw.grid).not.toBe(grid)
    expect(dispose).toHaveBeenCalledTimes(1)
    // The new renderer starts where the old one was, not at the focus points or the new grid's middle.
    expect(centerOn).toHaveBeenCalledTimes(1)
    expect(setQuest).toHaveBeenCalledWith(quest)
  })
})
