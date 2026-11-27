import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LodSource } from '../vector/client.ts'
import { TileError } from '../vector/fetchTile.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { connectionPolicy, LOD_MAX_PARALLEL, LodPrefetcher, planPrefetch, PREFETCH_MAX_BYTES, PREFETCH_MAX_TILES, RATE_LIMIT_PAUSE_MS, RING_MAX_PARALLEL, RING_STARTS_PER_MINUTE, SETTLE_MS, SLOW_RADIUS_M, type ConnectionInfo } from './prefetch.ts'
import { FOCUS_RADIUS_M } from './config.ts'
import { distanceToTileM, tilesWithin } from './select.ts'
import { LodStore } from './store.ts'
import { emptyLod } from './tile.ts'

const HERO = { lat: 39.4935, lon: -0.392 }
const OSLO = { lat: 60, lon: 10.75 }
const VIEW = { box: { south: 39.49, north: 39.51, west: -0.40, east: -0.38 }, centre: { lat: 39.5, lon: -0.39 } }

type Mutable = { busy: boolean; lodWireBytes: number }
type Fake = { src: LodSource & Mutable; started: TileId[]; inFlight: () => number; peak: () => number; cache: Map<string, true>; fail: Map<string, TileError>; delay: number }

function fake(delay = 500): Fake {
  const started: TileId[] = []
  let now = 0
  let peak = 0
  const cache = new Map<string, true>()
  const fail = new Map<string, TileError>()
  const f: Fake = {
    started,
    cache,
    fail,
    delay,
    inFlight: () => now,
    peak: () => peak,
    src: {
      busy: false as boolean,
      running: 0,
      lodWireBytes: 0,
      cachedLod: async (t) => (cache.has(tileKey(t)) ? emptyLod(t) : undefined),
      loadLod: async (t) => {
        started.push(t)
        now++
        peak = Math.max(peak, now)
        try {
          await new Promise((r) => setTimeout(r, f.delay))
          const err = fail.get(tileKey(t))
          if (err) throw err
          return emptyLod(t)
        } finally {
          now--
        }
      },
    },
  }
  return f
}

