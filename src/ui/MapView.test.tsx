import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { MapRenderer } from '../render/MapRenderer.ts'
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
          <MapView grid={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="q" onTap={() => {}} home={start} quest={{ player: walker, accuracyM: 5, collected: 0, alongM: 0 }} follow={false} onLocate={onLocate} />
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
          <MapView grid={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="p" onTap={() => {}} home={start} onLocate={() => {}} />
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
          <MapView grid={grid} route={undefined} markers={{ start }} focus={[start]} focusKey="v" onTap={() => {}} home={start} onView={onView} />
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
