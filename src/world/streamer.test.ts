import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../osm/cache.ts'
import { encodeOsm } from '../osm/codec.ts'
import { normalizeOverpass } from '../osm/normalize.ts'
import { MIN_REQUEST_GAP_MS, OverpassClient, OverpassError, type DownloadExtras, type Downloader } from '../osm/overpass.ts'
import { FAR_ZOOM } from '../render/camera.ts'
import { cellBBox, cellKey, cellsBBox, type CellId } from './cells.ts'
import { LiveWorld } from './liveWorld.ts'
import { regionBBox, regionCells, regionKey, regionOf } from './regions.ts'
import type { CellRecord } from './slice.ts'
import {
  AHEAD_MAX_CELLS,
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  backoffMs,
  BATCH_MAX,
  BATCH_MIN,
  BATCH_START,
  MAX_CONCURRENT,
  MAX_REQUESTS_PER_MINUTE,
  SETTLE_MS,
  Streamer,
  UNIT_WATCHDOG_MS,
  wantsDetail,
  type CellClient,
  type MapLoad,
} from './streamer.ts'

const C = { i: 3949, j: -40 }
const centreOf = (c: CellId) => ({ lat: (c.i + 0.5) / 100, lon: (c.j + 0.5) / 100 })
const around = (r: number, at: CellId = C) => cellsBBox([{ i: at.i - r, j: at.j - r }, { i: at.i + r, j: at.j + r }])
const shrink = (b: ReturnType<typeof around>) => ({ south: b.south + 1e-5, west: b.west + 1e-5, north: b.north - 1e-5, east: b.east - 1e-5 })
const DETAIL = 16
const FAR = 1

type Start = { at: number; coarse: boolean; cells: number; box: ReturnType<typeof cellBBox> }

/** A real client over a memory cache with a fake network: logs every request, can be slow, can fail. */
function network(opts: { fail?: (s: Start) => OverpassError | undefined; delayMs?: (s: Start) => number; cache?: MemoryCache } = {}) {
  const log: Start[] = []
  let inFlight = 0
  let maxInFlight = 0
  const download: Downloader = async (bbox, _p, extras?: DownloadExtras) => {
    const s: Start = { at: Date.now(), coarse: extras?.coarse === true, cells: Math.round(((bbox.north - bbox.south) * (bbox.east - bbox.west)) / 1e-4), box: bbox }
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    log.push(s)
    try {
      const delay = opts.delayMs?.(s) ?? 0
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const err = opts.fail?.(s)
      if (err) throw err
      return encodeOsm(normalizeOverpass({ elements: [] }, bbox))
    } finally {
      inFlight--
    }
  }
  const client = new OverpassClient({ cache: opts.cache ?? new MemoryCache(), download })
  return { client, log, maxInFlight: () => maxInFlight }
}

