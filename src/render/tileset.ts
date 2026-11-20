import { Dir4, Dir8 } from '../tiles/autotile.ts'
import { Corner } from '../tiles/diagonal.ts'
import { PARK_STYLES, Terrain, type TerrainId } from '../tiles/grid.ts'
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
  /** Zebra bars run north–south (the road runs east–west). */
  vertical: boolean
  /** Park style index (PARK_STYLES) for park tiles. */
  style?: number
  /** Barrier through the tile: 1 fence, 2 hedge, 3 wall (0 none). */
  barrier?: number
  /** 4-bit mask of neighbouring tiles with the same barrier. */
  bm4?: number
  /** Asphalt triangles that smooth diagonal streets: NE 1, SE 2, SW 4, NW 8. */
  diag?: number
}


export function tileKey(s: TileSpec): string {
  return `${s.terrain}:${s.m4}:${s.m8}:${s.variant}:${s.vertical ? 1 : 0}:${s.style ?? 0}:${s.barrier ?? 0}:${s.bm4 ?? 0}:${s.diag ?? 0}`
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

function paintPark(ctx: Ctx, ox: number, oy: number, m8: number, variant: number, style: number) {
  const name = PARK_STYLES[style] ?? 'park'
  switch (name) {
    case 'grass':
      return paintTallGrass(ctx, ox, oy, variant)
    case 'pitch':
      return paintPitch(ctx, ox, oy, m8)
    case 'playground':
      return paintPlayground(ctx, ox, oy, m8, variant)
    case 'wood':
      rect(ctx, ox, oy, 16, 16, P.grassB)
      paintTree(ctx, ox, oy)
      if (variant % 3 === 0) dots(ctx, ox, oy, [[1, 2], [14, 3]], P.treeDark)
      return
    case 'farmland':
      return paintFarmland(ctx, ox, oy, variant)
    case 'orchard':
      rect(ctx, ox, oy, 16, 16, P.grassA)
      ctx.fillStyle = P.grassB
      for (let y = 2; y < 16; y += 5) ctx.fillRect(ox, oy + y, 16, 1)
      paintSmallTree(ctx, ox + 3, oy + 2)
      return
    case 'cemetery':
      rect(ctx, ox, oy, 16, 16, P.grassB)
      for (const [x, y] of [[3, 3], [10, 3], [3, 10], [10, 10]] as const) {
        rect(ctx, ox + x, oy + y, 4, 5, P.ink)
        rect(ctx, ox + x + 1, oy + y + 1, 2, 3, P.stone)
      }
      edgeBands(ctx, ox, oy, m8, 2, P.stoneDark, P.stone)
      return
    case 'garden':
      rect(ctx, ox, oy, 16, 16, P.lawnA)
      ctx.fillStyle = P.lawnB
      for (let y = 0; y < 16; y += 4) ctx.fillRect(ox, oy + y, 16, 2)
      // Flower beds.
      if (variant % 2 === 0) {
        rect(ctx, ox + 3, oy + 4, 10, 7, P.soil)
        for (const [x, y, c] of [[4, 5, P.flowerR], [7, 5, P.flowerY], [10, 5, P.white], [5, 8, P.flowerY], [8, 8, P.flowerR], [11, 8, P.flowerR]] as const) {
          rect(ctx, ox + x, oy + y, 2, 2, c)
          rect(ctx, ox + x, oy + y + 2, 1, 1, P.grassTuft)
        }
      } else if (variant === 3) paintSmallTree(ctx, ox + 3, oy + 2)
      edgeBands(ctx, ox, oy, m8, 2, P.hedge, P.treeDark)
      return
    default: {
      rect(ctx, ox, oy, 16, 16, P.grassA)
      ctx.fillStyle = P.grassB
      for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 === 0 ? 0 : 2; x < 16; x += 4) ctx.fillRect(ox + x, oy + y + 2, 2, 1)
      if (variant === 5 || variant === 6) {
        dots(ctx, ox, oy, [[7, 7], [12, 4], [4, 12]], P.flowerY)
        dots(ctx, ox, oy, [[2, 10], [11, 11]], P.flowerR)
        dots(ctx, ox, oy, [[9, 2]], P.white)
      }
      if (m8 === 255 && variant <= 1) paintTree(ctx, ox, oy)
      edgeBands(ctx, ox, oy, m8, 2, P.hedge, P.treeDark)
    }
  }
}

