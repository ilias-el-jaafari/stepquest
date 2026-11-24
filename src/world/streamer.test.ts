import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryCache } from '../osm/cache.ts'
import { encodeOsm } from '../osm/codec.ts'
import { normalizeOverpass } from '../osm/normalize.ts'
import { MIN_REQUEST_GAP_MS, OverpassClient, OverpassError, type Downloader } from '../osm/overpass.ts'
import { cellBBox, cellKey, cellsBBox, type CellId } from './cells.ts'
import type { CellRecord } from './slice.ts'
import { BACKOFF_MAX_MS, BACKOFF_START_MS, backoffMs, MAX_CELLS_PER_MINUTE, SETTLE_MS, Streamer, type CellClient, type StreamTarget } from './streamer.ts'
import { LiveWorld } from './liveWorld.ts'
import { makeRecord } from './testing.ts'

const C = { i: 3949, j: -40 }
/** A view box of (2r+1)² cells around C. */
const around = (r: number, at: CellId = C) => cellsBBox([{ i: at.i - r, j: at.j - r }, { i: at.i + r, j: at.j + r }])
const centreOf = (c: CellId) => ({ lat: (c.i + 0.5) / 100, lon: (c.j + 0.5) / 100 })
const shrink = (b: ReturnType<typeof around>) => ({ south: b.south + 1e-5, west: b.west + 1e-5, north: b.north - 1e-5, east: b.east - 1e-5 })

/** A world that only remembers which cells it has. */
function fakeWorld(): StreamTarget & { have: Set<string>; loading: CellId[] } {
  const have = new Set<string>()
  const w = {
    have,
    loading: [] as CellId[],
    inFrame: (c: CellId) => Math.abs(c.i - C.i) <= 4 && Math.abs(c.j - C.j) <= 4,
    needs: (c: CellId) => w.inFrame(c) && !have.has(cellKey(c)),
    add: (recs: readonly CellRecord[]) => recs.filter((r) => !have.has(cellKey(r.cell)) && have.add(cellKey(r.cell))).map((r) => r.cell),
    setLoading: (cells: readonly CellId[]) => void (w.loading = [...cells]),
    touch: () => undefined,
    evict: () => [],
  }
  return w
}

