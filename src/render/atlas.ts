import { TILE_PX } from '../tiles/grid.ts'
import { makeCanvas, releaseCanvas } from './env.ts'

/** Tiles per atlas page side (64 × 64 tiles = a 1024 px page). */
export const ATLAS_TILES = 64

export type AtlasSlot = {
  page: HTMLCanvasElement
  sx: number
  sy: number
  /** The tile's pixels (16 × 16 RGBA words, row by row), read back once; undefined where the canvas cannot be read. */
  px?: Uint32Array
}

/** Lazily painted tile atlas: each distinct (terrain, mask, variant, ...) key is drawn once. */
export class TileAtlas {
  private readonly slots = new Map<string, AtlasSlot>()
  private pages: HTMLCanvasElement[] = []
  private next = 0

  /** Tile pixels are kept in shared blocks of 256 tiles (one allocation each) instead of one buffer per tile. */
  private block: Uint32Array | undefined
  private used = 0

  private keep(words: Uint32Array | undefined): Uint32Array | undefined {
    if (!words) return undefined
    const n = TILE_PX * TILE_PX
    if (!this.block || this.used + n > this.block.length) {
      this.block = new Uint32Array(n * 256)
      this.used = 0
    }
    const view = this.block.subarray(this.used, this.used + n)
    view.set(words)
    this.used += n
    return view
  }

  get size(): number {
    return this.slots.size
  }

  slot(key: string, paint: (ctx: CanvasRenderingContext2D, x: number, y: number) => void): AtlasSlot {
    const found = this.slots.get(key)
    if (found) return found
    const perPage = ATLAS_TILES * ATLAS_TILES
    const pageIndex = Math.floor(this.next / perPage)
    if (!this.pages[pageIndex]) this.pages[pageIndex] = makeCanvas(ATLAS_TILES * TILE_PX, ATLAS_TILES * TILE_PX)
    const page = this.pages[pageIndex]!
    const local = this.next % perPage
    const sx = (local % ATLAS_TILES) * TILE_PX
    const sy = Math.floor(local / ATLAS_TILES) * TILE_PX
    this.next++
    const ctx = page.getContext('2d', { willReadFrequently: true })!
    paint(ctx, sx, sy)
    const slot: AtlasSlot = { page, sx, sy, px: this.keep(readTile(ctx, sx, sy)) }
    this.slots.set(key, slot)
    return slot
  }

  /** Free the page canvases (the atlas must not be used afterwards). */
  release(): void {
    for (const p of this.pages) releaseCanvas(p)
    this.pages = []
    this.block = undefined
    this.slots.clear()
  }
}

/** One tile's pixels as 32-bit words, so a chunk can be assembled by copying words instead of one drawImage per tile. */
function readTile(ctx: CanvasRenderingContext2D, sx: number, sy: number): Uint32Array | undefined {
  const data = typeof ctx.getImageData === 'function' ? (ctx.getImageData(sx, sy, TILE_PX, TILE_PX) as ImageData | undefined) : undefined
  if (!data || !data.data || data.data.length !== TILE_PX * TILE_PX * 4) return undefined
  return new Uint32Array(data.data.buffer, data.data.byteOffset, TILE_PX * TILE_PX)
}
