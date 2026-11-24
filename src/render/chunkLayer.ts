import { Terrain, TILE_PX, type TileGrid } from '../tiles/grid.ts'
import { townFor, type TownLayout } from '../town/layout.ts'
import { TileAtlas, type AtlasSlot } from './atlas.ts'
import { chunkKey, chunkLimit, LruCache, planChunks, type ChunkPlan, type ChunkRef } from './chunkPlan.ts'
import { nowMs, prefersReducedMotion, releaseCanvas } from './env.ts'
import { buildOverview } from './overview.ts'
import { paintFrontFence, paintGardenPath, paintGardenTree, paintHouse, paintLandmark } from './structures.ts'
import { paintTile, tileHash, tileKey, type TileSpec } from './tileset.ts'
import { tileSpecAt } from './tileSpecs.ts'
import { tileEdgeX, tileEdgeY, type View } from './view.ts'
import { makeCanvas } from './env.ts'

/** Tiles per chunk side (a chunk canvas is 512 × 512 px). */
export const CHUNK = 32
export const MAX_CHUNKS = 96
/** Time spent painting new chunks in one frame; the rest waits for the next frame so panning stays smooth. */
export const CHUNK_BUDGET_MS = 6
/** Chunks beyond the screen that are painted ahead while the map is idle. */
export const PREFETCH_MARGIN = 1
/** Water ripple animation: three frames, each shown this long (ms). */
export const WATER_FRAME_MS = 450
export const WATER_FRAMES = 3
/** The water frame shown at time `now` (always 0 when the user prefers reduced motion). */
export function waterFrame(now: number, reduced: boolean): number {
  return reduced ? 0 : Math.floor(now / WATER_FRAME_MS) % WATER_FRAMES
}

/** Water tiles of one painted chunk, redrawn per frame; atlas slots are looked up once per ripple frame. */
type ChunkWater = { tiles: { tx: number; ty: number; spec: TileSpec }[]; slots: (AtlasSlot[] | undefined)[] }

export type Structures = { houses: number[]; landmarks: number[] }

export type ChunkFrame = {
  plan: ChunkPlan
  /** Keys (`chunkKey`) of the visible chunks drawn as real tiles this frame. */
  painted: ReadonlySet<number>
  /** True while stand-ins or prefetching remain: another frame is needed. */
  pending: boolean
}

/**
 * The terrain layer: paints 32 × 32 tile chunks (tiles from a lazily painted atlas, then garden
 * details, houses and landmarks), keeps them in a size-limited cache that never evicts what is on
 * screen and releases evicted canvases, draws stand-ins from the town map for chunks that do not fit
 * in the frame budget, and animates water ripples.
 */
export class ChunkLayer {
  readonly town: TownLayout
  private readonly structures = new Map<number, Structures>()
  private readonly atlas = new TileAtlas()
  private readonly water = new Map<number, ChunkWater>()
  private readonly chunks = new LruCache<HTMLCanvasElement, number>(MAX_CHUNKS, (key, canvas) => {
    releaseCanvas(canvas)
    this.water.delete(key)
  })
  private onScreen = new Set<number>()
  private painted = new Set<number>()
  private overview: HTMLCanvasElement | undefined
  private waterTimer: ReturnType<typeof setTimeout> | undefined
  private lastPlan: { camX: number; camY: number; zoom: number; cssW: number; cssH: number; plan: ChunkPlan } | undefined

  readonly grid: TileGrid
  private readonly onWaterTick: () => void

  constructor(grid: TileGrid, onWaterTick: () => void) {
    this.grid = grid
    this.onWaterTick = onWaterTick
    this.town = townFor(grid)
    this.indexStructures()
  }

  get chunkCount(): number {
    return this.chunks.size
  }

  /** Houses and landmarks (indices into the town layout) touching a chunk. */
  structuresIn(cx: number, cy: number): Structures | undefined {
    return this.structures.get(chunkKey(cx, cy))
  }

  private indexStructures(): void {
    const add = (x: number, y: number, w: number, h: number, kind: 'houses' | 'landmarks', index: number) => {
      for (let cy = Math.floor(y / CHUNK); cy <= Math.floor((y + h - 1) / CHUNK); cy++) {
        for (let cx = Math.floor(x / CHUNK); cx <= Math.floor((x + w - 1) / CHUNK); cx++) {
          const key = chunkKey(cx, cy)
          let entry = this.structures.get(key)
          if (!entry) {
            entry = { houses: [], landmarks: [] }
            this.structures.set(key, entry)
          }
          entry[kind].push(index)
        }
      }
    }
    this.town.houses.forEach((h, i) => add(h.x, h.y, h.w, h.h, 'houses', i))
    this.town.landmarks.forEach((l, i) => add(l.x, l.y, l.w, l.h, 'landmarks', i))
  }