function setup(over: Partial<ConstructorParameters<typeof LodPrefetcher>[0]> = {}, delay = 500) {
  const srv = fake(delay)
  const store = new LodStore({ canvas: () => undefined })
  const p = new LodPrefetcher({ source: srv.src, store, radiusM: 9_000, online: () => true, hidden: () => false, connection: () => undefined, ...over })
  return { srv, store, p }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const settle = (ms = SETTLE_MS + 1) => vi.advanceTimersByTimeAsync(ms)

describe('prefetch plan (requirement 25.8)', () => {
  it('lists the view tiles first, nearest the view centre first, then the ring tiles by distance from the hero, no tile twice', () => {
    const plan = planPrefetch(VIEW, HERO, 9_000)
    const firstRing = plan.findIndex((p) => p.lane === 'ring')
    expect(firstRing).toBeGreaterThan(0)
    expect(plan.slice(0, firstRing).every((p) => p.lane === 'view')).toBe(true)
    expect(plan.slice(firstRing).every((p) => p.lane === 'ring')).toBe(true)
    const ring = plan.slice(firstRing)
    for (let i = 1; i < ring.length; i++) expect(ring[i - 1]!.distM <= ring[i]!.distM).toBe(true)
    expect(new Set(plan.map((p) => tileKey(p.id))).size).toBe(plan.length)
    const view = plan.slice(0, firstRing)
    for (let i = 1; i < view.length; i++) expect(distanceToTileM(view[i - 1]!.id, VIEW.centre) <= distanceToTileM(view[i]!.id, VIEW.centre)).toBe(true)
  })

  it('no hero or radius 0: only the view; no view: only the rings', () => {
    expect(planPrefetch(VIEW, undefined, 9_000).every((p) => p.lane === 'view')).toBe(true)
    expect(planPrefetch(VIEW, HERO, 0).every((p) => p.lane === 'view')).toBe(true)
    expect(planPrefetch(undefined, HERO, 9_000).every((p) => p.lane === 'ring')).toBe(true)
  })
})

describe('prefetch order and limits (requirement 25.8)', () => {
  it('sends nothing until the view has rested, then view tiles first and rings nearest first', async () => {
    const { srv, p } = setup()
    p.setHero(HERO)
    for (let k = 0; k < 5; k++) {
      p.setView({ ...VIEW.box, west: VIEW.box.west + k * 0.03, east: VIEW.box.east + k * 0.03 }, VIEW.centre)
      await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    }
    expect(srv.started).toHaveLength(0)
    const view = planPrefetch(VIEW, undefined, 0)
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    const order = srv.started.map(tileKey)
    expect(order.slice(0, view.length)).toEqual(view.map((v) => tileKey(v.id)))
    const ring = tilesWithin(HERO, 9_000).filter((t) => !view.some((v) => tileKey(v.id) === tileKey(t.id)))
    expect(order.slice(view.length, view.length + 12)).toEqual(ring.slice(0, 12).map((t) => tileKey(t.id)))
  })

  it('never has more than 4 downloads at once, and the rings never more than 2', async () => {
    const { srv, p } = setup()
    p.setHero(HERO)
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(srv.started.length).toBeGreaterThan(60)
    expect(srv.peak()).toBeLessThanOrEqual(LOD_MAX_PARALLEL)
    expect(p.peak).toBeLessThanOrEqual(LOD_MAX_PARALLEL)
    expect(p.peakRing).toBeLessThanOrEqual(RING_MAX_PARALLEL)
    expect(p.peakRing).toBe(RING_MAX_PARALLEL)
  })

  it('starts at most 60 ring downloads in any minute', async () => {
    const { srv, p } = setup({}, 10)
    p.setHero(OSLO)
    await settle()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(srv.started.length).toBeLessThanOrEqual(RING_STARTS_PER_MINUTE)
    expect(srv.started.length).toBeGreaterThan(RING_STARTS_PER_MINUTE - 5)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(srv.started.length).toBeGreaterThan(RING_STARTS_PER_MINUTE)
  })

  it('reads the device cache first, at once, and downloads only what it lacks', async () => {
    const { srv, store, p } = setup()
    const near = tilesWithin(HERO, 9_000).slice(0, 10)
    for (const t of near) srv.cache.set(tileKey(t.id), true)
    p.setHero(HERO)
    await vi.advanceTimersByTimeAsync(10)
    for (const t of near) expect(store.state(t.id)).toBe('ready')
    expect(srv.started).toHaveLength(0)
    await settle()
    expect(srv.started.some((t) => near.some((n) => tileKey(n.id) === tileKey(t)))).toBe(false)
    expect(srv.started.length).toBeGreaterThan(0)
  })

  it('stops the rings after the tile and byte caps, but still loads what the view needs', async () => {
    const a = setup({ radiusM: 15_000 }, 1)
    a.p.setHero(OSLO)
    await settle()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(a.p.ringDone).toBe(PREFETCH_MAX_TILES)
    const b = setup({}, 1)
    b.srv.src.lodWireBytes = PREFETCH_MAX_BYTES
    b.p.setHero(HERO)
    b.p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(b.p.ringRequests).toBe(0)
    expect(b.srv.started.length).toBe(planPrefetch(VIEW, undefined, 0).length)
  })
})

describe('connection policy (requirement 25.8)', () => {
  it('pauses the rings on save-data and on slow-2g or 2g, goes one at a time to 5 km on 3g, else as configured', () => {
    expect(connectionPolicy({ saveData: true }, 9_000).rings).toBe(false)
    expect(connectionPolicy({ effectiveType: 'slow-2g' }, 9_000).rings).toBe(false)
    expect(connectionPolicy({ effectiveType: '2g' }, 9_000).rings).toBe(false)
    expect(connectionPolicy({ effectiveType: '3g' }, 9_000)).toEqual({ rings: true, parallel: 1, radiusM: SLOW_RADIUS_M })
    expect(connectionPolicy({ effectiveType: '3g' }, 3_000).radiusM).toBe(3_000)
    expect(connectionPolicy({ effectiveType: '4g' }, 9_000)).toEqual({ rings: true, parallel: RING_MAX_PARALLEL, radiusM: 9_000 })
    expect(connectionPolicy(undefined, 9_000).rings).toBe(true)
  })

  const run = async (conn: ConnectionInfo) => {
    const { srv, p } = setup({ connection: () => conn })
    p.setHero(HERO)
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)
    return { srv, p }
  }

  it('with save-data only the view is loaded', async () => {
    const { srv, p } = await run({ saveData: true })
    expect(srv.started.length).toBe(planPrefetch(VIEW, undefined, 0).length)
    expect(p.ringRequests).toBe(0)
  })

  it('on 3g the rings run one at a time and stay within 5 km of the hero', async () => {
    const { srv, p } = await run({ effectiveType: '3g' })
    expect(p.peakRing).toBe(1)
    const view = new Set(planPrefetch(VIEW, undefined, 0).map((v) => tileKey(v.id)))
    for (const t of srv.started) if (!view.has(tileKey(t))) expect(distanceToTileM(t, HERO)).toBeLessThanOrEqual(SLOW_RADIUS_M)
  })
})