const settle = (ms = SETTLE_MS + 1) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('streamer: when it asks (requirement 20.4)', () => {
  it('sends nothing while the map keeps moving, then asks once it rests', async () => {
    const { client, log } = network()
    const s = new Streamer({ client, world: new LiveWorld(C), online: () => true })
    for (let k = 0; k < 10; k++) {
      s.setView(shrink(around(0, { i: C.i, j: C.j + (k % 3) - 1 })), centreOf(C), DETAIL)
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(log).toHaveLength(0)
    await settle(SETTLE_MS * 2)
    expect(log.length).toBeGreaterThan(0)
    s.dispose()
  })

  it('does not restart the wait while the view keeps the same cells (follow mode)', async () => {
    const { client, log } = network()
    const s = new Streamer({ client, world: new LiveWorld(C), online: () => true })
    const b = shrink(around(0))
    for (let k = 0; k < 4; k++) {
      s.setView({ ...b, south: b.south + k * 1e-4, north: b.north - k * 1e-4 }, centreOf(C), DETAIL)
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(log.length).toBeGreaterThan(0)
    s.dispose()
  })

  it('shows cached data at once, without waiting for the view to rest, and sends nothing for it', async () => {
    const cache = new MemoryCache()
    const warm = network({ cache })
    await warm.client.loadCoarse(regionOf(C))
    await vi.advanceTimersByTimeAsync(MIN_REQUEST_GAP_MS)
    await warm.client.loadCells([C])
    await warm.client.settled()
    const { client, log } = network({ cache })
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    s.setView(shrink(around(0)), centreOf(C), DETAIL)
    await vi.advanceTimersByTimeAsync(50)
    expect(world.needs(C)).toBe(false)
    expect(world.hasAny({ i: C.i - 1, j: C.j })).toBe(true)
    expect(log).toHaveLength(0)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })
})

describe('streamer: what it asks for, in what order (requirements 20.2 to 20.7)', () => {
  it('asks for the region under the view first, then the nearest detail cells in small batches, two at a time at most', async () => {
    const { client, log, maxInFlight } = network({ delayMs: () => 3000 })
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    s.setView(shrink(around(2)), centreOf(C), DETAIL)
    await settle()
    expect(log[0]!.coarse).toBe(true)
    expect(log[0]!.box).toEqual(regionBBox(regionOf(C)))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    // Everything the view touches is there, and cell C (the nearest) was part of the first detail request.
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) expect(world.needs({ i: C.i + di, j: C.j + dj })).toBe(false)
    const detail = log.filter((l) => !l.coarse)
    expect(detail[0]!.cells).toBeLessThanOrEqual(BATCH_START)
    expect(detail.every((l) => l.cells <= BATCH_MAX)).toBe(true)
    expect(detail.reduce((n, l) => n + l.cells, 0)).toBe(25)
    expect(maxInFlight()).toBeLessThanOrEqual(MAX_CONCURRENT)
    for (let k = 1; k < log.length; k++) expect(log[k]!.at - log[k - 1]!.at).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS)
    for (const a of log) expect(log.filter((b) => b.at >= a.at && b.at < a.at + 60_000).length).toBeLessThanOrEqual(MAX_REQUESTS_PER_MINUTE)
    s.dispose()
  })

  it('loads only the coarse layer at a zoom that does not show buildings', async () => {
    expect(wantsDetail(FAR_ZOOM)).toBe(false)
    expect(wantsDetail(2)).toBe(true)
    expect(wantsDetail(undefined)).toBe(true)
    const { client, log } = network()
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    s.setView(shrink(around(2)), centreOf(C), FAR)
    await settle(20_000)
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((l) => l.coarse)).toBe(true)
    expect(world.needs(C)).toBe(true)
    expect(world.needsCoarse(C)).toBe(false)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    s.dispose()
  })

  it('also loads the coarse regions of the horizon (the view at the lowest zoom), nearest first', async () => {
    const { client, log } = network()
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    const here = regionOf(C)
    const horizon = cellsBBox([{ i: C.i - 7, j: C.j - 7 }, { i: C.i + 7, j: C.j + 7 }])
    s.setView(shrink(around(0)), centreOf(C), DETAIL, horizon)
    await settle(60_000)
    const coarse = log.filter((l) => l.coarse)
    expect(coarse.length).toBeGreaterThan(1)
    expect(coarse.length).toBeLessThanOrEqual(6)
    expect(coarse[0]!.box).toEqual(regionBBox(here))
    // Every region it asked for lies within the horizon box.
    for (const l of coarse) expect(regionKey(regionOf({ i: Math.round(l.box.south * 100), j: Math.round(l.box.west * 100) }))).toBeDefined()
    s.dispose()
  })

  it('drops the stale wish list when the view moves before a request', async () => {
    const { client, log } = network()
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    s.setView(shrink(around(0)), centreOf(C), DETAIL)
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    const other = { i: C.i + 3, j: C.j + 3 }
    s.setView(shrink(around(0, other)), centreOf(other), DETAIL)
    await settle(SETTLE_MS * 2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(world.needs(other)).toBe(false)
    expect(world.needs(C)).toBe(true)
    expect(log.some((l) => !l.coarse && l.box.south === cellBBox(other).south)).toBe(true)
    s.dispose()
  })

  it('loads the route ahead of the walker, not behind, only while no other request runs', async () => {
    const { client, log } = network()
    const world = new LiveWorld(C)
    // A route that runs east along the row of the start cell.
    const lat = (C.i + 0.5) / 100
    const route = Array.from({ length: 41 }, (_, k) => ({ lat, lon: (C.j + 0.5) / 100 + k * 0.0005 - 0.01 }))
    const s = new Streamer({ client, world, online: () => true, keep: () => route })
    s.setView(shrink(around(0)), centreOf(C), DETAIL)
    await settle(60_000)
    const east = { i: C.i, j: C.j + 1 }
    const west = { i: C.i, j: C.j - 1 }
    expect(world.needs(C)).toBe(false)
    expect(world.needs(east)).toBe(false)
    expect(world.needs(west)).toBe(true)
    const ahead = log.filter((l) => !l.coarse).flatMap((l) => l.cells)
    expect(ahead.reduce((n, c) => n + c, 0)).toBeLessThanOrEqual(1 + AHEAD_MAX_CELLS + BATCH_MAX)
    s.dispose()
  })
})

