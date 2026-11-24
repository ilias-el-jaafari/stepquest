/** Which map chunks to draw, in which order, and a cache that never drops what is on screen. Pure, no DOM. */

export type ChunkRef = { cx: number; cy: number }

export type ChunkPlan = {
  /** Chunks touching the screen, nearest to the screen centre first. */
  visible: ChunkRef[]
  /** A ring of chunks just outside the screen (prefetched while idle), nearest first. */
  ring: ChunkRef[]
}

export type PlanInput = {
  /** Camera centre in tile units. */
  camX: number
  camY: number
  /** CSS px per tile and screen size in CSS px. */
  zoom: number
  cssW: number
  cssH: number
  cols: number
  rows: number
  chunk: number
  /** How many chunks beyond the screen to prefetch. */
  margin: number
}

/** Cache and plan key of a chunk: one number, so lookups allocate nothing. */
export const CHUNK_KEY_STRIDE = 1 << 15
export const chunkKey = (cx: number, cy: number): number => cy * CHUNK_KEY_STRIDE + cx

export function planChunks(p: PlanInput): ChunkPlan {
  const maxCx = Math.ceil(p.cols / p.chunk) - 1
  const maxCy = Math.ceil(p.rows / p.chunk) - 1
  const halfW = p.cssW / 2 / p.zoom
  const halfH = p.cssH / 2 / p.zoom
  const chunkAt = (t: number) => Math.floor(t / p.chunk)
  const x0 = chunkAt(p.camX - halfW)
  const x1 = chunkAt(p.camX + halfW)
  const y0 = chunkAt(p.camY - halfH)
  const y1 = chunkAt(p.camY + halfH)
  const centre = (c: ChunkRef) => Math.hypot((c.cx + 0.5) * p.chunk - p.camX, (c.cy + 0.5) * p.chunk - p.camY)
  const visible: ChunkRef[] = []
  const ring: ChunkRef[] = []
  for (let cy = Math.max(0, y0 - p.margin); cy <= Math.min(maxCy, y1 + p.margin); cy++) {
    for (let cx = Math.max(0, x0 - p.margin); cx <= Math.min(maxCx, x1 + p.margin); cx++) {
      const inside = cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
      ;(inside ? visible : ring).push({ cx, cy })
    }
  }
  visible.sort((a, b) => centre(a) - centre(b))
  ring.sort((a, b) => centre(a) - centre(b))
  return { visible, ring }
}

/**
 * Least-recently-used cache with a size limit that skips protected keys (the chunks on screen).
 * `onEvict` runs for every value that leaves the cache (eviction or `clear`), so canvases can be released.
 */
export class LruCache<V, K = string> {
  private readonly map = new Map<K, V>()
  private limit: number
  private readonly onEvict: ((key: K, value: V) => void) | undefined
  constructor(limit: number, onEvict?: (key: K, value: V) => void) {
    this.limit = limit
    this.onEvict = onEvict
  }

  setLimit(limit: number): void {
    this.limit = limit
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: K, value: V, protectedKeys: ReadonlySet<K> = new Set()): void {
    const old = this.map.get(key)
    this.map.delete(key)
    if (old !== undefined && old !== value) this.onEvict?.(key, old)
    this.map.set(key, value)
    if (this.map.size <= this.limit) return
    for (const k of this.map.keys()) {
      if (this.map.size <= this.limit) break
      if (k !== key && !protectedKeys.has(k)) {
        const v = this.map.get(k)!
        this.map.delete(k)
        this.onEvict?.(k, v)
      }
    }
  }

  clear(): void {
    const all = [...this.map]
    this.map.clear()
    for (const [k, v] of all) this.onEvict?.(k, v)
  }
}

/** Cache limit: the usual cap, but never below what a screen and its prefetch ring need. */
export function chunkLimit(base: number, plan: ChunkPlan): number {
  return Math.max(base, plan.visible.length + 8)
}
