import type { BBox, LatLon } from '../geo/geo.ts'
import { TileError, type TileErrorCode } from '../vector/fetchTile.ts'
import type { LodSource } from '../vector/client.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { clampRadius, FOCUS_MAX_TILES, FOCUS_RADIUS_M } from './config.ts'
import { tilesInView, tilesWithin } from './select.ts'
import type { LodStore } from './store.ts'

/** Downloads at once, all lanes together (OpenFreeMap asks for at most 4 parallel requests; `VectorTileClient` enforces it too). */
export const LOD_MAX_PARALLEL = 4
/** Of those, the ring lane takes at most this many, so a pan never waits for the rings. */
export const RING_MAX_PARALLEL = 2
/** Ring downloads started in any 60 s. */
export const RING_STARTS_PER_MINUTE = 60
/** The rings stop for the session after this many tiles or bytes of raw tile data (requirement 25.8). */
export const PREFETCH_MAX_TILES = 200
export const PREFETCH_MAX_BYTES = 40 * 1024 * 1024
/** On a 3g link the rings go one at a time and only this far. */
export const SLOW_RADIUS_M = 5_000
/** The view must rest this long before tiles are requested (cached data shows at once). */
export const SETTLE_MS = 400
/** The view lane never plans more than this many tiles (a phone view at the furthest zoom meets about 15). */
export const MAX_VIEW_TILES = 40
export const BACKOFF_START_MS = 2_000
export const BACKOFF_MAX_MS = 60_000
export const RATE_LIMIT_PAUSE_MS = 30_000
const BUSY_WAIT_MS = 250
const MINUTE_MS = 60_000
const WATCHDOG_MS = 40_000

/** What the browser says about the link (`navigator.connection`; absent in Safari and Firefox, which means "no restriction"). */
export type ConnectionInfo = { saveData?: boolean; effectiveType?: string }

export type RingPolicy = { rings: boolean; parallel: number; radiusM: number }

/** What the rings may do on this link (requirement 25.8): nothing on save-data or 2g, one at a time to 5 km on 3g, else as configured. */
export function connectionPolicy(c: ConnectionInfo | undefined, radiusM: number): RingPolicy {
  if (c?.saveData || c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g') return { rings: false, parallel: 0, radiusM: 0 }
  if (c?.effectiveType === '3g') return { rings: true, parallel: 1, radiusM: Math.min(radiusM, SLOW_RADIUS_M) }
  return { rings: true, parallel: RING_MAX_PARALLEL, radiusM }
}

export type Lane = 'view' | 'focus' | 'ring'
export type Planned = { id: TileId; distM: number; lane: Lane }

/**
 * The tiles to have, in order: those the view shows (nearest the view centre first), then those within `FOCUS_RADIUS_M` of each
 * focus point (the finish first; requirement 26.3), then the rings around the hero (nearest first).
 */
export function planPrefetch(view: { box: BBox; centre: LatLon } | undefined, hero: LatLon | undefined, radiusM: number, focus: readonly LatLon[] = []): Planned[] {
  const out: Planned[] = []
  const seen = new Set<string>()
  if (view) {
    for (const t of tilesInView(view.box, view.centre).slice(0, MAX_VIEW_TILES)) {
      seen.add(tileKey(t.id))
      out.push({ ...t, lane: 'view' })
    }
  }
  if (radiusM > 0) {
    for (const f of focus) {
      for (const t of tilesWithin(f, FOCUS_RADIUS_M)) {
        const k = tileKey(t.id)
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ ...t, lane: 'focus' })
      }
    }
  }
  if (hero && radiusM > 0) {
    for (const t of tilesWithin(hero, radiusM)) {
      if (!seen.has(tileKey(t.id))) out.push({ ...t, lane: 'ring' })
    }
  }
  return out
}

export type PrefetchOptions = {
  source: LodSource
  store: LodStore
  radiusM?: number
  online?: () => boolean
  hidden?: () => boolean
  connection?: () => ConnectionInfo | undefined
  now?: () => number
  random?: () => number
  onError?: (code: TileErrorCode) => void
  /** Called when the set of tiles in flight or waiting changes (readiness). */
  onProgress?: () => void
}

/**
 * Loads the LOD tiles (requirement 25.8): cached ones at once, then downloads after the view has rested, view tiles first and
 * then rings outward from the hero. All of it goes through the shared `VectorTileClient`, so the 4-slot limit holds for the map,
 * the walking graph and these together.
 */
