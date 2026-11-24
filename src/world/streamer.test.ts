import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OsmData } from '../osm/types.ts'
import { OverpassError } from '../osm/overpass.ts'
import { FAR_ZOOM } from '../render/camera.ts'
import { COARSE_Z, DETAIL_Z, tilesForCell } from '../vector/assemble.ts'
import type { TileSource } from '../vector/client.ts'
import { TileError } from '../vector/fetchTile.ts'
import { emptyTile } from '../vector/testing.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { cellBBox, cellKey, cellsBBox, type CellId } from './cells.ts'
import { LiveWorld } from './liveWorld.ts'
import type { CellRecord } from './slice.ts'
import {
  AHEAD_MAX_CELLS,
  BACKOFF_START_MS,
  backoffMs,
  BACKOFF_MAX_MS,
  MAX_TILE_CONCURRENT,
  RATE_LIMIT_PAUSE_MS,
  SETTLE_MS,
  Streamer,
  UNIT_WATCHDOG_MS,
  wantsDetail,
  type GraphClient,
  type MapLoad,
} from './streamer.ts'
import { makeRecord } from './testing.ts'

const C = { i: 3949, j: -40 }
const centreOf = (c: CellId) => ({ lat: (c.i + 0.5) / 100, lon: (c.j + 0.5) / 100 })
const around = (r: number, at: CellId = C) => cellsBBox([{ i: at.i - r, j: at.j - r }, { i: at.i + r, j: at.j + r }])
const shrink = (b: ReturnType<typeof around>) => ({ south: b.south + 1e-5, west: b.west + 1e-5, north: b.north - 1e-5, east: b.east - 1e-5 })
const DETAIL = 16
const FAR = 1

type Call = { at: number; t: TileId }

/** A fake tile server with a cache: logs every download, can be slow, fail, or hang. */
function tileServer(opts: { fail?: (t: TileId) => TileError | undefined; delayMs?: (t: TileId) => number; hang?: (t: TileId) => boolean } = {}) {
  const log: Call[] = []
  const cache = new Map<string, OsmData>()
  let inFlight = 0
  let maxInFlight = 0
  const source: TileSource = {
    busy: false,
    cachedTile: async (t) => cache.get(tileKey(t)),
    loadTile: async (t) => {
      const hit = cache.get(tileKey(t))
      if (hit) return hit
      log.push({ at: Date.now(), t })
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        if (opts.hang?.(t)) await new Promise<never>(() => undefined)
        const d = opts.delayMs?.(t) ?? 0
        if (d) await new Promise((r) => setTimeout(r, d))
        const err = opts.fail?.(t)
        if (err) throw err
        const data = emptyTile(t)
        cache.set(tileKey(t), data)
        return data
      } finally {
        inFlight--
      }
    },
  }
  return { source, log, cache, maxInFlight: () => maxInFlight }
}

/** A fake Overpass for the graph lane. */
function overpass(fail: () => boolean) {
  const asked: string[] = []
  const g: GraphClient = {
    busy: false,
    waitMs: () => 0,
    cachedCell: async () => undefined,
    loadCells: async (cells) => {
      asked.push(...cells.map(cellKey))
      if (fail()) throw new OverpassError('rateLimited', '502 at capacity')
      return { records: cells.map((c) => makeRecord(c, [])) as CellRecord[], cached: [], downloaded: [...cells] }
    },
  }
  return { g, asked }
}

