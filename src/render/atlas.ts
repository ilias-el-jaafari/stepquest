import { TILE_PX } from '../tiles/grid.ts'
import { makeCanvas, releaseCanvas } from './env.ts'

/** Tiles per atlas page side (64 × 64 tiles = a 1024 px page). */
export const ATLAS_TILES = 64

export type AtlasSlot = { page: HTMLCanvasElement; sx: number; sy: number }

/** Lazily painted tile atlas: each distinct (terrain, mask, variant, ...) key is drawn once. */
export class TileAtlas {
  private readonly slots = new Map<string, AtlasSlot>()
  private pages: HTMLCanvasElement[] = []
  private next = 0

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
    paint(page.getContext('2d')!, sx, sy)
    const slot = { page, sx, sy }
    this.slots.set(key, slot)
    return slot
  }

  /** Free the page canvases (the atlas must not be used afterwards). */
  release(): void {
    for (const p of this.pages) releaseCanvas(p)
    this.pages = []
    this.slots.clear()
  }
}