/** Classic "tall grass" patch: dense blades with highlights. */
function paintTallGrass(ctx: Ctx, ox: number, oy: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.grassA)
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = ox + col * 4 + (row % 2 ? 2 : 0)
      const y = oy + row * 4
      rect(ctx, x, y + 1, 1, 3, P.tallGrass)
      rect(ctx, x + 2, y + 1, 1, 3, P.tallGrass)
      rect(ctx, x + 1, y, 1, 3, P.tallGrass)
      rect(ctx, x + 1, y, 1, 1, P.tallGrassHi)
    }
  }
  if (variant === 2) dots(ctx, ox, oy, [[6, 6]], P.flowerY)
}

function paintPitch(ctx: Ctx, ox: number, oy: number, m8: number) {
  rect(ctx, ox, oy, 16, 16, P.pitch)
  rect(ctx, ox, oy, 8, 16, P.pitchStripe)
  // White touchline on the open edges.
  const n = !(m8 & Dir8.N)
  const e = !(m8 & Dir8.E)
  const s = !(m8 & Dir8.S)
  const w = !(m8 & Dir8.W)
  if (n) rect(ctx, ox, oy + 1, 16, 1, P.pitchLine)
  if (s) rect(ctx, ox, oy + 14, 16, 1, P.pitchLine)
  if (w) rect(ctx, ox + 1, oy, 1, 16, P.pitchLine)
  if (e) rect(ctx, ox + 14, oy, 1, 16, P.pitchLine)
}

function paintPlayground(ctx: Ctx, ox: number, oy: number, m8: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.sand)
  dots(ctx, ox, oy, [[3, 4], [11, 9], [6, 13], [13, 2]], P.sandDark)
  if (variant === 1) {
    // A little slide.
    rect(ctx, ox + 3, oy + 3, 2, 10, P.ink)
    rect(ctx, ox + 5, oy + 4, 7, 2, P.flowerR)
    rect(ctx, ox + 11, oy + 6, 2, 7, P.flowerR)
  } else if (variant === 4) {
    // A swing frame.
    rect(ctx, ox + 2, oy + 3, 12, 1, P.ink)
    rect(ctx, ox + 2, oy + 3, 1, 10, P.ink)
    rect(ctx, ox + 13, oy + 3, 1, 10, P.ink)
    rect(ctx, ox + 6, oy + 4, 1, 6, P.curbShadow)
    rect(ctx, ox + 5, oy + 10, 3, 1, P.flowerY)
  }
  edgeBands(ctx, ox, oy, m8, 1, P.trunk)
}

function paintFarmland(ctx: Ctx, ox: number, oy: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.soil)
  for (let y = 1; y < 16; y += 4) {
    rect(ctx, ox, oy + y, 16, 1, P.soilDark)
    for (let x = (variant + y) % 3; x < 16; x += 3) rect(ctx, ox + x, oy + y + 1, 2, 2, P.crop)
  }
}

/** A small round bush-tree (10×12) for orchards and gardens. */
function paintSmallTree(ctx: Ctx, x: number, y: number) {
  rect(ctx, x + 2, y, 6, 1, P.treeDark)
  rect(ctx, x + 1, y + 1, 8, 6, P.treeMid)
  rect(ctx, x, y + 2, 10, 4, P.treeMid)
  rect(ctx, x + 2, y + 2, 3, 2, P.treeLight)
  rect(ctx, x, y + 6, 10, 1, P.treeDark)
  rect(ctx, x + 2, y + 7, 6, 1, P.treeDark)
  rect(ctx, x + 4, y + 8, 2, 3, P.trunk)
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
  // Foam where the water meets the shore.
  ctx.fillStyle = P.waterHi
  if (!(m8 & Dir8.N)) for (let x = (variant % 3) + 1; x < 15; x += 3) ctx.fillRect(ox + x, oy + 4, 2, 1)
  if (!(m8 & Dir8.S)) for (let x = (variant % 3) + 1; x < 15; x += 3) ctx.fillRect(ox + x, oy + 11, 2, 1)
  if (!(m8 & Dir8.W)) for (let y = (variant % 3) + 1; y < 15; y += 3) ctx.fillRect(ox + 4, oy + y, 1, 2)
  if (!(m8 & Dir8.E)) for (let y = (variant % 3) + 1; y < 15; y += 3) ctx.fillRect(ox + 11, oy + y, 1, 2)
}

/** Lot ground under houses: a mown lawn; houses and garden details are drawn on top. */
function paintLot(ctx: Ctx, ox: number, oy: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.lawnA)
  ctx.fillStyle = P.lawnB
  for (let y = 0; y < 16; y += 4) ctx.fillRect(ox, oy + y + 1, 16, 1)
  dots(ctx, ox, oy, GROUND_DOTS[variant % 8] ?? [], P.lawnDot)
  if (variant === 6) {
    dots(ctx, ox, oy, [[4, 6], [11, 10]], P.flowerR)
    dots(ctx, ox, oy, [[8, 3]], P.flowerY)
  }
}

