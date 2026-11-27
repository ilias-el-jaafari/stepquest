import { nowMs } from '../render/env.ts'
import { Area, CLASS_MASK, hasCasing, lodColours, Street, STREET_WIDTH } from './classes.ts'
import { LOD_EXTENT, type LodGeom, type LodTile } from './tile.ts'

/** One task of the LOD pipeline on the main thread ends within about this long (requirement 25.5). */
export const LOD_SLICE_MS = 8
/** Footprints and street lines per step; a step is the unit the clock is checked on. */
const AREAS_PER_STEP = 80
const BUILDINGS_PER_STEP = 120
const LINES_PER_STEP = 150
/** A building smaller than this many device px on both sides is one pixel. */
const MIN_BLOCK_PX = 1.5

type Ctx = CanvasRenderingContext2D

/**
 * Paints one LOD tile into a square canvas of `size` device px, in steps (requirement 25.4 and 25.5): the ground, parks and water,
 * waterways, building blocks, then the streets from the smallest class to the biggest, each with its casing. `run(budgetMs)` does
 * steps until the budget is spent and says whether the bitmap is complete; call it again later for the rest. Opaque: the first step
 * fills the whole canvas with the ground colour.
 */
export class LodPainter {
  private readonly steps: Generator<void, void, void>
  private finished = false
  /** Cost of the slowest recent step, ms (decays), used to stop before the budget rather than after it. */
  private slowest = 0
  /** Steps run so far (tests). */
  stepsRun = 0

  private readonly tile: LodTile
  private readonly ctx: Ctx
  readonly size: number
  private readonly now: () => number

  constructor(tile: LodTile, ctx: Ctx, size: number, now: () => number = nowMs) {
    this.tile = tile
    this.ctx = ctx
    this.size = size
    this.now = now
    this.steps = this.generate()
  }

  get done(): boolean {
    return this.finished
  }

  /**
   * Run steps for at most `budgetMs`: after each step the clock is read, and another step starts only if the slowest recent step
   * would still end inside the budget, so a run ends within the budget rather than one step after it. At least one step runs.
   */
  run(budgetMs: number = LOD_SLICE_MS): boolean {
    if (this.finished) return true
    const start = this.now()
    const end = start + budgetMs
    let last = start
    do {
      const r = this.steps.next()
      this.stepsRun++
      if (r.done) {
        this.finished = true
        return true
      }
      const t = this.now()
      this.slowest = Math.max(t - last, this.slowest * 0.9)
      last = t
    } while (last + this.slowest < end)
    return false
  }

  private *generate(): Generator<void, void, void> {
    const { ctx, size, tile } = this
    const c = lodColours()
    const k = size / LOD_EXTENT
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = c.ground
    ctx.fillRect(0, 0, size, size)
    yield

    // Parks, then water (water over parks), one path per colour per step of polygons.
    for (const kind of [Area.green, Area.water] as const) {
      ctx.fillStyle = kind === Area.green ? c.green : c.water
      yield* this.polygons(tile.areas, (i) => tile.areas.kind[i] === kind, AREAS_PER_STEP, k)
    }
    ctx.strokeStyle = c.water
    ctx.lineWidth = Math.max(1, 2 * (size / 256))
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    yield* this.lines(tile.waterways, () => true, LINES_PER_STEP, k)

    // Building blocks: footprints as filled polygons, the tiny ones as single pixels.
    ctx.fillStyle = c.building
    yield* this.polygons(tile.areas, (i) => tile.areas.kind[i] === Area.building, BUILDINGS_PER_STEP, k, true)

    // Streets, smallest class first so a bigger street covers the smaller one at a junction.
    const scale = size / 256
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const order = Object.values(Street).sort((a, b) => a - b)
    for (const cls of order) {
      const w = STREET_WIDTH[cls] ?? 1
      const here = (i: number) => (tile.streets.kind[i]! & CLASS_MASK) === cls
      if (cls === Street.rail) {
        ctx.strokeStyle = c.rail
        ctx.lineWidth = Math.max(1, w * scale)
        ctx.setLineDash([3 * scale, 3 * scale])
        yield* this.lines(tile.streets, here, LINES_PER_STEP, k)
        ctx.setLineDash([])
        continue
      }
      if (hasCasing(cls)) {
        ctx.strokeStyle = c.casing(cls)
        ctx.lineWidth = (w + 2) * scale
        yield* this.lines(tile.streets, here, LINES_PER_STEP, k)
      }
      ctx.strokeStyle = c.street(cls)
      ctx.lineWidth = w * scale
      yield* this.lines(tile.streets, here, LINES_PER_STEP, k)
    }
  }

  /** Fill the polygons of `g` that `pick` accepts, `per` of them in one path per step. */
  private *polygons(g: LodGeom, pick: (i: number) => boolean, per: number, k: number, blocks = false): Generator<void, void, void> {
    const { ctx } = this
    let n = 0
    let open = false
    const flush = () => {
      if (open) ctx.fill()
      open = false
    }
    for (let i = 0; i < g.kind.length; i++) {
      if (!pick(i)) continue
      const from = g.start[i]! * 2
      const to = g.start[i + 1]! * 2
      if (blocks) {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (let j = from; j < to; j += 2) {
          const x = g.xy[j]! * k
          const y = g.xy[j + 1]! * k
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
        if (x1 - x0 < MIN_BLOCK_PX && y1 - y0 < MIN_BLOCK_PX) {
          ctx.fillRect(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2), 1, 1)
          continue
        }
      }
      if (!open) {
        ctx.beginPath()
        open = true
      }
      ctx.moveTo(g.xy[from]! * k, g.xy[from + 1]! * k)
      for (let j = from + 2; j < to; j += 2) ctx.lineTo(g.xy[j]! * k, g.xy[j + 1]! * k)
      ctx.closePath()
      if (++n % per === 0) {
        flush()
        yield
      }
    }
    flush()
    yield
  }

  /** Stroke the lines of `g` that `pick` accepts, `per` of them in one path per step. */
  private *lines(g: LodGeom, pick: (i: number) => boolean, per: number, k: number): Generator<void, void, void> {
    const { ctx } = this
    let n = 0
    let open = false
    for (let i = 0; i < g.kind.length; i++) {
      if (!pick(i)) continue
      const from = g.start[i]! * 2
      const to = g.start[i + 1]! * 2
      if (!open) {
        ctx.beginPath()
        open = true
      }
      ctx.moveTo(g.xy[from]! * k, g.xy[from + 1]! * k)
      for (let j = from + 2; j < to; j += 2) ctx.lineTo(g.xy[j]! * k, g.xy[j + 1]! * k)
      if (++n % per === 0) {
        ctx.stroke()
        open = false
        yield
      }
    }
    if (open) ctx.stroke()
    yield
  }
}

