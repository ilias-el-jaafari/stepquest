import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BBox, LatLon } from '../geo/geo.ts'
import { cellBBox, cellKey } from '../world/cells.ts'
import { regionCells } from '../world/regions.ts'
import { LiveWorld, type World } from '../world/liveWorld.ts'
import { makeRecord } from '../world/testing.ts'
import { SETTLE_MS, type CellClient, type MapLoad } from '../world/streamer.ts'
import { STREAMING_ENABLED, useStreaming } from './useStreaming.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const C = { i: 3949, j: -40 }
const E = { i: 3949, j: -39 }

let host: HTMLDivElement
let root: Root
let onView: ((box: BBox, centre: LatLon, zoom?: number) => void) | undefined
let worlds: World[] = []
let loads: MapLoad[] = []

function Probe({ first, client, enabled }: { first: World; client: CellClient; enabled: boolean }) {
  const [world, setWorld] = useState(first)
  const view = useStreaming({ world, client, onWorld: setWorld, keep: undefined, online: true, enabled, onLoad: (l) => loads.push(l) })
  useEffect(() => {
    onView = view
    worlds.push(world)
  })
  return null
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div')
  root = createRoot(host)
  worlds = []
  loads = []
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

const client = (): CellClient & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    busy: false,
    waitMs: () => 0,
    cachedCell: async () => undefined,
    cachedCoarse: async () => undefined,
    loadCoarse: async (r) => ({ records: regionCells(r).map((c) => makeRecord(c, [])), fromCache: false }),
    loadCells: async (cells) => {
      asked.push(...cells.map(cellKey))
      return { records: cells.map((c) => makeRecord(c, [{ id: 1, pts: [[39.495, -0.385], [39.495, -0.382]] }])), cached: [], downloaded: [...cells] }
    },
  }
}

describe('useStreaming', () => {
  it('is off under Vitest unless a test turns it on', () => {
    expect(STREAMING_ENABLED).toBe(false)
  })

  it('hands the app new snapshots of the same world as cells arrive', async () => {
    const lw = new LiveWorld(C, [makeRecord(C, [])])
    const first = lw.world()
    const c = client()
    act(() => root.render(<Probe first={first} client={c} enabled />))
    act(() => onView!({ ...cellBBox(E), south: cellBBox(E).south + 1e-4, north: cellBBox(E).north - 1e-4, west: cellBBox(E).west + 1e-4, east: cellBBox(E).east - 1e-4 }, { lat: 39.495, lon: -0.385 }, 16))
    await act(async () => vi.advanceTimersByTimeAsync(SETTLE_MS + 5000))
    expect(c.asked).toEqual([cellKey(E)])
    const last = worlds.at(-1)!
    expect(last).not.toBe(first)
    expect(last.grid).toBe(first.grid)
    expect(last.live).toBe(lw)
    expect(last.data.ways.length).toBeGreaterThan(first.data.ways.length)
    // The load state reached the app, and went back to idle (full, nothing pending) once the cell was there.
    expect(loads.at(-1)).toEqual({ ready: 'full', pending: 0 })
  })

  it('does nothing when disabled', async () => {
    const lw = new LiveWorld(C, [makeRecord(C, [])])
    const c = client()
    act(() => root.render(<Probe first={lw.world()} client={c} enabled={false} />))
    act(() => onView!(cellBBox(E), { lat: 39.495, lon: -0.385 }))
    await act(async () => vi.advanceTimersByTimeAsync(SETTLE_MS * 3))
    expect(c.asked).toEqual([])
  })
})