export class LodPrefetcher {
  private readonly o: Required<Omit<PrefetchOptions, 'onError' | 'onProgress'>> & Pick<PrefetchOptions, 'onError' | 'onProgress'>
  private view: { box: BBox; centre: LatLon } | undefined
  private hero: LatLon | undefined
  private focus: LatLon[] = []
  private viewKey = ''
  /** Nothing is requested before the first view has rested (the app sends it within a frame of the map's first draw). */
  private settledAt: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerAt = Infinity
  private pumping = false
  private again = false
  private disposed = false
  private pausedUntil = 0
  private readonly inFlight = new Map<string, Lane>()
  private readonly failures = new Map<string, { n: number; until: number }>()
  private readonly missed = new Set<string>()
  private readonly ringStarts: number[] = []
  /** Downloads started, and ring downloads started (tests, diagnostics). */
  requests = 0
  ringRequests = 0
  /** Most downloads seen at once, and most ring downloads at once (tests). */
  peak = 0
  peakRing = 0

  constructor(options: PrefetchOptions) {
    this.o = {
      radiusM: clampRadius(options.radiusM ?? NaN),
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      hidden: () => typeof document !== 'undefined' && document.hidden === true,
      connection: () => (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: ConnectionInfo }).connection),
      now: () => Date.now(),
      random: () => Math.random(),
      ...options,
    }
    this.settledAt = this.o.now() + SETTLE_MS
  }

  get radiusM(): number {
    return this.o.radiusM
  }

  setRadius(m: number): void {
    this.o.radiusM = clampRadius(m)
    this.schedule(0)
  }

  /** The hero moved (the quest's walker or the planner's start). */
  setHero(hero: LatLon | undefined): void {
    if (this.disposed) return
    this.hero = hero
    this.schedule(0)
  }

  /** The places away from the hero that get the full detail too (the tapped finish, places the view rested at). */
  setFocus(points: readonly LatLon[]): void {
    if (this.disposed) return
    this.focus = [...points]
    this.schedule(0)
  }

  /** The view moved; downloads wait until it has rested. */
  setView(box: BBox, centre: LatLon): void {
    if (this.disposed) return
    this.view = { box, centre }
    const key = planPrefetch(this.view, undefined, 0).map((p) => tileKey(p.id)).join(';')
    if (key !== this.viewKey) {
      this.viewKey = key
      this.settledAt = this.o.now() + SETTLE_MS
    }
    this.schedule(0)
  }

  /** The device came back online or the page is visible again. */
  retry(): void {
    if (this.disposed) return
    this.missed.clear()
    this.schedule(0)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Tiles in flight now. */
  get active(): number {
    return this.inFlight.size
  }

  /** Ring tiles and focus tiles loaded this session. */
  ringDone = 0
  focusDone = 0

  private schedule(ms: number): void {
    if (this.disposed) return
    const at = this.o.now() + ms
    if (this.timer !== undefined && this.timerAt <= at) return
    clearTimeout(this.timer)
    this.timerAt = at
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.timerAt = Infinity
      void this.pump()
    }, ms)
  }

  private planned(): Planned[] {
    const policy = connectionPolicy(this.o.connection(), this.o.radiusM)
    return planPrefetch(this.view, this.hero, policy.rings ? policy.radiusM : 0, this.focus)
  }

  private async pump(): Promise<void> {
    if (this.disposed) return
    if (this.pumping) {
      this.again = true
      return
    }
    this.pumping = true
    try {
      await this.cachePass()
      if (!this.disposed) this.launch()
    } finally {
      this.pumping = false
    }
    if (this.again && !this.disposed) {
      this.again = false
      this.schedule(0)
    }
  }

  /** Read the device cache for tiles that are not in memory: local only, view first, then rings nearest first. */
  private async cachePass(): Promise<void> {
    let changed = false
    for (const p of this.planned()) {
      const key = tileKey(p.id)
      if (this.disposed) return
      if (this.o.store.state(p.id) === 'ready' || this.missed.has(key) || this.inFlight.has(key)) continue
      const hit = await this.o.source.cachedLod(p.id).catch(() => undefined)
      if (this.disposed) return
      if (hit) {
        this.o.store.put(hit)
        changed = true
      } else this.missed.add(key)
    }
    if (changed) this.o.onProgress?.()
  }

  /** Focus tiles obey the link policy and their own session cap, not the ring cap (the player asked for that place). */
  private focusAllowed(): boolean {
    const policy = connectionPolicy(this.o.connection(), this.o.radiusM)
    return policy.rings && !this.o.hidden() && this.focusDone < FOCUS_MAX_TILES
  }

  private ringsAllowed(): boolean {
    const policy = connectionPolicy(this.o.connection(), this.o.radiusM)
    if (!policy.rings || this.o.hidden()) return false
    return this.ringDone < PREFETCH_MAX_TILES && this.o.source.lodWireBytes < PREFETCH_MAX_BYTES
  }

  private launch(): void {
    if (!this.o.online()) return
    const now = this.o.now()
    if (now < this.settledAt) return this.schedule(this.settledAt - now)
    if (now < this.pausedUntil) return this.schedule(this.pausedUntil - now)
    const policy = connectionPolicy(this.o.connection(), this.o.radiusM)
    while (this.ringStarts.length && this.ringStarts[0]! <= now - MINUTE_MS) this.ringStarts.shift()
    let wake = Infinity
    let viewMissing = false
    for (const p of this.planned()) {
      const key = tileKey(p.id)
      if (this.o.store.state(p.id) === 'ready' || this.inFlight.has(key)) continue
      if (p.lane === 'view') viewMissing = true
      if (this.inFlight.size >= LOD_MAX_PARALLEL) break
      if (this.o.source.busy) {
        wake = Math.min(wake, BUSY_WAIT_MS)
        break
      }
      const cool = this.failures.get(key)
      if (cool && cool.until > now) {
        wake = Math.min(wake, cool.until - now)
        continue
      }
      if (p.lane !== 'view') {
        // The rings and the focus tiles wait for the view, and share the lane limits (at most 2 downloads, 60 starts a minute).
        if (viewMissing || !(p.lane === 'focus' ? this.focusAllowed() : this.ringsAllowed())) break
        const rings = [...this.inFlight.values()].filter((l) => l !== 'view').length
        if (rings >= policy.parallel) break
        if (this.ringStarts.length >= RING_STARTS_PER_MINUTE) {
          wake = Math.min(wake, this.ringStarts[0]! + MINUTE_MS - now)
          break
        }
        this.ringStarts.push(now)
        if (p.lane === 'ring') this.ringRequests++
      }
      this.start(p)
    }
    if (wake < Infinity) this.schedule(Math.max(100, wake))
  }

  private start(p: Planned): void {
    const key = tileKey(p.id)
    this.inFlight.set(key, p.lane)
    this.requests++
    this.peak = Math.max(this.peak, this.inFlight.size)
    this.peakRing = Math.max(this.peakRing, [...this.inFlight.values()].filter((l) => l !== 'view').length)
    this.o.store.markPending(p.id)
    void this.run(p, key)
  }

  private async run(p: Planned, key: string): Promise<void> {
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      const stuck = new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => reject(new TileError('network', 'No answer')), WATCHDOG_MS)
      })
      const tile = await Promise.race([this.o.source.loadLod(p.id), stuck])
      this.failures.delete(key)
      if (p.lane === 'ring') this.ringDone++
      else if (p.lane === 'focus') this.focusDone++
      if (!this.disposed) {
        this.o.store.put(tile)
        this.o.onProgress?.()
      }
    } catch (error) {
      this.failed(p, key, error)
    } finally {
      clearTimeout(watchdog)
      this.inFlight.delete(key)
    }
    this.schedule(0)
  }

  private failed(p: Planned, key: string, error: unknown): void {
    const code: TileErrorCode = error instanceof TileError ? error.code : 'network'
    const now = this.o.now()
    if (code === 'busy') {
      // Our own slot limit (the map's tiles hold the slots): not a failure of the server.
      this.failures.set(key, { n: this.failures.get(key)?.n ?? 0, until: now + BUSY_WAIT_MS })
      return
    }
    const n = (this.failures.get(key)?.n ?? 0) + 1
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (n - 1))
    this.failures.set(key, { n, until: now + Math.round(base * (0.75 + 0.5 * this.o.random())) })
    if (code === 'rateLimited') this.pausedUntil = now + Math.round(RATE_LIMIT_PAUSE_MS * (0.75 + 0.5 * this.o.random()))
    this.o.store.markFailed(p.id)
    this.o.onError?.(code)
  }
}
