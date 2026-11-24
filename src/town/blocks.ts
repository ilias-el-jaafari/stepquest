import { Terrain, type TileGrid } from '../tiles/grid.ts'
import { hash2 } from './random.ts'
import { LOT, type Rect } from './types.ts'

/**
 * Block analysis: finds the connected runs of building tiles (blocks) and the
 * pure geometry helpers used to cut them into lots. Nothing here knows about
 * houses or landmarks, and nothing reads randomness except through the `random`
 * function it is given.
 */

/** One connected run of building tiles that no landmark has taken. */
export type Block = {
  /** Tile indices; `tiles[0]` is the first tile in scan order (row-major), the rest follow in flood order. */
  tiles: number[]
  /** Bounding rectangle of the tiles (a concave block does not fill it). */
  bounds: Rect
  /** Seed for the block's random draws: depends only on where the block is. */
  seed: number
}

/** Connected components (4-neighbour) of tiles matching `inside`, in scan order. */
export function components(grid: TileGrid, inside: (i: number) => boolean): number[][] {
  const { cols, rows } = grid
  const seen = new Uint8Array(cols * rows)
  const out: number[][] = []
  const stack: number[] = []
  const push = (k: number) => {
    seen[k] = 1
    stack.push(k)
  }
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !inside(i)) continue
    const comp: number[] = []
    seen[i] = 1
    stack.push(i)
    while (stack.length) {
      const j = stack.pop()!
      comp.push(j)
      const x = j % cols
      const y = (j - x) / cols
      if (x > 0 && !seen[j - 1] && inside(j - 1)) push(j - 1)
      if (x < cols - 1 && !seen[j + 1] && inside(j + 1)) push(j + 1)
      if (y > 0 && !seen[j - cols] && inside(j - cols)) push(j - cols)
      if (y < rows - 1 && !seen[j + cols] && inside(j + cols)) push(j + cols)
    }
    out.push(comp)
  }
  return out
}

/**
 * Blocks of building tiles outside `reserved`, plus `owner`: tile → block
 * number + 1 (0 = not in any block), so membership is one array read.
 */
export function analyseBlocks(grid: TileGrid, reserved: Uint8Array): { blocks: Block[]; owner: Int32Array } {
  const owner = new Int32Array(grid.cols * grid.rows)
  const blocks: Block[] = []
  for (const tiles of components(grid, (i) => grid.terrain[i] === Terrain.building && !reserved[i])) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const id = blocks.length + 1
    for (const i of tiles) {
      owner[i] = id
      const x = i % grid.cols
      const y = (i - x) / grid.cols
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    blocks.push({ tiles, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, seed: hash2(minX, minY) ^ (tiles[0] ?? 0) })
  }
  return { blocks, owner }
}

/**
 * Binary space partition: cut a rectangle into lots no bigger than max and
 * (where possible) no smaller than min, alternating on the longer side.
 */
export function subdivide(rect: Rect, random: () => number, opts: { minW: number; maxW: number; minH: number; maxH: number } = LOT): Rect[] {
  const out: Rect[] = []
  const stack: Rect[] = [rect]
  while (stack.length) {
    const r = stack.pop()!
    const splitW = r.w > opts.maxW && r.w >= opts.minW * 2
    const splitH = r.h > opts.maxH && r.h >= opts.minH * 2
    if (!splitW && !splitH) {
      out.push(r)
      continue
    }
    const vertical = splitW && (!splitH || r.w / opts.maxW >= r.h / opts.maxH)
    if (vertical) {
      const cut = opts.minW + Math.floor(random() * (r.w - opts.minW * 2 + 1))
      stack.push({ x: r.x, y: r.y, w: cut, h: r.h }, { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h })
    } else {
      const cut = opts.minH + Math.floor(random() * (r.h - opts.minH * 2 + 1))
      stack.push({ x: r.x, y: r.y, w: r.w, h: cut }, { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut })
    }
  }
  return out
}

/** Largest axis-aligned rectangle of true cells in a w × h mask (row-major). */
export function largestRect(mask: ArrayLike<boolean | number>, w: number, h: number): Rect | undefined {
  const heights = new Array<number>(w).fill(0)
  let best: Rect | undefined
  let bestArea = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) heights[x] = mask[y * w + x] ? (heights[x] ?? 0) + 1 : 0
    // Histogram stack algorithm.
    const stack: number[] = []
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? (heights[x] ?? 0) : 0
      while (stack.length && (heights[stack[stack.length - 1]!] ?? 0) >= cur) {
        const top = stack.pop()!
        const height = heights[top] ?? 0
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0
        const width = x - left
        const area = width * height
        // Prefer wider rectangles on ties (houses read better wide).
        if (height > 0 && (area > bestArea || (area === bestArea && best && width > best.w))) {
          bestArea = area
          best = { x: left, y: y - height + 1, w: width, h: height }
        }
      }
      stack.push(x)
    }
  }
  return best
}