describe('what stops it', () => {
  it('sends nothing offline, and carries on after retry when the device is back', async () => {
    let online = false
    const { srv, p } = setup({ online: () => online })
    p.setHero(HERO)
    p.setView(VIEW.box, VIEW.centre)
    await settle(5_000)
    expect(srv.started).toHaveLength(0)
    online = true
    p.retry()
    await settle(5_000)
    expect(srv.started.length).toBeGreaterThan(0)
  })

  it('with the page hidden the rings wait, the view does not', async () => {
    let hidden = true
    const { srv, p } = setup({ hidden: () => hidden })
    p.setHero(HERO)
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(srv.started.length).toBe(planPrefetch(VIEW, undefined, 0).length)
    hidden = false
    p.retry()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(srv.started.length).toBeGreaterThan(planPrefetch(VIEW, undefined, 0).length)
  })

  it('waits for a free slot when the shared client is busy, without counting a failure', async () => {
    const { srv, p, store } = setup()
    srv.src.busy = true
    p.setHero(HERO)
    p.setView(VIEW.box, VIEW.centre)
    await settle(3_000)
    expect(srv.started).toHaveLength(0)
    srv.src.busy = false
    await vi.advanceTimersByTimeAsync(2_000)
    expect(srv.started.length).toBeGreaterThan(0)
    expect(planPrefetch(VIEW, undefined, 0).some((v) => store.state(v.id) === 'failed')).toBe(false)
  })

  it('a failed tile is marked failed (so the coarse layer takes over), retried after a back-off, and a 429 pauses everything', async () => {
    const { srv, p, store } = setup({ random: () => 0.5 }, 10)
    const first = planPrefetch(VIEW, undefined, 0)[0]!
    srv.fail.set(tileKey(first.id), new TileError('network', 'down'))
    p.setView(VIEW.box, VIEW.centre)
    await settle(1_000)
    expect(store.state(first.id)).toBe('failed')
    const n = srv.started.filter((t) => tileKey(t) === tileKey(first.id)).length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(srv.started.filter((t) => tileKey(t) === tileKey(first.id)).length).toBe(n)
    srv.fail.delete(tileKey(first.id))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(store.state(first.id)).toBe('ready')

    const rl = setup({ random: () => 0.5 }, 10)
    const view = planPrefetch(VIEW, undefined, 0)
    rl.srv.fail.set(tileKey(view[0]!.id), new TileError('rateLimited', '429'))
    rl.p.setView(VIEW.box, VIEW.centre)
    await settle()
    const sent = rl.srv.started.length
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_PAUSE_MS - 2_000)
    expect(rl.srv.started.length).toBe(sent)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(rl.srv.started.length).toBeGreaterThan(sent)
  })

  it('dispose stops it', async () => {
    const { srv, p } = setup()
    p.setHero(HERO)
    p.dispose()
    await settle(5_000)
    expect(srv.started).toHaveLength(0)
  })
})