const settle = (ms = SETTLE_MS + 1) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('streamer: what it asks for (requirements 21.4, 21.5, 21.8)', () => {
  it('sends nothing while the map moves, then the coarse tiles first and the detail tiles after, at most six at once', async () => {
    const srv = tileServer({ delayMs: () => 200 })
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true })
    for (let k = 0; k < 6; k++) {
      s.setView(shrink(around(1, { i: C.i, j: C.j + (k % 3) - 1 })), centreOf(C), DETAIL)
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(srv.log).toHaveLength(0)
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    await settle(30_000)
    expect(srv.log[0]!.t.z).toBe(COARSE_Z)
    const firstDetail = srv.log.findIndex((l) => l.t.z === DETAIL_Z)
    expect(firstDetail).toBeGreaterThan(0)
    expect(srv.log.slice(0, firstDetail).every((l) => l.t.z === COARSE_Z)).toBe(true)
    expect(srv.maxInFlight()).toBeLessThanOrEqual(MAX_TILE_CONCURRENT)
    expect(srv.maxInFlight()).toBeGreaterThan(1)
    // Each tile once.
    expect(new Set(srv.log.map((l) => tileKey(l.t))).size).toBe(srv.log.length)
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) expect(world.needs({ i: C.i + di, j: C.j + dj })).toBe(false)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('asks only for coarse tiles at a zoom that does not show buildings', async () => {
    expect(wantsDetail(FAR_ZOOM)).toBe(false)
    expect(wantsDetail(2)).toBe(true)
    const srv = tileServer()
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true })
    s.setView(shrink(around(2)), centreOf(C), FAR)
    await settle(10_000)
    expect(srv.log.length).toBeGreaterThan(0)
    expect(srv.log.every((l) => l.t.z === COARSE_Z)).toBe(true)
    // A 5 × 5-cell view (5.5 × 4.3 km) is at most 3 × 3 z13 tiles.
    expect(srv.log.length).toBeLessThanOrEqual(9)
    expect(world.needs(C)).toBe(true)
    expect(world.hasAny(C)).toBe(true)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('shows cached tiles at once, before the view rests, with no download', async () => {
    const srv = tileServer()
    for (const z of [COARSE_Z, DETAIL_Z]) for (const t of tilesForCell(C, z)) srv.cache.set(tileKey(t), emptyTile(t))
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await vi.advanceTimersByTimeAsync(50)
    expect(world.needs(C)).toBe(false)
    expect(srv.log).toHaveLength(0)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('loads the route ahead of the view, not behind it', async () => {
    const srv = tileServer()
    const world = new LiveWorld(C)
    const lat = (C.i + 0.5) / 100
    // A route running east from the view centre, 2 km.
    const route = Array.from({ length: 41 }, (_, k) => ({ lat, lon: (C.j + 0.5) / 100 + k * 0.0006 }))
    const s = new Streamer({ tiles: srv.source, world, online: () => true, keep: () => route })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(30_000)
    expect(world.needs({ i: C.i, j: C.j + 1 })).toBe(false)
    expect(world.needs({ i: C.i, j: C.j - 1 })).toBe(true)
    expect(AHEAD_MAX_CELLS).toBe(6)
    s.dispose()
  })
})

describe('streamer: painting never waits for Overpass (requirement 21.10, field benchmark)', () => {
  it('reaches full while every Overpass request fails, and keeps the graph lane in its own back-off', async () => {
    const srv = tileServer()
    const op = overpass(() => true)
    const world = new LiveWorld(C)
    const lat = (C.i + 0.5) / 100
    const route = Array.from({ length: 21 }, (_, k) => ({ lat, lon: (C.j + 0.5) / 100 + k * 0.0004 }))
    const errors: string[] = []
    const s = new Streamer({ tiles: srv.source, graph: op.g, world, online: () => true, keep: () => route, random: () => 0.5, onError: (e) => errors.push(e) })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    await settle(20_000)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    expect(op.asked.length).toBeGreaterThan(0)
    expect(errors).toContain('rateLimited')
    // The graph has nothing for the route yet; the drawing has everything.
    expect(world.needsGraph(C)).toBe(true)
    // A 502 from Overpass never pauses the tiles.
    s.setView(shrink(around(1, { i: C.i + 3, j: C.j })), centreOf({ i: C.i + 3, j: C.j }), DETAIL)
    await settle(5_000)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('adds graph cells along the route when Overpass answers, without repainting what the tiles drew', async () => {
    const srv = tileServer()
    const op = overpass(() => false)
    const world = new LiveWorld(C)
    const lat = (C.i + 0.5) / 100
    const route = Array.from({ length: 11 }, (_, k) => ({ lat, lon: (C.j + 0.5) / 100 + k * 0.0002 }))
    const s = new Streamer({ tiles: srv.source, graph: op.g, world, online: () => true, keep: () => route })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(20_000)
    expect(world.needsGraph(C)).toBe(false)
    expect(world.needs(C)).toBe(false)
    s.dispose()
  })
})

describe('streamer: slow and failing tiles (requirement 21.8)', () => {
  it('keeps the coarse placeholder where detail tiles fail, says so, and retries with a jittered back-off until they come', async () => {
    let failing = true
    const srv = tileServer({ fail: (t) => (failing && t.z === DETAIL_Z ? new TileError('network', 'timed out') : undefined) })
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(1_000)
    expect(s.status()).toEqual({ ready: 'coarse', pending: 1 })
    expect(world.loading()).toEqual([])
    const tries = () => srv.log.filter((l) => l.t.z === DETAIL_Z).length
    const first = tries()
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS + 500)
    expect(tries()).toBeGreaterThan(first)
    expect(backoffMs(20)).toBe(BACKOFF_MAX_MS)
    failing = false
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('shows the stipple and says loading while not even the coarse tile has come', async () => {
    const srv = tileServer({ fail: () => new TileError('network', 'offline-ish') })
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(3_000)
    expect(s.status()).toEqual({ ready: 'loading', pending: 1 })
    expect(world.loading().length).toBeGreaterThan(0)
    s.dispose()
  })

  it('gives up on a tile that never answers, frees its slot, and the other tiles still arrive', async () => {
    let hang = true
    const stuck = (t: TileId) => hang && t.z === DETAIL_Z && t.x % 2 === 0
    const srv = tileServer({ hang: stuck })
    const world = new LiveWorld(C)
    const s = new Streamer({ tiles: srv.source, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    await settle(5_000)
    expect(s.status().ready).not.toBe('loading')
    hang = false
    await vi.advanceTimersByTimeAsync(UNIT_WATCHDOG_MS + BACKOFF_START_MS * 2)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('pauses the tiles after a 429, then goes on', async () => {
    let first = true
    const srv = tileServer({
      fail: () => {
        const e = first ? new TileError('rateLimited', '429') : undefined
        first = false
        return e
      },
    })
    const s = new Streamer({ tiles: srv.source, world: new LiveWorld(C), online: () => true, random: () => 0.5 })
    s.setView(shrink(cellBBox(C)), centreOf(C), FAR)
    await settle(1_000)
    const n = srv.log.length
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_PAUSE_MS - 2_000)
    expect(srv.log.length).toBe(n)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(srv.log.length).toBeGreaterThan(n)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('requests nothing offline and goes on when the device is back', async () => {
    let online = false
    const srv = tileServer()
    const s = new Streamer({ tiles: srv.source, world: new LiveWorld(C), online: () => online })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(5_000)
    expect(srv.log).toHaveLength(0)
    expect(s.status().ready).toBe('loading')
    online = true
    s.retry()
    await settle(5_000)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })
})

describe('streamer: what the map shows (requirement 20.15)', () => {
  it('goes loading, coarse, full, counting the visible cells that still lack what the zoom needs', async () => {
    const seen: MapLoad[] = []
    const srv = tileServer({ delayMs: (t) => (t.z === COARSE_Z ? 300 : 3_000) })
    const s = new Streamer({ tiles: srv.source, world: new LiveWorld(C), online: () => true, onLoad: (l) => seen.push(l) })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    expect(s.status()).toEqual({ ready: 'loading', pending: 9 })
    await settle(1_500)
    expect(s.status()).toEqual({ ready: 'coarse', pending: 9 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    const rank = { loading: 0, coarse: 1, full: 2 }
    for (let k = 1; k < seen.length; k++) {
      expect(rank[seen[k]!.ready]).toBeGreaterThanOrEqual(rank[seen[k - 1]!.ready])
      expect(seen[k]!.pending).toBeLessThanOrEqual(seen[k - 1]!.pending)
    }
    s.dispose()
  })

  it('adds one cell per change notice', async () => {
    const srv = tileServer()
    const batches: number[] = []
    const s = new Streamer({ tiles: srv.source, world: new LiveWorld(C), online: () => true, onChange: (c) => batches.push(c.length) })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    await settle(10_000)
    expect(batches.length).toBeGreaterThanOrEqual(18)
    expect(batches.every((n) => n === 1)).toBe(true)
    s.dispose()
  })
})

describe('readiness counts whole cells only (requirement 21.14, field check of f1632f2)', () => {
  /** A graph record that covers only the south tenth of cell C (like the edge cells of the bundled extract). */
  const partial = () => {
    const b = cellBBox(C)
    return makeRecord(C, [], {}, { ...b, north: b.south + (b.north - b.south) / 10 })
  }

  it('does not say full or coarse for a cell that only a partial record paints, while its tiles fail', async () => {
    const srv = tileServer({ fail: () => new TileError('network', 'timed out') })
    const world = new LiveWorld(C, [partial()])
    const s = new Streamer({ tiles: srv.source, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(cellBBox(C)), centreOf(C), FAR)
    await settle(5_000)
    expect(world.hasAny(C)).toBe(false)
    expect(s.status()).toEqual({ ready: 'loading', pending: 1 })
    // And it asked for the coarse tile of that cell (a partial record does not stop the coarse layer).
    expect(srv.log.some((l) => l.t.z === COARSE_Z)).toBe(true)
    s.dispose()
  })

  it('paints the coarse tile over a partial record once it comes, and only then says full', async () => {
    const srv = tileServer()
    const world = new LiveWorld(C, [partial()])
    const s = new Streamer({ tiles: srv.source, world, online: () => true })
    s.setView(shrink(cellBBox(C)), centreOf(C), FAR)
    await settle(5_000)
    expect(world.hasAny(C)).toBe(true)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    // The graph keeps the partial record for routing.
    expect(world.needsGraph(C)).toBe(true)
    s.dispose()
  })

  it('draws every cell from its coarse tile at far zooms, also a cell with a complete graph record, and goes back when zoomed in', async () => {
    const srv = tileServer()
    const full = makeRecord(C, [{ id: 1, pts: [[39.4951, -0.399], [39.4951, -0.391]] }])
    const world = new LiveWorld(C, [full])
    const own = world.tiles.ownedRect(C)!
    const roadAt = () => world.grid.terrainAt(own.x + Math.round(own.w * 0.5), world.grid.toTileXY({ lat: 39.4951, lon: -0.395 }).y | 0)
    const before = roadAt()
    const s = new Streamer({ tiles: srv.source, world, online: () => true })
    s.setView(shrink(cellBBox(C)), centreOf(C), FAR)
    await settle(5_000)
    // The coarse tile (empty here) replaced the graph drawing: one source at far zoom.
    expect(srv.log.some((l) => l.t.z === COARSE_Z)).toBe(true)
    expect(roadAt()).not.toBe(before)
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(5_000)
    expect(roadAt()).toBe(before)
    expect(world.world().data.ways).toHaveLength(1)
    s.dispose()
  })
})
