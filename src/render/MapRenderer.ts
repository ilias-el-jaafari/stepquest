import type { LatLon } from '../geo/geo.ts'
import type { Route } from '../routing/planner.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import { Terrain, TILE_PX, type TileGrid } from '../tiles/grid.ts'
import { line4 } from '../tiles/rasterize.ts'
import { P } from './palette.ts'
import { CHECKPOINT, FINISH_FLAG, paintSprite, PLAYER_DOWN, START_MAT, type Sprite } from './sprites.ts'
import { paintTile, tileKey } from './tileset.ts'
import { roofColours, tileSpecAt } from './tileSpecs.ts'

/** Screen pixels per tile. ≥ DETAIL_ZOOM draws real 16×16 tiles; below it, a 1-px-per-tile town map. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 16, 24, 32, 48] as const
export const DETAIL_ZOOM = 8
const CHUNK = 32
const MAX_CHUNKS = 96
const ATLAS_TILES = 64

export type Markers = { start?: LatLon; end?: LatLon }

/** The parts of a route the renderer draws (planner routes and saved quests both fit). */
export type RouteShape = Pick<Route, 'points' | 'checkpoints'>

/** Live quest overlay: where the walker is and how far they got. */
export type QuestOverlay = {
  player: LatLon | undefined
  accuracyM: number | undefined
  collected: number
  alongM: number
}

const PICKUP_MS = 900

type AtlasSlot = { page: HTMLCanvasElement; sx: number; sy: number }

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Lazily painted tile atlas: each distinct (terrain, mask, variant) is drawn once. */
class TileAtlas {
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
    const ctx = page.getContext('2d')!
    paint(ctx, sx, sy)
    const slot = { page, sx, sy }
    this.slots.set(key, slot)
    return slot
  }
}

export class MapRenderer {
  readonly grid: TileGrid
  private readonly canvas: HTMLCanvasElement
  private readonly roofs: Uint8Array
  private readonly atlas = new TileAtlas()
  private readonly chunks = new Map<string, HTMLCanvasElement>()
  private overview: HTMLCanvasElement | undefined
  private readonly spriteCache = new Map<Sprite, HTMLCanvasElement>()
  private route: RouteShape | undefined
  private routeCells: { x: number; y: number; along: number }[] = []
  private markers: Markers = {}
  private quest: QuestOverlay | undefined
  private pickups: { point: LatLon; t0: number }[] = []
  private frame = 0
  /** Camera centre in tile units and zoom in CSS px per tile. */
  camX: number
  camY: number
  zoom: number

  constructor(canvas: HTMLCanvasElement, grid: TileGrid) {
    this.canvas = canvas
    this.grid = grid
    this.roofs = roofColours(grid)
    this.camX = grid.cols / 2
    this.camY = grid.rows / 2
    this.zoom = 16
  }

  get atlasSize(): number {
    return this.atlas.size
  }

  get cssWidth(): number {
    return this.canvas.clientWidth || this.canvas.width
  }

  get cssHeight(): number {
    return this.canvas.clientHeight || this.canvas.height
  }

  setRoute(route: RouteShape | undefined): void {
    this.route = route
    this.routeCells = []
    if (route) {
      const seen = new Set<number>()
      const cumulative = cumulativeDistances(route.points)
      for (let i = 1; i < route.points.length; i++) {
        const a = this.grid.toTileXY(route.points[i - 1]!)
        const b = this.grid.toTileXY(route.points[i]!)
        const along = cumulative[i - 1] ?? 0
        line4(a, b, (x, y) => {
          const k = y * this.grid.cols + x
          if (seen.has(k)) return
          seen.add(k)
          this.routeCells.push({ x, y, along })
        })
      }
    }
    this.requestRender()
  }

  setQuest(quest: QuestOverlay | undefined): void {
    this.quest = quest
    this.requestRender()
  }

  /** Start the sparkle animation for a collected checkpoint. */
  pickup(point: LatLon): void {
    this.pickups.push({ point, t0: performance.now() })
    this.requestRender()
  }

  /** Move the camera to a point without changing zoom (follow mode). */
  follow(p: LatLon): void {
    const t = this.grid.toTileXY(p)
    this.camX = t.x
    this.camY = t.y
    this.requestRender()
  }