describe('streamer: failures (requirement 20.9)', () => {
  it('backs off with jitter, doubling to a cap, and keeps retrying until it works', async () => {
    let failing = true
    const { client, log } = network({ fail: () => (failing ? new OverpassError('network', 'down') : undefined) })
    const errors: string[] = []
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true, random: () => 0.5, onError: (e) => errors.push(e) })
    s.setView(shrink(around(0)), centreOf(C), FAR)
    await settle()
    expect(log.filter((l) => l.coarse)).toHaveLength(1)
    // Jitter 0.5 is the middle: exactly the base back-off.
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS - 500)
    expect(log).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(log).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2 * BACKOFF_START_MS + 1500)
    expect(log).toHaveLength(3)
    expect(backoffMs(10)).toBe(BACKOFF_MAX_MS)
    failing = false
    await vi.advanceTimersByTimeAsync(4 * BACKOFF_START_MS + 2000)
    expect(world.needsCoarse(C)).toBe(false)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.every((e) => e === 'network')).toBe(true)
    s.dispose()
  })

  it('jitters the back-off so many phones do not retry together', async () => {
    const waits = new Set<number>()
    for (const r of [0, 0.5, 1]) {
      let at = 0
      const { client, log } = network({ fail: () => new OverpassError('network', 'down') })
      const s = new Streamer({ client, world: new LiveWorld(C), online: () => true, random: () => r })
      s.setView(shrink(around(0)), centreOf(C), FAR)
      await settle()
      const first = log[0]!.at
      while (log.length < 2 && at < 20_000) {
        await vi.advanceTimersByTimeAsync(100)
        at += 100
      }
      waits.add(log[1]!.at - first)
      s.dispose()
    }
    expect(waits.size).toBe(3)
    expect(Math.max(...waits)).toBeLessThanOrEqual(BACKOFF_START_MS * 1.25 + 600)
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(BACKOFF_START_MS * 0.75)
  })

  it('halves the batch after a failure and grows it again after quick answers', async () => {
    let failing = true
    const { client, log } = network({ fail: (s) => (failing && !s.coarse ? new OverpassError('network', 'slow') : undefined) })
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(around(2)), centreOf(C), DETAIL)
    await settle(5000)
    expect(s.batchSize).toBeLessThan(BATCH_START)
    expect(s.batchSize).toBeGreaterThanOrEqual(BATCH_MIN)
    failing = false
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(s.batchSize).toBeGreaterThan(BATCH_START)
    expect(s.batchSize).toBeLessThanOrEqual(BATCH_MAX)
    expect(log.filter((l) => !l.coarse).length).toBeGreaterThan(2)
    s.dispose()
  })

  it('pauses every request after a 429', async () => {
    let first = true
    const { client, log } = network({
      fail: () => {
        const e = first ? new OverpassError('rateLimited', '429') : undefined
        first = false
        return e
      },
    })
    const s = new Streamer({ client, world: new LiveWorld(C), online: () => true, random: () => 0.5 })
    s.setView(shrink(around(0)), centreOf(C), FAR)
    await settle()
    expect(log).toHaveLength(1)
    // Another region comes into view: it waits for the pause too.
    s.setView(shrink(around(0, { i: C.i + 5, j: C.j })), centreOf({ i: C.i + 5, j: C.j }), FAR)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(log).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(log.length).toBeGreaterThan(1)
    s.dispose()
  })

  it('gives up on a unit whose client never answers, frees the slot and tries again later', async () => {
    let hang = true
    const loadCoarse = vi.fn((): Promise<{ records: CellRecord[]; fromCache: boolean }> => (hang ? new Promise<never>(() => undefined) : Promise.resolve({ records: [], fromCache: false })))
    const stuck: CellClient = {
      busy: false,
      waitMs: () => 0,
      cachedCell: async () => undefined,
      cachedCoarse: async () => undefined,
      loadCells: async () => ({ records: [], cached: [], downloaded: [] }),
      loadCoarse,
    }
    const world = new LiveWorld(C)
    const s = new Streamer({ client: stuck, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(around(0)), centreOf(C), FAR)
    await settle()
    expect(loadCoarse).toHaveBeenCalledTimes(1)
    hang = false
    await vi.advanceTimersByTimeAsync(UNIT_WATCHDOG_MS - 5000)
    expect(loadCoarse).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000 + BACKOFF_START_MS * 2)
    expect(loadCoarse.mock.calls.length).toBeGreaterThan(1)
    s.dispose()
  })

  it('does not wait for a cache that never answers', async () => {
    const stuckCache: CellClient = {
      busy: false,
      waitMs: () => 0,
      cachedCell: () => new Promise<never>(() => undefined),
      cachedCoarse: () => new Promise<never>(() => undefined),
      loadCells: vi.fn(async (cells) => ({ records: [], cached: [], downloaded: [...cells] })),
      loadCoarse: vi.fn(async () => ({ records: [] as CellRecord[], fromCache: false })),
    }
    const s = new Streamer({ client: stuckCache, world: new LiveWorld(C), online: () => true })
    s.setView(shrink(around(0)), centreOf(C), DETAIL)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(stuckCache.loadCoarse).toHaveBeenCalled()
    s.dispose()
  })

  it('requests nothing offline and goes on when the device is back', async () => {
    let online = false
    const { client, log } = network()
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => online })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    expect(world.loading()).toEqual([])
    await settle(10_000)
    expect(log).toHaveLength(0)
    online = true
    s.retry()
    await settle(10_000)
    expect(log.length).toBeGreaterThan(0)
    s.dispose()
  })
})

