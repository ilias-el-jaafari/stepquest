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

/** Least-recently-used cache with a size limit that skips protected keys (the chunks on screen). */
export class LruCache<V> {
  private readonly map = new Map<string, V>()
  private limit: number
  constructor(limit: number) {
    this.limit = limit
  }

  setLimit(limit: number): void {
    this.limit = limit
  }

  get size(): number {
    return this.map.size
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get(key: string): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: string, value: V, protectedKeys: ReadonlySet<string> = new Set()): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size <= this.limit) return
    for (const k of this.map.keys()) {
      if (this.map.size <= this.limit) break
      if (k !== key && !protectedKeys.has(k)) this.map.delete(k)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** Cache limit: the usual cap, but never below what a screen and its prefetch ring need. */
export function chunkLimit(base: number, plan: ChunkPlan): number {
  return Math.max(base, plan.visible.length + 8)
}