describe('focus tiles around a far finish or a far view (requirement 26.3)', () => {
  // About 9 km north-east of the hero: outside the 9 km test ring, inside 10 km of the real default.
  const FAR = { lat: HERO.lat + 0.07, lon: HERO.lon + 0.07 }

  it('plans view tiles, then the tiles within the focus radius of each focus point (the finish first), then the rings, no tile twice', () => {
    const second = { lat: HERO.lat - 0.1, lon: HERO.lon }
    const plan = planPrefetch(VIEW, HERO, 9_000, [FAR, second])
    const lanes = plan.map((p) => p.lane)
    expect(lanes.indexOf('view')).toBe(0)
    expect(lanes.lastIndexOf('view')).toBeLessThan(lanes.indexOf('focus'))
    expect(lanes.lastIndexOf('focus')).toBeLessThan(lanes.indexOf('ring'))
    const focus = plan.filter((p) => p.lane === 'focus')
    expect(focus.length).toBeGreaterThan(4)
    expect(distanceToTileM(focus[0]!.id, FAR)).toBe(0)
    expect(focus.some((f) => distanceToTileM(f.id, second) === 0)).toBe(true)
    expect(focus.every((f) => Math.min(distanceToTileM(f.id, FAR), distanceToTileM(f.id, second)) <= FOCUS_RADIUS_M)).toBe(true)
    expect(new Set(plan.map((p) => tileKey(p.id))).size).toBe(plan.length)
  })

  it('loads a far focus before the rings, inside the same limits (4 downloads, 2 for rings and focus together)', async () => {
    const { srv, p } = setup()
    p.setHero(HERO)
    p.setFocus([FAR])
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(120_000)
    const keys = srv.started.map(tileKey)
    const view = planPrefetch(VIEW, undefined, 0).length
    const focus = planPrefetch(undefined, undefined, 9_000, [FAR]).map((f) => tileKey(f.id))
    const afterView = keys.slice(view)
    expect(afterView.slice(0, focus.length).sort()).toEqual([...focus].sort())
    expect(srv.peak()).toBeLessThanOrEqual(LOD_MAX_PARALLEL)
    expect(p.peakRing).toBeLessThanOrEqual(RING_MAX_PARALLEL)
    expect(p.focusDone).toBe(focus.length)
  })

  it('a far focus still loads after the ring cap is spent, up to its own cap; save-data stops it like the rings', async () => {
    const { srv, p } = setup({ connection: () => undefined }, 5)
    p.ringDone = PREFETCH_MAX_TILES
    p.setFocus([FAR])
    p.setView(VIEW.box, VIEW.centre)
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(p.focusDone).toBeGreaterThan(4)
    expect(srv.started.length).toBeGreaterThan(p.focusDone)
    const saver = setup({ connection: () => ({ saveData: true }) }, 5)
    saver.p.setFocus([FAR])
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(saver.srv.started.length).toBe(0)
  })

  it('stays quiet while offline or hidden, and sends nothing before the view has rested', async () => {
    const { srv, p } = setup({ online: () => false })
    p.setFocus([FAR])
    await settle()
    expect(srv.started).toHaveLength(0)
    const early = setup()
    early.p.setFocus([FAR])
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2)
    expect(early.srv.started).toHaveLength(0)
  })
})