  /** Visible and prefetch chunks for a view; reused while the camera, zoom and screen size stay the same. */
  planFor(view: View): ChunkPlan {
    const last = this.lastPlan
    if (last && last.camX === view.camX && last.camY === view.camY && last.zoom === view.zoom && last.cssW === view.cssW && last.cssH === view.cssH) return last.plan
    const plan = planChunks({
      camX: view.camX,
      camY: view.camY,
      zoom: view.zoom,
      cssW: view.cssW,
      cssH: view.cssH,
      cols: this.grid.cols,
      rows: this.grid.rows,
      chunk: CHUNK,
      margin: PREFETCH_MARGIN,
    })
    this.lastPlan = { camX: view.camX, camY: view.camY, zoom: view.zoom, cssW: view.cssW, cssH: view.cssH, plan }
    this.onScreen = new Set(plan.visible.map((c) => chunkKey(c.cx, c.cy)))
    return plan
  }

  private paintChunk(cx: number, cy: number): HTMLCanvasElement {
    const key = chunkKey(cx, cy)
    const found = this.chunks.get(key)
    if (found) return found
    const canvas = makeCanvas(CHUNK * TILE_PX, CHUNK * TILE_PX)
    const ctx = canvas.getContext('2d')!
    const water: ChunkWater = { tiles: [], slots: [] }
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gx = cx * CHUNK + tx
        const gy = cy * CHUNK + ty
        if (!this.grid.inBounds(gx, gy)) continue
        const spec = tileSpecAt(this.grid, gx, gy)
        if (spec.terrain === Terrain.water) water.tiles.push({ tx, ty, spec })
        const slot = this.atlas.slot(tileKey(spec), (actx, x, y) => paintTile(actx, x, y, spec))
        ctx.drawImage(slot.page, slot.sx, slot.sy, TILE_PX, TILE_PX, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    this.paintStructures(ctx, cx, cy)
    this.chunks.set(key, canvas, this.onScreen)
    if (water.tiles.length) this.water.set(key, water)
    return canvas
  }

  /** Garden details, houses and landmark buildings over a chunk's tiles (drawn north to south). */
  private paintStructures(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const town = this.town
    const x0 = cx * CHUNK
    const y0 = cy * CHUNK
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gx = x0 + tx
        const gy = y0 + ty
        if (!this.grid.inBounds(gx, gy)) continue
        const i = this.grid.index(gx, gy)
        if (town.gates.has(i)) paintGardenPath(ctx, tx * TILE_PX, ty * TILE_PX)
        else if (town.fences.has(i)) paintFrontFence(ctx, tx * TILE_PX, ty * TILE_PX, tileHash(gx >> 3, gy) % 3 === 0)
        if (town.trees.has(i)) paintGardenTree(ctx, tx * TILE_PX, ty * TILE_PX, tileHash(gx, gy))
      }
    }
    const entry = this.structures.get(chunkKey(cx, cy))
    if (!entry) return
    const houses = entry.houses.map((k) => town.houses[k]!).sort((a, b) => a.y - b.y)
    for (const h of houses) paintHouse(ctx, (h.x - x0) * TILE_PX, (h.y - y0) * TILE_PX, h)
    const landmarks = entry.landmarks.map((k) => town.landmarks[k]!).sort((a, b) => a.y - b.y)
    for (const l of landmarks) paintLandmark(ctx, (l.x - x0) * TILE_PX, (l.y - y0) * TILE_PX, l)
  }

  overviewCanvas(): HTMLCanvasElement {
    return (this.overview ??= buildOverview(this.grid, this.town))
  }

  /** The far-zoom town map over the loaded area. */
  drawOverview(ctx: CanvasRenderingContext2D, view: View): void {
    ctx.drawImage(this.overviewCanvas(), view.originX, view.originY, this.grid.cols * view.scale, this.grid.rows * view.scale)
  }

  /**
   * Draw the visible chunks nearest the centre first within the frame budget (at least one per
   * frame); stand-ins from the town map fill the rest. Only the part of a chunk that touches the
   * screen is drawn, aligned to whole tile edges, so neighbours share exact edges at any scale.
   */
  draw(ctx: CanvasRenderingContext2D, view: View): ChunkFrame {
    const plan = this.planFor(view)
    const limit = chunkLimit(MAX_CHUNKS, plan)
    this.chunks.setLimit(limit)
    this.painted.clear()
    const t0 = nowMs()
    let pending = false
    let built = 0
    // Tile columns and rows that touch the screen (one tile of slack each side).
    const gx0 = Math.floor(-view.originX / view.scale) - 1
    const gx1 = Math.floor((view.w - view.originX) / view.scale) + 2
    const gy0 = Math.floor(-view.originY / view.scale) - 1
    const gy1 = Math.floor((view.h - view.originY) / view.scale) + 2
    const clamp = (v: number) => Math.max(0, Math.min(CHUNK, v))
    for (const c of plan.visible) {
      const key = chunkKey(c.cx, c.cy)
      const X = c.cx * CHUNK
      const Y = c.cy * CHUNK
      const k0 = clamp(gx0 - X)
      const k1 = clamp(gx1 - X)
      const j0 = clamp(gy0 - Y)
      const j1 = clamp(gy1 - Y)
      const cached = this.chunks.has(key)
      // Always paint one chunk per frame (progress is guaranteed), more while the budget lasts.
      if (cached || built === 0 || nowMs() - t0 < CHUNK_BUDGET_MS) {
        if (!cached) built++
        const canvas = this.paintChunk(c.cx, c.cy)
        this.painted.add(key)
        if (k1 > k0 && j1 > j0) {
          const dx = tileEdgeX(view, X + k0)
          const dy = tileEdgeY(view, Y + j0)
          ctx.drawImage(canvas, k0 * TILE_PX, j0 * TILE_PX, (k1 - k0) * TILE_PX, (j1 - j0) * TILE_PX, dx, dy, tileEdgeX(view, X + k1) - dx, tileEdgeY(view, Y + j1) - dy)
        }
      } else {
        // Stand-in: the town map, scaled up, instead of a hole.
        pending = true
        const sw = Math.min(k1, this.grid.cols - X) - k0
        const sh = Math.min(j1, this.grid.rows - Y) - j0
        if (sw > 0 && sh > 0) {
          const dx = tileEdgeX(view, X + k0)
          const dy = tileEdgeY(view, Y + j0)
          ctx.drawImage(this.overviewCanvas(), X + k0, Y + j0, sw, sh, dx, dy, tileEdgeX(view, X + k0 + sw) - dx, tileEdgeY(view, Y + j0 + sh) - dy)
        }
      }
    }
    // Idle: paint the ring around the screen, one chunk per frame, so the next pan finds it ready.
    if (!pending && plan.visible.length + plan.ring.length <= limit) {
      const next = plan.ring.find((c: ChunkRef) => !this.chunks.has(chunkKey(c.cx, c.cy)))
      if (next) {
        this.paintChunk(next.cx, next.cy)
        pending = true
      }
    }
    return { plan, painted: this.painted, pending }
  }

  /**
   * Ripples: frame 0 is baked into the chunks; on the other frames the water tiles of the
   * painted visible chunks are redrawn from the atlas (3 frames, one tick per 450 ms), so the
   * only per-frame cost is the water on screen. Static with reduced motion.
   */
  drawWater(ctx: CanvasRenderingContext2D, view: View, plan: ChunkPlan): void {
    if (this.waterTimer !== undefined) clearTimeout(this.waterTimer)
    this.waterTimer = undefined
    if (prefersReducedMotion()) return
    const now = nowMs()
    const frame = waterFrame(now, false)
    let any = false
    for (const c of plan.visible) {
      const key = chunkKey(c.cx, c.cy)
      const water = this.water.get(key)
      if (!water || !this.chunks.has(key)) continue
      any = true
      if (frame === 0) continue
      const slots = (water.slots[frame] ??= water.tiles.map(({ spec }) => {
        const framed = { ...spec, frame }
        return this.atlas.slot(tileKey(framed), (actx, x, y) => paintTile(actx, x, y, framed))
      }))
      const X = c.cx * CHUNK
      const Y = c.cy * CHUNK
      for (let i = 0; i < water.tiles.length; i++) {
        const { tx, ty } = water.tiles[i]!
        const slot = slots[i]!
        const x0 = tileEdgeX(view, X + tx)
        const y0 = tileEdgeY(view, Y + ty)
        ctx.drawImage(slot.page, slot.sx, slot.sy, TILE_PX, TILE_PX, x0, y0, tileEdgeX(view, X + tx + 1) - x0, tileEdgeY(view, Y + ty + 1) - y0)
      }
    }
    if (any && typeof setTimeout !== 'undefined') {
      const wait = WATER_FRAME_MS - (now % WATER_FRAME_MS)
      this.waterTimer = setTimeout(() => {
        this.waterTimer = undefined
        this.onWaterTick()
      }, wait)
    }
  }

  /** Release every canvas the layer holds. */
  dispose(): void {
    if (this.waterTimer !== undefined) clearTimeout(this.waterTimer)
    this.waterTimer = undefined
    this.chunks.clear()
    this.water.clear()
    this.atlas.release()
    if (this.overview) releaseCanvas(this.overview)
    this.overview = undefined
  }
}