describe('streamer: what the map shows (requirements 20.5 and 20.10)', () => {
  it('goes from loading to coarse to full, counting the view cells that still lack what the zoom needs', async () => {
    const seen: MapLoad[] = []
    const { client } = network({ delayMs: (s) => (s.coarse ? 1000 : 20_000) })
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true, onLoad: (l) => seen.push(l) })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    expect(s.status()).toEqual({ ready: 'loading', pending: 9 })
    await settle(10_000)
    expect(s.status().ready).toBe('coarse')
    expect(s.status().pending).toBe(9)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    expect(seen[0]).toEqual({ ready: 'loading', pending: 9 })
    const rank = { loading: 0, coarse: 1, full: 2 }
    for (let k = 1; k < seen.length; k++) expect(rank[seen[k]!.ready]).toBeGreaterThanOrEqual(rank[seen[k - 1]!.ready])
    expect(seen.at(-1)).toEqual({ ready: 'full', pending: 0 })
    // pending never goes up while the view stays put.
    for (let k = 1; k < seen.length; k++) expect(seen[k]!.pending).toBeLessThanOrEqual(seen[k - 1]!.pending)
    s.dispose()
  })

  it('draws the coarse placeholder, not the stipple, where only detail is missing, and the stipple where there is nothing', async () => {
    const { client } = network({ delayMs: (s) => (s.coarse ? 500 : 60_000) })
    const world = new LiveWorld(C)
    const s = new Streamer({ client, world, online: () => true })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    expect(world.loading().length).toBeGreaterThan(0)
    await settle(12_000)
    expect(world.loading()).toEqual([])
    expect(s.status().ready).toBe('coarse')
    s.dispose()
  })

  it('adds the cells of one answer one at a time, so no frame carries more than one cell of work', async () => {
    const { client } = network()
    const world = new LiveWorld(C)
    const batches: number[] = []
    const s = new Streamer({ client, world, online: () => true, onChange: (c) => batches.push(c.length) })
    s.setView(shrink(around(0)), centreOf(C), FAR)
    await settle(10_000)
    // The coarse region is 25 cells (some of them outside the frame are skipped): one change notice per cell.
    expect(batches.length).toBeGreaterThan(5)
    expect(batches.every((n) => n === 1)).toBe(true)
    s.dispose()
  })

  it('grows a real live world, and the second visit reads the cache without a request', async () => {
    const cache = new MemoryCache()
    const first = network({ cache })
    const lw = new LiveWorld(C)
    const s = new Streamer({ client: first.client, world: lw, online: () => true })
    s.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(20_000)
    await first.client.settled()
    expect(lw.needs(C)).toBe(false)
    expect(lw.loading()).toEqual([])
    const again = new LiveWorld(C)
    const second = network({ cache })
    const s2 = new Streamer({ client: second.client, world: again, online: () => true })
    s2.setView(shrink(cellBBox(C)), centreOf(C), DETAIL)
    await settle(2000)
    expect(again.needs(C)).toBe(false)
    expect(second.log).toHaveLength(0)
    s.dispose()
    s2.dispose()
  })
})