/** Paved square: big stone slabs with a border where it meets other ground. */
function paintPlaza(ctx: Ctx, ox: number, oy: number, m8: number, variant: number) {
  rect(ctx, ox, oy, 16, 16, P.plazaA)
  ctx.fillStyle = P.plazaLine
  ctx.fillRect(ox, oy + 7, 16, 1)
  ctx.fillRect(ox, oy + 15, 16, 1)
  ctx.fillRect(ox + (variant % 2 ? 3 : 11), oy, 1, 7)
  ctx.fillRect(ox + (variant % 2 ? 11 : 3), oy + 8, 1, 7)
  dots(ctx, ox, oy, [[5, 3], [13, 11]], P.plazaB)
  edgeBands(ctx, ox, oy, m8, 2, P.stoneDark, P.stone)
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
  // Corners (exactly two adjacent sides) bend as a quarter ring around the
  // shared tile corner, so staircase footpaths read as smooth diagonals.
  const corner: Record<number, [number, number]> = {
    [Dir4.N | Dir4.E]: [16, 0],
    [Dir4.E | Dir4.S]: [16, 16],
    [Dir4.S | Dir4.W]: [0, 16],
    [Dir4.W | Dir4.N]: [0, 0],
  }
  const pivot = corner[m4]
  if (pivot) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x + 0.5 - pivot[0], y + 0.5 - pivot[1])
        if (d >= 3 && d <= 13) cov[y * 16 + x] = true
      }
    }
    return cov
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
      paintPark(ctx, ox, oy, spec.m8, spec.variant, spec.style ?? 0)
      break
    case Terrain.water:
      paintWater(ctx, ox, oy, spec.m8, spec.variant)
      break
    case Terrain.building:
      paintLot(ctx, ox, oy, spec.variant)
      break
    case Terrain.plaza:
      paintPlaza(ctx, ox, oy, spec.m8, spec.variant)
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
  if (spec.barrier) paintBarrier(ctx, ox, oy, spec.barrier, spec.bm4 ?? 0)
  if (spec.diag) paintDiagonals(ctx, ox, oy, spec.diag)
}

/** Fence, hedge or wall running through the tile towards connected neighbours. */
function paintBarrier(ctx: Ctx, ox: number, oy: number, kind: number, m4: number) {
  const arms: [number, number, number, number][] = []
  const t = kind === 2 ? 4 : 2 // thickness
  const c = 8 - Math.floor(t / 2)
  arms.push([c, c, t, t])
  if (m4 & Dir4.N) arms.push([c, 0, t, c + t])
  if (m4 & Dir4.S) arms.push([c, c, t, 16 - c])
  if (m4 & Dir4.W) arms.push([0, c, c + t, t])
  if (m4 & Dir4.E) arms.push([c, c, 16 - c, t])
  const [body, edge] = kind === 2 ? [P.hedge, P.treeDark] : kind === 3 ? [P.stone, P.stoneDark] : [P.fence, P.fenceShade]
  for (const [x, y, w, h] of arms) {
    rect(ctx, ox + x, oy + y + 1, w, h, edge)
    rect(ctx, ox + x, oy + y, w, h, body)
  }
  if (kind === 1) {
    // Fence posts.
    ctx.fillStyle = P.fenceShade
    if (m4 & (Dir4.E | Dir4.W)) for (let x = 1; x < 16; x += 5) ctx.fillRect(ox + x, oy + c - 2, 1, 5)
    if (m4 & (Dir4.N | Dir4.S)) for (let y = 1; y < 16; y += 5) ctx.fillRect(ox + c - 2, oy + y, 5, 1)
  }
}

/**
 * Asphalt triangles in the corners where a street steps diagonally, with a
 * kerb along the cut, so stair-stepped roads read as smooth diagonals.
 */
function paintDiagonals(ctx: Ctx, ox: number, oy: number, diag: number) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Distance from the cutting diagonal, positive inside the corner.
      let inside = -99
      if (diag & Corner.SW) inside = Math.max(inside, y - x)
      if (diag & Corner.NE) inside = Math.max(inside, x - y)
      if (diag & Corner.NW) inside = Math.max(inside, 15 - x - y)
      if (diag & Corner.SE) inside = Math.max(inside, x + y - 15)
      if (inside < 0) continue
      const asphalt = (x + y) % 4 === 0 ? P.asphaltB : P.asphaltA
      rect(ctx, ox + x, oy + y, 1, 1, inside <= 1 ? P.curb : inside === 2 ? P.curbShadow : asphalt)
    }
  }
}

/** Stable per-tile hash for decoration variety. */
export function tileHash(tx: number, ty: number): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
