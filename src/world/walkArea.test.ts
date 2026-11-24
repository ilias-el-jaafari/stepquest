import { describe, expect, it, vi } from 'vitest'
import type { OsmData } from '../osm/types.ts'
import { TileError } from '../vector/fetchTile.ts'
import { tileBBox, tileKey, type TileId } from '../vector/tileMath.ts'
import { cellsInBBox, type CellId } from './cells.ts'
import { enrichFromOverpass, loadWalkRecords, walkTiles, WalkAreaError, WALK_DEADLINE_MS } from './walkArea.ts'
import type { CellRecord } from './slice.ts'

/** A tile with one straight street through its middle. */
function streetTile(t: TileId): OsmData {
  const b = tileBBox(t)
  const lat = (b.south + b.north) / 2
  return {
    bbox: b,
    lat: Float64Array.from([lat, lat]),
    lon: Float64Array.from([b.west, b.east]),
    ways: [{ id: 1, kind: 'road', highway: 'residential', walkable: true, area: false, tunnel: false, crossing: false, nodes: [0, 1] }],
    pois: [],
    source: 'tiles',
    timestamp: '',
  }
}

const cells: CellId[] = cellsInBBox({ south: 39.46, west: -0.39, north: 39.48, east: -0.37 })
const fast = { sleep: () => Promise.resolve(), random: () => 0.5 }

describe('walkTiles', () => {
  it('lists each tile once, however many cells share it', () => {
    const tiles = walkTiles(cells)
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThan(cells.length * 4)
  })
})

describe('loadWalkRecords', () => {
  it('loads every tile, at most 4 at once, and reports progress up to all of them', async () => {
    let running = 0
    let peak = 0
    const progress: string[] = []
    const records = await loadWalkRecords(
      cells,
      {
        loadTile: async (t) => {
          running++
          peak = Math.max(peak, running)
          await new Promise((r) => setTimeout(r, 5))
          running--
          return streetTile(t)
        },
      },
      { ...fast, onProgress: (p) => progress.push(`${p.done}/${p.total}`) },
    )
    const total = walkTiles(cells).length
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    expect(progress[0]).toBe(`0/${total}`)
    expect(progress.at(-1)).toBe(`${total}/${total}`)
    expect(records.length).toBe(cells.length)
    expect(records.every((r) => r.data.source === 'tiles' && r.data.ways.every((w) => w.walkable))).toBe(true)
  })

  it('retries a failing tile twice with a pause (1 s, 2 s ±25 %), then gives up with a network error', async () => {
    const sleeps: number[] = []
    const loadTile = vi.fn(async () => {
      throw new TileError('network', 'offline')
    })
    await expect(loadWalkRecords(cells, { loadTile }, { parallel: 1, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 })).rejects.toMatchObject({ code: 'network' })
    expect(loadTile).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([1000, 2000])
  })

  it('a tile that fails once and then answers is not an error', async () => {
    let calls = 0
    const records = await loadWalkRecords(
      cells,
      {
        loadTile: async (t) => {
          if (++calls === 1) throw new TileError('network', 'blip')
          return streetTile(t)
        },
      },
      fast,
    )
    expect(records.length).toBe(cells.length)
  })

  it('a busy tile client (every slot taken by the map) is waited for, not counted as a failure', async () => {
    let busy = 5
    const records = await loadWalkRecords(
      cells,
      {
        loadTile: async (t) => {
          if (busy-- > 0) throw new TileError('busy', 'slots taken')
          return streetTile(t)
        },
      },
      fast,
    )
    expect(records.length).toBe(cells.length)
  })

  it('ends with a timeout error after the deadline even when a tile never answers', async () => {
    vi.useFakeTimers()
    try {
      const result = loadWalkRecords(cells, { loadTile: () => new Promise<OsmData>(() => undefined) }, {})
      const caught = result.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(WALK_DEADLINE_MS + 10)
      const error = await caught
      expect(error).toBeInstanceOf(WalkAreaError)
      expect((error as WalkAreaError).code).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops at once when the caller aborts', async () => {
    const controller = new AbortController()
    const result = loadWalkRecords(cells, { loadTile: () => new Promise<OsmData>(() => undefined) }, { signal: controller.signal })
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'aborted' })
  })

  it('does nothing for no cells', async () => {
    expect(await loadWalkRecords([], { loadTile: async () => Promise.reject(new Error('no')) })).toEqual([])
  })
})

describe('enrichFromOverpass', () => {
  const rec = (c: CellId): CellRecord => ({ cell: c, coverage: { south: 0, west: 0, north: 0, east: 0 }, savedAt: 0, data: streetTile({ z: 14, x: 1, y: 1 }) })

  it('uses cached cells first and asks the network for the rest, two cells a request, one request at a time', async () => {
    const cachedCell = vi.fn(async (c: CellId) => (c.j === cells[0]!.j && c.i === cells[0]!.i ? rec(c) : undefined))
    const loadCells = vi.fn(async (cs: readonly CellId[]) => ({ records: cs.map(rec), cached: [], downloaded: [...cs] }))
    const enrich = vi.fn(() => 1)
    await enrichFromOverpass(cells, { cachedCell, loadCells, busy: false, waitMs: () => 0 }, { enrich }, { network: true })
    expect(cachedCell).toHaveBeenCalledTimes(cells.length)
    const asked = loadCells.mock.calls.flatMap((c) => c[0])
    expect(asked.length).toBe(cells.length - 1)
    expect(Math.max(...loadCells.mock.calls.map((c) => c[0].length))).toBeLessThanOrEqual(2)
    expect(enrich).toHaveBeenCalled()
  })

  it('asks no network when it is switched off, and stops at the first failure', async () => {
    const loadCells = vi.fn(async () => {
      throw new Error('502')
    })
    const graph = { cachedCell: async () => undefined, loadCells, busy: false, waitMs: () => 0 }
    await enrichFromOverpass(cells, graph, { enrich: () => 0 }, { network: false })
    expect(loadCells).not.toHaveBeenCalled()
    await enrichFromOverpass(cells, graph, { enrich: () => 0 }, { network: true })
    expect(loadCells).toHaveBeenCalledTimes(1)
  })
})
