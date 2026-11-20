import { Dir4, Dir8 } from '../tiles/autotile.ts'
import { Terrain, type TerrainId } from '../tiles/grid.ts'
import { P } from './palette.ts'

/** Everything the painter needs to draw one tile. */
export type TileSpec = {
  terrain: TerrainId
  /** 4-bit cardinal mask (paths, crossings). */
  m4: number
  /** Reduced 8-bit blob mask (areas). */
  m8: number
  /** Small decoration variant, 0–7. */
  variant: number
  /** Roof colour index for buildings. */
  roof: number
  /** Zebra bars run north–south (the road runs east–west). */
  vertical: boolean
}

export function tileKey(s: TileSpec): string {
  return `${s.terrain}:${s.m4}:${s.m8}:${s.variant}:${s.roof}:${s.vertical ? 1 : 0}`
}

type Ctx = CanvasRenderingContext2D

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

function dots(ctx: Ctx, ox: number, oy: number, pts: readonly (readonly [number, number])[], color: string) {
  ctx.fillStyle = color
  for (const [x, y] of pts) ctx.fillRect(ox + x, oy + y, 1, 1)
}

const GROUND_DOTS: readonly (readonly (readonly [number, number])[])[] = [
  [[3, 4], [11, 12]],
  [[7, 2], [13, 9], [2, 13]],
  [[5, 10], [12, 3]],
  [],
  [[9, 6]],
  [[1, 7], [14, 14]],
  [[6, 13], [10, 1]],
  [],
]

function paintGround(ctx: Ctx, ox: number, oy: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.groundA)
  dots(ctx, ox, oy, GROUND_DOTS[variant % 8] ?? [], P.groundDot)
  if (variant === 3) {
    // A tiny two-pixel flower now and then.
    dots(ctx, ox, oy, [[8, 8]], P.flowerR)
    dots(ctx, ox, oy, [[8, 9]], P.grassTuft)
  }
}

/** Draw bands on the sides a blob mask says are open (no same-terrain neighbour). */
function edgeBands(
  ctx: Ctx,
  ox: number,
  oy: number,
  m8: number,
  width: number,
  outer: string,
  inner?: string,
) {
  const n = !(m8 & Dir8.N)
  const e = !(m8 & Dir8.E)
  const s = !(m8 & Dir8.S)
  const w = !(m8 & Dir8.W)
  if (n) rect(ctx, ox, oy, 16, width, outer)
  if (s) rect(ctx, ox, oy + 16 - width, 16, width, outer)
  if (w) rect(ctx, ox, oy, width, 16, outer)
  if (e) rect(ctx, ox + 16 - width, oy, width, 16, outer)
  if (inner) {
    if (n) rect(ctx, ox + (w ? width : 0), oy + width, 16 - (w ? width : 0) - (e ? width : 0), 1, inner)
    if (s) rect(ctx, ox + (w ? width : 0), oy + 15 - width, 16 - (w ? width : 0) - (e ? width : 0), 1, inner)
    if (w) rect(ctx, ox + width, oy + (n ? width : 0), 1, 16 - (n ? width : 0) - (s ? width : 0), inner)
    if (e) rect(ctx, ox + 15 - width, oy + (n ? width : 0), 1, 16 - (n ? width : 0) - (s ? width : 0), inner)
  }
  // Inner corners: both cardinals connect but the diagonal does not.
  const corner = (bit: number, a: number, b: number, cx: number, cy: number) => {
    if (m8 & a && m8 & b && !(m8 & bit)) rect(ctx, ox + cx, oy + cy, width, width, outer)
  }
  corner(Dir8.NE, Dir8.N, Dir8.E, 16 - width, 0)
  corner(Dir8.SE, Dir8.S, Dir8.E, 16 - width, 16 - width)
  corner(Dir8.SW, Dir8.S, Dir8.W, 0, 16 - width)
  corner(Dir8.NW, Dir8.N, Dir8.W, 0, 0)
}