describe('streamer on a slow mobile link (requirement 20.9, field report)', () => {
  /** Wire sizes (gzip, about 5:1 on the JSON) from design.md: a detail cell 160 KB, a coarse region 350 KB; the server needs 4 s plus half a second per cell. */
  const wireKB = (s: Start) => (s.coarse ? 350 : 160 * s.cells)
  const seconds = (s: Start, kbPerS: number) => 4 + (s.coarse ? 0 : 0.5 * s.cells) + wireKB(s) / kbPerS

  it('fits its requests to what the link can finish: batches shrink until they get through, and the view fills up', async () => {
    const LIMIT_S = 9
    const kbPerS = 50
    const net = network({
      delayMs: (s) => (s.coarse ? seconds(s, kbPerS) : Math.min(seconds(s, kbPerS), LIMIT_S)) * 1000,
      // A detail request that needs more than LIMIT_S is cut off (a stalled or too slow answer); the coarse region is one cheap answer.
      fail: (s) => (!s.coarse && seconds(s, kbPerS) > LIMIT_S ? new OverpassError('network', 'timed out') : undefined),
    })
    // The old fixed batch of four cells would never get through on this link: 4 + 2 + 12.8 s.
    expect(seconds({ at: 0, coarse: false, cells: 4, box: cellBBox(C) }, kbPerS)).toBeGreaterThan(LIMIT_S)
    const world = new LiveWorld(C)
    const s = new Streamer({ client: net.client, world, online: () => true, random: () => 0.5 })
    s.setView(shrink(around(1)), centreOf(C), DETAIL)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) expect(world.needs({ i: C.i + di, j: C.j + dj })).toBe(false)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    expect(s.batchSize).toBeLessThanOrEqual(2)
    // It learned the limit once: a few failures, not one per batch.
    expect(net.log.filter((l) => !l.coarse && seconds(l, kbPerS) > LIMIT_S).length).toBeLessThanOrEqual(3)
    s.dispose()
  })

  it('paints the whole view with the coarse layer long before the detail is in, on a 1 Mbit/s link', async () => {
    const kbPerS = 125
    const net = network({ delayMs: (s) => seconds(s, kbPerS) * 1000 })
    const world = new LiveWorld(C)
    const marks: Record<string, number> = {}
    const t0 = Date.now()
    const s = new Streamer({
      client: net.client,
      world,
      online: () => true,
      onLoad: (l) => {
        if (l.ready === 'coarse') marks.coarse ??= Date.now() - t0
        if (l.ready === 'full') marks.full ??= Date.now() - t0
      },
    })
    // A 2 × 4 km phone view at zoom 1 is 3 × 3 cells here; its horizon is the same size.
    s.setView(shrink(around(1)), centreOf(C), DETAIL, around(1))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    // The worst alignment: the view straddles four regions, one request each, one at a time.
    expect(marks.coarse).toBeLessThan(30_000)
    expect(marks.full).toBeGreaterThan(marks.coarse!)
    s.dispose()
  })

  it('has the placeholder in about one request when the view sits inside one region', async () => {
    const net = network({ delayMs: (s) => seconds(s, 125) * 1000 })
    const inside = { i: C.i - 2, j: C.j + 2 }
    const world = new LiveWorld(inside)
    let coarseAt = 0
    const t0 = Date.now()
    const s = new Streamer({ client: net.client, world, online: () => true, onLoad: (l) => l.ready === 'coarse' && (coarseAt ||= Date.now() - t0) })
    s.setView(shrink(around(1, inside)), centreOf(inside), DETAIL, around(1, inside))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(coarseAt).toBeGreaterThan(0)
    expect(coarseAt).toBeLessThan(10_000)
    s.dispose()
  })
})

it('names its region keys the way the client does', () => {
  expect(regionCells(regionOf(C))).toHaveLength(25)
  expect(cellKey(C)).toBe('3949,-40')
})
