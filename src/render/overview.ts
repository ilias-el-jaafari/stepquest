import { Terrain, type TileGrid, type TileRect } from '../tiles/grid.ts'
import type { TownLookup } from '../town/lookup.ts'
import { makeCanvas, releaseCanvas } from './env.ts'
import { P } from './palette.ts'

const hex = (h: string): number[] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** One colour per terrain for the overviews. */
function terrainColours(): Record<number, number[]> {
  return {
    [Terrain.ground]: hex(P.overview.ground),
    [Terrain.park]: hex(P.overview.park),
    [Terrain.water]: hex(P.overview.water),
    [Terrain.road]: hex(P.overview.road),
    [Terrain.path]: hex(P.overview.path),
    [Terrain.crossing]: hex(P.overview.crossing),
    [Terrain.plaza]: hex(P.overview.plaza),
    [Terrain.building]: hex(P.overview.lot),
  }
}

/** Colour of one tile on the town map: a roof or landmark colour where the town has one, else the terrain. */
const landmarkRgb = new Map<string, number[]>()
function townPixel(grid: TileGrid, town: TownLookup, i: number, colours: Record<number, number[]>, roofs: number[][]): number[] {
  const t = grid.terrain[i] ?? 0
  const landmark = town.landmarkAt(i)
  if (landmark && t !== Terrain.path) {
    let rgb = landmarkRgb.get(landmark.kind)
    if (!rgb) landmarkRgb.set(landmark.kind, (rgb = hex(landmark.kind === 'parkGate' ? P.stone : P.landmarks[landmark.kind].roof[0])))
    return rgb
  }
  const house = town.houseAt(i)
  if (house) return roofs[house.roof % roofs.length]!
  return colours[t]!
}

/**
 * The far-zoom town map: one pixel per tile (also the stand-in for chunks that are not painted yet).
 * Tiles without data (a streamed world) are transparent, so the "no data" ground shows through.
 */
export function buildOverview(grid: TileGrid, town: TownLookup): HTMLCanvasElement {
  const canvas = makeCanvas(grid.cols, grid.rows)
  paintOverview(canvas, grid, town, { x: 0, y: 0, w: grid.cols, h: grid.rows })
  return canvas
}

const clampRect = (grid: TileGrid, r: TileRect, step = 1): TileRect | undefined => {
  const x0 = Math.max(0, Math.floor(r.x / step) * step)
  const y0 = Math.max(0, Math.floor(r.y / step) * step)
  const x1 = Math.min(grid.cols, r.x + r.w)
  const y1 = Math.min(grid.rows, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
}

/** Repaint a rectangle of the town map (a cell arrived or left). */
export function paintOverview(canvas: HTMLCanvasElement, grid: TileGrid, town: TownLookup, rect: TileRect): void {
  const r = clampRect(grid, rect)
  if (!r) return
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(r.w, r.h)
  const colours = terrainColours()
  const roofs = P.roofs.map((c) => hex(c[0]))
  const covered = grid.covered
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = grid.index(r.x + x, r.y + y)
      const o = (y * r.w + x) * 4
      if (covered && covered[i] !== 1) continue
      const rgb = townPixel(grid, town, i, colours, roofs)
      image.data[o] = rgb[0]!
      image.data[o + 1] = rgb[1]!
      image.data[o + 2] = rgb[2]!
      image.data[o + 3] = 255
    }
  }
  ctx.putImageData(image, r.x, r.y)
}

/** Tiles per far-overview pixel side. */
export const FAR_STEP = 2
/** Which terrain wins a far pixel (streets stay connected, water and parks show, houses do not). */
const FAR_RANK: Record<number, number> = {
  [Terrain.road]: 6,
  [Terrain.crossing]: 6,
  [Terrain.water]: 5,
  [Terrain.path]: 4,
  [Terrain.plaza]: 3,
  [Terrain.park]: 2,
  [Terrain.building]: 1,
  [Terrain.ground]: 0,
}

/**
 * The simplified far overview (requirement 19.13): one pixel per 2 × 2 tiles, from the terrain only
 * (roads, paths, water, parks, plain building lots; no houses, landmarks or lights), so it is quick to
 * build and to draw when the whole loaded world is on screen.
 */
export function paintFarOverview(canvas: HTMLCanvasElement, grid: TileGrid, rect: TileRect): void {
  const r = clampRect(grid, rect, FAR_STEP)
  if (!r) return
  const px0 = r.x / FAR_STEP
  const py0 = r.y / FAR_STEP
  const pw = Math.ceil((r.x + r.w) / FAR_STEP) - px0
  const ph = Math.ceil((r.y + r.h) / FAR_STEP) - py0
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(pw, ph)
  const colours = terrainColours()
  const covered = grid.covered
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      let best = -1
      let terrain = 0
      for (let dy = 0; dy < FAR_STEP; dy++) {
        const ty = (py0 + py) * FAR_STEP + dy
        if (ty >= grid.rows) break
        for (let dx = 0; dx < FAR_STEP; dx++) {
          const tx = (px0 + px) * FAR_STEP + dx
          if (tx >= grid.cols) break
          const i = ty * grid.cols + tx
          if (covered && covered[i] !== 1) continue
          const t = grid.terrain[i] ?? 0
          const rank = FAR_RANK[t] ?? 0
          if (rank > best) {
            best = rank
            terrain = t
          }
        }
      }
      if (best < 0) continue
      const rgb = colours[terrain]!
      const o = (py * pw + px) * 4
      image.data[o] = rgb[0]!
      image.data[o + 1] = rgb[1]!
      image.data[o + 2] = rgb[2]!
      image.data[o + 3] = 255
    }
  }
  ctx.putImageData(image, px0, py0)
}

/** A lazily built overview canvas that repaints only the rectangles that changed. */
export class OverviewCanvas {
  private canvas: HTMLCanvasElement | undefined
  private readonly grid: TileGrid
  private readonly paint: (canvas: HTMLCanvasElement, rect: TileRect) => void
  private readonly step: number
  /** Canvases built so far (tests: a cell arrival must not rebuild the whole map). */
  builds = 0

  constructor(grid: TileGrid, paint: (canvas: HTMLCanvasElement, rect: TileRect) => void, step = 1) {
    this.grid = grid
    this.paint = paint
    this.step = step
  }

  get(): HTMLCanvasElement {
    if (!this.canvas) {
      this.builds++
      this.canvas = makeCanvas(Math.ceil(this.grid.cols / this.step), Math.ceil(this.grid.rows / this.step))
      this.paint(this.canvas, { x: 0, y: 0, w: this.grid.cols, h: this.grid.rows })
    }
    return this.canvas
  }

  /** Repaint a rectangle if the canvas exists (otherwise the next `get` builds it whole). */
  update(rect: TileRect): void {
    if (this.canvas) this.paint(this.canvas, rect)
  }

  release(): void {
    if (this.canvas) releaseCanvas(this.canvas)
    this.canvas = undefined
  }
}