function paintTree(ctx: Ctx, ox: number, oy: number) {
  const crown = [
    '....dddddd....',
    '..ddmmmmmmdd..',
    '.dmmmllmmmmmd.',
    '.dmmllllmmmmd.',
    'dmmmllmmmmmmmd',
    'dmmmmmmmmmmmmd',
    'dmmmmmmmmmmmmd',
    '.dmmmmmmmmmmd.',
    '.ddmmmmmmmmdd.',
    '..dddmmmmddd..',
    '....dddddd....',
  ]
  const colors: Record<string, string> = { d: P.treeDark, m: P.treeMid, l: P.treeLight }
  crown.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x] ?? '.']
      if (c) rect(ctx, ox + 1 + x, oy + y, 1, 1, c)
    }
  })
  rect(ctx, ox + 6, oy + 11, 4, 3, P.trunk)
  rect(ctx, ox + 5, oy + 14, 6, 1, P.treeDark)
}

function paintPark(ctx: Ctx, ox: number, oy: number, m8: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.grassA)
  // Checker of lighter blades gives the classic "tall grass" texture.
  ctx.fillStyle = P.grassB
  for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 === 0 ? 0 : 2; x < 16; x += 4) ctx.fillRect(ox + x, oy + y + 2, 2, 1)
  const tufts: readonly (readonly [number, number])[] = variant % 2 ? [[3, 5], [11, 11]] : [[10, 3], [4, 12]]
  for (const [x, y] of tufts) {
    rect(ctx, ox + x, oy + y, 1, 2, P.grassTuft)
    rect(ctx, ox + x + 2, oy + y, 1, 2, P.grassTuft)
    rect(ctx, ox + x + 1, oy + y + 1, 1, 1, P.grassTuft)
  }
  if (variant === 5) {
    dots(ctx, ox, oy, [[7, 7], [12, 4]], P.flowerY)
    dots(ctx, ox, oy, [[2, 10]], P.flowerR)
  }
  if (m8 === 255 && variant <= 1) paintTree(ctx, ox, oy)
  edgeBands(ctx, ox, oy, m8, 2, P.hedge, P.treeDark)
}

function paintWater(ctx: Ctx, ox: number, oy: number, m8: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.waterA)
  ctx.fillStyle = P.waterB
  for (let y = 1; y < 16; y += 4) ctx.fillRect(ox, oy + y, 16, 1)
  const waves: readonly (readonly [number, number])[] = variant % 2 ? [[2, 3], [9, 10]] : [[8, 5], [3, 12]]
  for (const [x, y] of waves) {
    rect(ctx, ox + x, oy + y, 3, 1, P.waterHi)
    rect(ctx, ox + x + 1, oy + y - 1, 1, 1, P.waterHi)
  }
  edgeBands(ctx, ox, oy, m8, 3, P.sand, P.sandDark)
}

function paintBuilding(ctx: Ctx, ox: number, oy: number, m8: number, variant: number, roofIndex: number) {
  const roof = P.roofs[roofIndex % P.roofs.length]!
  const [base, dark, light] = roof
  rect(ctx, ox, oy, 16, 16, base)
  // Shingle rows, offset every other row.
  ctx.fillStyle = dark
  for (let y = 3; y < 16; y += 4) {
    ctx.fillRect(ox, oy + y, 16, 1)
    for (let x = (y % 8 === 3 ? 2 : 6); x < 16; x += 8) ctx.fillRect(ox + x, oy + y - 3, 1, 3)
  }
  const openN = !(m8 & Dir8.N)
  const openE = !(m8 & Dir8.E)
  const openS = !(m8 & Dir8.S)
  const openW = !(m8 & Dir8.W)
  if (openN) {
    rect(ctx, ox, oy, 16, 1, P.ink)
    rect(ctx, ox, oy + 1, 16, 1, light)
  }
  if (openW) rect(ctx, ox, oy, 1, 16, P.ink)
  if (openE) {
    rect(ctx, ox + 15, oy, 1, 16, P.ink)
    rect(ctx, ox + 14, oy, 1, 16, dark)
  }
  if (openS) {
    // Front wall: a GBA-style 3/4 view shows the facade under the roof.
    rect(ctx, ox, oy + 7, 16, 1, dark)
    rect(ctx, ox, oy + 8, 16, 1, P.ink)
    rect(ctx, ox, oy + 9, 16, 6, P.wall)
    rect(ctx, ox, oy + 14, 16, 1, P.wallShade)
    rect(ctx, ox, oy + 15, 16, 1, P.ink)
    if (variant % 4 === 0) {
      rect(ctx, ox + 6, oy + 10, 4, 5, P.door)
      rect(ctx, ox + 6, oy + 10, 4, 1, P.ink)
      rect(ctx, ox + 8, oy + 12, 1, 1, P.flowerY)
    } else {
      for (const wx of [3, 10]) {
        rect(ctx, ox + wx - 1, oy + 10, 5, 4, P.ink)
        rect(ctx, ox + wx, oy + 11, 3, 2, P.window)
        rect(ctx, ox + wx, oy + 11, 1, 1, P.windowHi)
      }
    }
    if (openW) rect(ctx, ox, oy + 7, 1, 9, P.ink)
    if (openE) rect(ctx, ox + 15, oy + 7, 1, 9, P.ink)
  }
  const corner = (bit: number, a: number, b: number, cx: number, cy: number) => {
    if (m8 & a && m8 & b && !(m8 & bit)) rect(ctx, ox + cx, oy + cy, 1, 1, P.ink)
  }
  corner(Dir8.NE, Dir8.N, Dir8.E, 15, 0)
  corner(Dir8.NW, Dir8.N, Dir8.W, 0, 0)
}