/** A real client with a fake downloader that logs every request and can be made to fail. */
function client(opts: { fail?: () => OverpassError | undefined; delayMs?: number } = {}) {
  const log: { at: number; cells: number }[] = []
  let inFlight = 0
  let maxInFlight = 0
  const download: Downloader = async (bbox) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    log.push({ at: Date.now(), cells: Math.round(((bbox.north - bbox.south) * (bbox.east - bbox.west)) / 1e-4) })
    try {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const err = opts.fail?.()
      if (err) throw err
      return encodeOsm(normalizeOverpass({ elements: [] }, bbox))
    } finally {
      inFlight--
    }
  }
  const c = new OverpassClient({ cache: new MemoryCache(), download })
  return { c, log, maxInFlight: () => maxInFlight }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('cell streamer (19.2 to 19.5)', () => {
  it('sends nothing while the map keeps moving, then asks once it rests', async () => {
    const { c, log } = client()
    const s = new Streamer({ client: c, world: fakeWorld(), online: () => true })
    for (let k = 0; k < 10; k++) {
      s.setView(shrink(around(0, { i: C.i, j: C.j + (k % 3) - 1 })), centreOf(C))
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(log).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(log).toHaveLength(1)
    s.dispose()
  })

  it('does not restart the wait while the view keeps the same cells (follow mode)', async () => {
    const { c, log } = client()
    const s = new Streamer({ client: c, world: fakeWorld(), online: () => true })
    const b = shrink(around(0))
    for (let k = 0; k < 4; k++) {
      s.setView({ ...b, south: b.south + k * 1e-4, north: b.north - k * 1e-4 }, centreOf(C))
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(log).toHaveLength(1)
    s.dispose()
  })

  it('asks for the nearest cells first, at most four per request, one request in flight, 10 s apart, 12 cells a minute', async () => {
    const { c, log, maxInFlight } = client({ delayMs: 3000 })
    const world = fakeWorld()
    const s = new Streamer({ client: c, world, online: () => true })
    s.setView(shrink(around(2)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)
    expect(log[0]!.cells).toBeLessThanOrEqual(4)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(world.have.has(cellKey(C))).toBe(true)
    expect(world.have.size).toBe(25)
    expect(maxInFlight()).toBe(1)
    for (let k = 1; k < log.length; k++) expect(log[k]!.at - log[k - 1]!.at).toBeGreaterThanOrEqual(MIN_REQUEST_GAP_MS)
    for (const a of log) expect(log.filter((b) => b.at >= a.at && b.at < a.at + 60_000).reduce((n, b) => n + b.cells, 0)).toBeLessThanOrEqual(MAX_CELLS_PER_MINUTE)
    expect(log.reduce((n, b) => n + b.cells, 0)).toBe(25)
    s.dispose()
  })

  it('drops the stale wish list when the view moves before a request', async () => {
    const { c, log } = client()
    const world = fakeWorld()
    const s = new Streamer({ client: c, world, online: () => true })
    s.setView(shrink(around(0)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    const other = { i: C.i + 3, j: C.j + 3 }
    s.setView(shrink(around(0, other)), centreOf(other))
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)
    expect(log).toHaveLength(1)
    expect([...world.have]).toEqual([cellKey(other)])
    s.dispose()
  })

  it('backs off after a failure (30 s, doubling, capped at 5 min) and never retries in a loop', async () => {
    let failing = true
    const { c, log } = client({ fail: () => (failing ? new OverpassError('network', 'down') : undefined) })
    const errors: string[] = []
    const s = new Streamer({ client: c, world: fakeWorld(), online: () => true, onError: (e) => errors.push(e) })
    s.setView(shrink(around(0)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)
    expect(log).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS - 1000)
    expect(log).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(log).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2 * BACKOFF_START_MS + 1000)
    expect(log).toHaveLength(3)
    expect(backoffMs(10)).toBe(BACKOFF_MAX_MS)
    failing = false
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS)
    expect(log).toHaveLength(4)
    expect(errors).toEqual(['network', 'network', 'network'])
    s.dispose()
  })

  it('pauses every request after a 429', async () => {
    let first = true
    const { c, log } = client({
      fail: () => {
        const e = first ? new OverpassError('rateLimited', '429') : undefined
        first = false
        return e
      },
    })
    const s = new Streamer({ client: c, world: fakeWorld(), online: () => true })
    s.setView(shrink(around(0)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)
    // Another cell comes into view: it waits too.
    s.setView(shrink(around(0, { i: C.i, j: C.j + 1 })), centreOf({ i: C.i, j: C.j + 1 }))
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS - 2000)
    expect(log).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(log).toHaveLength(2)
    s.dispose()
  })

  it('loads cached cells without a request, and requests nothing offline', async () => {
    const cached: CellClient = {
      busy: false,
      waitMs: () => 0,
      cachedCell: async (c) => (c.i === C.i && c.j === C.j ? makeRecord(c, []) : undefined),
      loadCells: vi.fn(async () => ({ records: [], cached: [], downloaded: [] })),
    }
    const world = fakeWorld()
    const changes: CellId[][] = []
    const s = new Streamer({ client: cached, world, online: () => false, onChange: (c) => changes.push(c) })
    s.setView(shrink(around(1)), centreOf(C))
    expect(world.loading).toEqual([])
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 5)
    expect(world.have.has(cellKey(C))).toBe(true)
    expect(changes).toEqual([[C]])
    expect(cached.loadCells).not.toHaveBeenCalled()
    s.dispose()
  })

  it('marks the wanted cells as loading at once, and none outside the frame', () => {
    const world = fakeWorld()
    const s = new Streamer({ client: client().c, world, online: () => true })
    s.setView(shrink(around(0, { i: C.i + 4, j: C.j })), centreOf(C))
    expect(world.loading).toEqual([{ i: C.i + 4, j: C.j }])
    s.setView(shrink(around(0, { i: C.i + 6, j: C.j })), centreOf(C))
    expect(world.loading).toEqual([])
    s.dispose()
  })

  it('grows a real live world from downloaded cells, and the second visit reads the cache', async () => {
    const { c, log } = client()
    const lw = new LiveWorld(C)
    const s = new Streamer({ client: c, world: lw, online: () => true })
    s.setView(shrink(cellBBox(C)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)
    expect(lw.needs(C)).toBe(false)
    expect(lw.loading()).toEqual([])
    const again = new LiveWorld(C)
    const s2 = new Streamer({ client: c, world: again, online: () => true })
    s2.setView(shrink(cellBBox(C)), centreOf(C))
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1)
    expect(again.needs(C)).toBe(false)
    expect(log).toHaveLength(1)
    s.dispose()
    s2.dispose()
  })
})