  setMarkers(markers: Markers): void {
    this.markers = markers
    this.requestRender()
  }

  centerOn(p: LatLon, zoom?: number): void {
    const t = this.grid.toTileXY(p)
    this.camX = t.x
    this.camY = t.y
    if (zoom) this.zoom = zoom
    this.requestRender()
  }

  /** Fit a set of points on screen, choosing the largest zoom level that fits. */
  fit(points: LatLon[], paddingPx = 48): void {
    if (points.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of points) {
      const t = this.grid.toTileXY(p)
      minX = Math.min(minX, t.x)
      minY = Math.min(minY, t.y)
      maxX = Math.max(maxX, t.x)
      maxY = Math.max(maxY, t.y)
    }
    const w = Math.max(1, this.cssWidth - paddingPx * 2)
    const h = Math.max(1, this.cssHeight - paddingPx * 2)
    const needed = Math.min(w / Math.max(1, maxX - minX), h / Math.max(1, maxY - minY))
    let zoom: number = ZOOM_LEVELS[0]
    for (const z of ZOOM_LEVELS) if (z <= needed) zoom = z
    this.zoom = zoom
    this.camX = (minX + maxX) / 2
    this.camY = (minY + maxY) / 2
    this.requestRender()
  }

  /** Step the zoom ladder, keeping the point under (sx, sy) fixed on screen. */
  zoomStep(direction: 1 | -1, sx = this.cssWidth / 2, sy = this.cssHeight / 2): void {
    const i = ZOOM_LEVELS.indexOf(this.zoom as (typeof ZOOM_LEVELS)[number])
    const current = i < 0 ? ZOOM_LEVELS.findIndex((z) => z >= this.zoom) : i
    const nextIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, current + direction))
    this.zoomTo(ZOOM_LEVELS[nextIndex]!, sx, sy)
  }

  zoomTo(zoom: number, sx = this.cssWidth / 2, sy = this.cssHeight / 2): void {
    const before = this.screenToTile(sx, sy)
    this.zoom = zoom
    const after = this.screenToTile(sx, sy)
    this.camX += before.x - after.x
    this.camY += before.y - after.y
    this.clampCamera()
    this.requestRender()
  }

  panBy(dxCss: number, dyCss: number): void {
    this.camX -= dxCss / this.zoom
    this.camY -= dyCss / this.zoom
    this.clampCamera()
    this.requestRender()
  }

  private clampCamera(): void {
    this.camX = Math.max(0, Math.min(this.grid.cols, this.camX))
    this.camY = Math.max(0, Math.min(this.grid.rows, this.camY))
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.camX + (sx - this.cssWidth / 2) / this.zoom,
      y: this.camY + (sy - this.cssHeight / 2) / this.zoom,
    }
  }

  screenToLatLon(sx: number, sy: number): LatLon {
    const t = this.screenToTile(sx, sy)
    return this.grid.tileToLatLon(t.x, t.y)
  }

  requestRender(): void {
    if (this.frame) return
    if (typeof requestAnimationFrame === 'undefined') {
      this.render()
      return
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  dispose(): void {
    if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame)
    this.chunks.clear()
  }

  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = `${cx},${cy}`
    const found = this.chunks.get(key)
    if (found) {
      // Refresh LRU position.
      this.chunks.delete(key)
      this.chunks.set(key, found)
      return found
    }
    const canvas = makeCanvas(CHUNK * TILE_PX, CHUNK * TILE_PX)
    const ctx = canvas.getContext('2d')!
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gx = cx * CHUNK + tx
        const gy = cy * CHUNK + ty
        if (!this.grid.inBounds(gx, gy)) continue
        const spec = tileSpecAt(this.grid, this.roofs, gx, gy)
        const slot = this.atlas.slot(tileKey(spec), (actx, x, y) => paintTile(actx, x, y, spec))
        ctx.drawImage(slot.page, slot.sx, slot.sy, TILE_PX, TILE_PX, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    this.chunks.set(key, canvas)
    if (this.chunks.size > MAX_CHUNKS) {
      const oldest = this.chunks.keys().next().value
      if (oldest !== undefined) this.chunks.delete(oldest)
    }
    return canvas
  }

  private overviewCanvas(): HTMLCanvasElement {
    if (this.overview) return this.overview
    const { cols, rows } = this.grid
    const canvas = makeCanvas(cols, rows)
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(cols, rows)
    const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
    const colours: Record<number, number[]> = {
      [Terrain.ground]: hex(P.overview.ground),
      [Terrain.park]: hex(P.overview.park),
      [Terrain.water]: hex(P.overview.water),
      [Terrain.road]: hex(P.overview.road),
      [Terrain.path]: hex(P.overview.path),
      [Terrain.crossing]: hex(P.overview.crossing),
    }
    const roofRgb = P.roofs.map((r) => hex(r[0]))
    for (let i = 0; i < this.grid.terrain.length; i++) {
      const t = this.grid.terrain[i] ?? 0
      const rgb = t === Terrain.building ? roofRgb[(this.roofs[i] ?? 0) % roofRgb.length]! : colours[t]!
      image.data[i * 4] = rgb[0]!
      image.data[i * 4 + 1] = rgb[1]!
      image.data[i * 4 + 2] = rgb[2]!
      image.data[i * 4 + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    this.overview = canvas
    return canvas
  }

  private sprite(sprite: Sprite): HTMLCanvasElement {
    let c = this.spriteCache.get(sprite)
    if (!c) {
      c = makeCanvas(16, 16)
      paintSprite(c.getContext('2d')!, sprite, 0, 0)
      this.spriteCache.set(sprite, c)
    }
    return c
  }

  render(): void {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const cssW = this.cssWidth
    const cssH = this.cssHeight
    const w = Math.round(cssW * dpr)
    const h = Math.round(cssH * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = P.ink
    ctx.fillRect(0, 0, w, h)

    const scale = this.zoom * dpr // device px per tile
    const originX = Math.round(w / 2 - this.camX * scale)
    const originY = Math.round(h / 2 - this.camY * scale)
    const toScreen = (tx: number, ty: number) => ({ x: originX + tx * scale, y: originY + ty * scale })

    if (this.zoom >= DETAIL_ZOOM) {
      const firstX = Math.max(0, Math.floor(-originX / scale / CHUNK))
      const firstY = Math.max(0, Math.floor(-originY / scale / CHUNK))
      const lastX = Math.min(Math.ceil(this.grid.cols / CHUNK) - 1, Math.floor((w - originX) / scale / CHUNK))
      const lastY = Math.min(Math.ceil(this.grid.rows / CHUNK) - 1, Math.floor((h - originY) / scale / CHUNK))
      for (let cy = firstY; cy <= lastY; cy++) {
        for (let cx = firstX; cx <= lastX; cx++) {
          const x0 = Math.round(originX + cx * CHUNK * scale)
          const y0 = Math.round(originY + cy * CHUNK * scale)
          const x1 = Math.round(originX + (cx + 1) * CHUNK * scale)
          const y1 = Math.round(originY + (cy + 1) * CHUNK * scale)
          ctx.drawImage(this.chunk(cx, cy), x0, y0, x1 - x0, y1 - y0)
        }
      }
    } else {
      ctx.drawImage(this.overviewCanvas(), originX, originY, this.grid.cols * scale, this.grid.rows * scale)
    }

    // Route trail: footprints on tile centres (detail) or solid cells (town map).
    if (this.routeCells.length) {
      if (this.zoom >= DETAIL_ZOOM) {
        const dot = Math.max(2, Math.round(scale / 4))
        const walked = this.quest?.alongM ?? -1
        this.routeCells.forEach((c, i) => {
          if (i % 2) return
          const p = toScreen(c.x + 0.5, c.y + 0.5)
          ctx.fillStyle = P.routeShadow
          ctx.fillRect(Math.round(p.x - dot / 2) + Math.max(1, dot / 4), Math.round(p.y - dot / 2) + Math.max(1, dot / 4), dot, dot)
          ctx.fillStyle = c.along <= walked ? P.routeGlow : P.route
          ctx.fillRect(Math.round(p.x - dot / 2), Math.round(p.y - dot / 2), dot, dot)
        })
      } else {
        const size = Math.max(2 * dpr, Math.ceil(scale * 1.6))
        ctx.fillStyle = P.routeShadow
        for (const c of this.routeCells) {
          const p = toScreen(c.x + 0.5, c.y + 0.5)
          ctx.fillRect(Math.round(p.x - size / 2) + dpr, Math.round(p.y - size / 2) + dpr, size, size)
        }
        const walked = this.quest?.alongM ?? -1
        for (const c of this.routeCells) {
          const p = toScreen(c.x + 0.5, c.y + 0.5)
          ctx.fillStyle = c.along <= walked ? P.routeGlow : P.route
          ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size)
        }
      }
    }

    const spriteScale = Math.max(1, Math.round((this.zoom >= 16 ? this.zoom / 16 : 1.5) * dpr))
    const drawSprite = (sprite: Sprite, p: LatLon, anchorY = 0.85) => {
      const t = this.grid.toTileXY(p)
      const s = toScreen(t.x, t.y)
      const size = 16 * spriteScale
      ctx.drawImage(this.sprite(sprite), Math.round(s.x - size / 2), Math.round(s.y - size * anchorY), size, size)
      return { x: s.x, y: s.y, size }
    }

    const route = this.route
    if (route) {
      const fontPx = Math.max(6, Math.round(4 * spriteScale))
      ctx.font = `${fontPx}px "Press Start 2P", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const collected = this.quest?.collected ?? 0
      for (const cp of route.checkpoints) {
        if (cp.isFinish || cp.index <= collected) continue
        const s = drawSprite(CHECKPOINT, cp.point)
        const label = String(cp.index)
        const ly = Math.round(s.y - s.size * 0.95)
        ctx.fillStyle = P.ink
        ctx.fillRect(Math.round(s.x - fontPx * (label.length * 0.5 + 0.4)), ly - fontPx * 0.7, Math.round(fontPx * (label.length + 0.8)), Math.round(fontPx * 1.4))
        ctx.fillStyle = P.white
        ctx.fillText(label, Math.round(s.x), ly + 1)
      }
      const last = route.checkpoints[route.checkpoints.length - 1]
      if (last) drawSprite(FINISH_FLAG, last.point, 0.9)
      const first = route.points[0]
      if (first) drawSprite(START_MAT, first, 0.75)
      const player = this.quest ? this.quest.player : first
      if (player) {
        const acc = this.quest?.accuracyM
        if (acc && acc > 4) {
          // Pixel-stepped accuracy halo.
          const t = this.grid.toTileXY(player)
          const c = toScreen(t.x, t.y)
          const r = Math.max(4, (acc / this.grid.metresPerTile) * scale)
          ctx.fillStyle = 'rgba(74, 143, 240, 0.18)'
          ctx.strokeStyle = 'rgba(44, 95, 184, 0.7)'
          ctx.lineWidth = Math.max(1, Math.round(dpr))
          ctx.beginPath()
          ctx.arc(Math.round(c.x), Math.round(c.y), r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        drawSprite(PLAYER_DOWN, player, 1)
      }
    } else {
      if (this.markers.end) drawSprite(FINISH_FLAG, this.markers.end, 0.9)
      if (this.markers.start) {
        drawSprite(START_MAT, this.markers.start, 0.75)
        drawSprite(PLAYER_DOWN, this.markers.start, 1)
      }
    }

    // Pickup animation: the gem jumps up and bursts into stepped sparkles.
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    this.pickups = this.pickups.filter((p) => now - p.t0 < PICKUP_MS)
    for (const p of this.pickups) {
      const k = (now - p.t0) / PICKUP_MS
      const t = this.grid.toTileXY(p.point)
      const s = toScreen(t.x, t.y)
      const unit = spriteScale
      const rise = Math.round(Math.sin(Math.min(1, k * 1.4) * Math.PI) * 14) * unit
      if (k < 0.6) {
        const size = 16 * unit
        ctx.drawImage(this.sprite(CHECKPOINT), Math.round(s.x - size / 2), Math.round(s.y - size - rise), size, size)
      }
      const spread = Math.round(k * 18) * unit
      ctx.fillStyle = Math.floor(k * 10) % 2 ? P.routeGlow : P.white
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const px = Math.round(s.x + Math.cos(a) * spread)
        const py = Math.round(s.y - 8 * unit + Math.sin(a) * spread)
        const d = Math.max(1, Math.round((1 - k) * 3)) * unit
        ctx.fillRect(px - d / 2, py - d / 2, d, d)
      }
    }
    if (this.pickups.length) this.requestRender()
  }
}