function paintRoad(ctx: Ctx, ox: number, oy: number, m8: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.asphaltA)
  ctx.fillStyle = P.asphaltB
  for (let y = 0; y < 16; y += 2) for (let x = y % 4 === 0 ? 0 : 1; x < 16; x += 2) ctx.fillRect(ox + x, oy + y, 1, 1)
  dots(ctx, ox, oy, GROUND_DOTS[(variant + 2) % 8] ?? [], P.asphaltDot)
  edgeBands(ctx, ox, oy, m8, 2, P.curb, P.curbShadow)
}

/** 16×16 coverage mask for a path body plus its connectors. */
export function pathCoverage(m4: number): boolean[] {
  const cov = new Array<boolean>(256).fill(false)
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cov[y * 16 + x] = true
  }
  fill(3, 3, 12, 12)
  if (m4 & Dir4.N) fill(3, 0, 12, 2)
  if (m4 & Dir4.S) fill(3, 13, 12, 15)
  if (m4 & Dir4.W) fill(0, 3, 2, 12)
  if (m4 & Dir4.E) fill(13, 3, 15, 12)
  return cov
}

function paintPath(ctx: Ctx, ox: number, oy: number, m4: number, variant: number) {
  paintGround(ctx, ox, oy, (variant + 3) % 8)
  const cov = pathCoverage(m4)
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!cov[y * 16 + x]) continue
      // Outline where the path meets grass inside the tile (not at tile edges, which continue).
      const open = (dx: number, dy: number) => {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx > 15 || ny > 15) return false
        return !cov[ny * 16 + nx]
      }
      const edge = open(1, 0) || open(-1, 0) || open(0, 1) || open(0, -1)
      rect(ctx, ox + x, oy + y, 1, 1, edge ? P.pathEdge : (x * 7 + y * 3 + variant) % 11 === 0 ? P.pathB : P.pathA)
    }
  }
}

function paintCrossing(ctx: Ctx, ox: number, oy: number, vertical: boolean) {
  rect(ctx, ox, oy, 16, 16, P.asphaltA)
  ctx.fillStyle = P.white
  for (let i = 1; i < 16; i += 5) {
    if (vertical) ctx.fillRect(ox + i, oy + 1, 3, 14)
    else ctx.fillRect(ox + 1, oy + i, 14, 3)
  }
}

/** Paint one 16×16 tile at (ox, oy). Pure canvas calls, so it also runs on OffscreenCanvas. */
export function paintTile(ctx: Ctx, ox: number, oy: number, spec: TileSpec): void {
  switch (spec.terrain) {
    case Terrain.park:
      paintPark(ctx, ox, oy, spec.m8, spec.variant)
      break
    case Terrain.water:
      paintWater(ctx, ox, oy, spec.m8, spec.variant)
      break
    case Terrain.building:
      paintBuilding(ctx, ox, oy, spec.m8, spec.variant, spec.roof)
      break
    case Terrain.road:
      paintRoad(ctx, ox, oy, spec.m8, spec.variant)
      break
    case Terrain.path:
      paintPath(ctx, ox, oy, spec.m4, spec.variant)
      break
    case Terrain.crossing:
      paintCrossing(ctx, ox, oy, spec.vertical)
      break
    default:
      paintGround(ctx, ox, oy, spec.variant)
  }
}

/** Stable per-tile hash for decoration variety. */
export function tileHash(tx: number, ty: number): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
