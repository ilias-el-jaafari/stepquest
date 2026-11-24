import type { LatLon } from '../geo/geo.ts'
import type { Route } from '../routing/planner.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import { Terrain, TILE_PX, type TileGrid } from '../tiles/grid.ts'
import { townFor, type TownLayout } from '../town/layout.ts'
import { P } from './palette.ts'
import { hazardStamps, midpoint, NO_ENTRY } from './hazard.ts'
import { railStamps } from './rails.ts'
import { dirIndex, FOOT_DIRS, FOOT_PATTERNS, footprints, routeCells, smoothPolyline, type RouteCell } from './routePath.ts'
import { CHECKPOINT, facingFrom, FINISH_FLAG, paintSprite, START_MAT, walkFrame, WALKER, type Facing, type Sprite } from './sprites.ts'
import { paintFrontFence, paintGardenPath, paintGardenTree, paintHouse, paintLandmark } from './structures.ts'
import { paintTile, tileHash, tileKey } from './tileset.ts'
import { tileSpecAt } from './tileSpecs.ts'
import { chunkLimit, LruCache, planChunks, type ChunkPlan, type ChunkRef } from './chunkPlan.ts'
import { wrapBubbleText } from '../audio/speechBubble.ts'

/** Screen pixels per tile. ≥ DETAIL_ZOOM draws real 16×16 tiles; below it, a 1-px-per-tile town map. */
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 16, 24, 32, 48] as const
export const DETAIL_ZOOM = 8
const CHUNK = 32
const MAX_CHUNKS = 96
/** Time spent painting new chunks in one frame; the rest waits for the next frame so panning stays smooth. */
export const CHUNK_BUDGET_MS = 6
/** Chunks beyond the screen that are painted ahead while the map is idle. */
export const PREFETCH_MARGIN = 1
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
  /** Walked stretches of earlier routes (before a reroute), drawn as walked footprints. */
  walkedBefore?: readonly (readonly LatLon[])[]
}

const PICKUP_MS = 900
/** How long the walker keeps its walk cycle after the last move. */
const WALK_HOLD_MS = 1200

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

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
  private readonly town: TownLayout
  /** Structures (houses, landmarks) touching each chunk, by chunk key. */
  private readonly chunkStructures = new Map<string, { houses: number[]; landmarks: number[] }>()
  private readonly atlas = new TileAtlas()
  private readonly chunks = new LruCache<HTMLCanvasElement>(MAX_CHUNKS)
  /** Keys of the chunks on screen, which the cache must not evict. */
  private onScreen = new Set<string>()
  private chunkLimit = MAX_CHUNKS
  private overview: HTMLCanvasElement | undefined
  private readonly spriteCache = new Map<Sprite, HTMLCanvasElement>()
  private route: RouteShape | undefined
  private routeCells: RouteCell[] = []
  private routeLine: (RouteCell & { cx: number; cy: number })[] = []
  private walkerSprites: Record<Facing, Sprite[]> = WALKER
  private walkedLines: (RouteCell & { cx: number; cy: number })[][] = []
  /** Avoided streets in tile coordinates. */
  private avoided: { x: number; y: number }[][] = []
  /** Walker animation: facing, tween between fixes, and when it last moved. */
  private walker: { facing: Facing; from?: { x: number; y: number }; to?: { x: number; y: number }; t0: number; ms: number; movedAt: number } = {
    facing: 'down',
    t0: 0,
    ms: 0,
    movedAt: -Infinity,
  }
  private markers: Markers = {}
  /** Text of the speech bubble next to the walker (the phrase being spoken). */
  private bubble: string | undefined
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
    this.town = townFor(grid)
    this.indexStructures()
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
    this.routeCells = route ? routeCells(route.points.map((p) => this.grid.toTileXY(p)), cumulativeDistances(route.points)) : []
    this.routeLine = smoothPolyline(this.routeCells)
    this.requestRender()
  }

  /** Streets on the user's avoid list, drawn as hazard tape under the route. */
  setAvoided(lines: readonly (readonly LatLon[])[]): void {
    this.avoided = lines.filter((l) => l.length > 0).map((l) => l.map((p) => this.grid.toTileXY(p)))
    this.requestRender()
  }

  get avoidedCount(): number {
    return this.avoided.length
  }

  /** Dress the walker (sprites for the four directions). */
  setWalker(sprites: Record<Facing, Sprite[]>): void {
    if (sprites === this.walkerSprites) return
    for (const frames of Object.values(this.walkerSprites)) for (const f of frames) this.spriteCache.delete(f)
    this.walkerSprites = sprites
    this.requestRender()
  }

  setQuest(quest: QuestOverlay | undefined): void {
    const prev = this.quest?.player
    if (quest?.walkedBefore !== this.quest?.walkedBefore) {
      this.walkedLines = (quest?.walkedBefore ?? [])
        .filter((l) => l.length > 1)
        .map((l) => smoothPolyline(routeCells(l.map((p) => this.grid.toTileXY(p)), cumulativeDistances([...l]))))
    }
    this.quest = quest
    const next = quest?.player
    if (next) this.moveWalker(this.grid.toTileXY(next), prev ? this.grid.toTileXY(prev) : undefined)
    this.requestRender()
  }

  /** Face the way the walker moved and tween to the new spot. */
  private moveWalker(to: { x: number; y: number }, prev: { x: number; y: number } | undefined): void {
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    const w = this.walker
    const from = prev ? this.walkerPos(now) ?? prev : undefined
    if (from) {
      const dx = to.x - from.x
      const dy = to.y - from.y
      if (Math.hypot(dx, dy) > 0.05) {
        w.facing = facingFrom(dx, dy, w.facing)
        w.movedAt = now
      }
    }
    const reduced = prefersReducedMotion()
    // Tween over the gap since the last fix (capped), so motion looks continuous.
    w.ms = reduced || !from ? 0 : Math.max(120, Math.min(900, now - w.t0))
    w.from = from
    w.to = to
    w.t0 = now
  }

  private walkerPos(now: number): { x: number; y: number } | undefined {
    const w = this.walker
    if (!w.to) return undefined
    if (!w.from || w.ms <= 0) return w.to
    const k = Math.min(1, (now - w.t0) / w.ms)
    return { x: w.from.x + (w.to.x - w.from.x) * k, y: w.from.y + (w.to.y - w.from.y) * k }
  }

  /** Current facing (for tests and the HUD). */
  get facing(): Facing {
    return this.walker.facing
  }

  private indexStructures(): void {
    const add = (x: number, y: number, w: number, h: number, kind: 'houses' | 'landmarks', index: number) => {
      for (let cy = Math.floor(y / CHUNK); cy <= Math.floor((y + h - 1) / CHUNK); cy++) {
        for (let cx = Math.floor(x / CHUNK); cx <= Math.floor((x + w - 1) / CHUNK); cx++) {
          const key = `${cx},${cy}`
          let entry = this.chunkStructures.get(key)
          if (!entry) {
            entry = { houses: [], landmarks: [] }
            this.chunkStructures.set(key, entry)
          }
          entry[kind].push(index)
        }
      }
    }
    this.town.houses.forEach((h, i) => add(h.x, h.y, h.w, h.h, 'houses', i))
    this.town.landmarks.forEach((l, i) => add(l.x, l.y, l.w, l.h, 'landmarks', i))
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

  /** The camera may go half a screen past the loaded area, so the map can offer loading the next one. */
  private clampCamera(): void {
    const mx = this.cssWidth / 2 / this.zoom
    const my = this.cssHeight / 2 / this.zoom
    this.camX = Math.max(-mx, Math.min(this.grid.cols + mx, this.camX))
    this.camY = Math.max(-my, Math.min(this.grid.rows + my, this.camY))
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

  /** Chunks painted so far (tests and diagnostics). */
  get chunkCount(): number {
    return this.chunks.size
  }

  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = `${cx},${cy}`
    const found = this.chunks.get(key)
    if (found) return found
    const canvas = makeCanvas(CHUNK * TILE_PX, CHUNK * TILE_PX)
    const ctx = canvas.getContext('2d')!
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const gx = cx * CHUNK + tx
        const gy = cy * CHUNK + ty
        if (!this.grid.inBounds(gx, gy)) continue
        const spec = tileSpecAt(this.grid, gx, gy)
        const slot = this.atlas.slot(tileKey(spec), (actx, x, y) => paintTile(actx, x, y, spec))
        ctx.drawImage(slot.page, slot.sx, slot.sy, TILE_PX, TILE_PX, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX)
      }
    }
    this.paintStructures(ctx, cx, cy)
    this.chunks.set(key, canvas, this.onScreen)
    return canvas
  }

  /** Paint the visible chunks nearest the centre first within the frame budget; stand-ins fill the rest. */
  private drawChunks(ctx: CanvasRenderingContext2D, plan: ChunkPlan, originX: number, originY: number, scale: number): boolean {
    this.onScreen = new Set(plan.visible.map((c) => `${c.cx},${c.cy}`))
    this.chunkLimit = chunkLimit(MAX_CHUNKS, plan)
    this.chunks.setLimit(this.chunkLimit)
    const now = () => (typeof performance === 'undefined' ? 0 : performance.now())
    const t0 = now()
    let pending = false
    let built = 0
    let overview: HTMLCanvasElement | undefined
    const rect = (c: ChunkRef) => {
      const x0 = Math.round(originX + c.cx * CHUNK * scale)
      const y0 = Math.round(originY + c.cy * CHUNK * scale)
      return { x0, y0, x1: Math.round(originX + (c.cx + 1) * CHUNK * scale), y1: Math.round(originY + (c.cy + 1) * CHUNK * scale) }
    }
    for (const c of plan.visible) {
      const key = `${c.cx},${c.cy}`
      const r = rect(c)
      // Always paint one chunk per frame (progress is guaranteed), more while the budget lasts.
      if (this.chunks.has(key) || built === 0 || now() - t0 < CHUNK_BUDGET_MS) {
        if (!this.chunks.has(key)) built++
        ctx.drawImage(this.chunk(c.cx, c.cy), r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
      } else {
        // Stand-in: the town map, scaled up, instead of a hole.
        pending = true
        overview ??= this.overviewCanvas()
        const sx = c.cx * CHUNK
        const sy = c.cy * CHUNK
        const sw = Math.min(CHUNK, this.grid.cols - sx)
        const sh = Math.min(CHUNK, this.grid.rows - sy)
        ctx.drawImage(overview, sx, sy, sw, sh, r.x0, r.y0, Math.round(sw * scale), Math.round(sh * scale))
      }
    }
    // Idle: paint the ring around the screen, one chunk per frame, so the next pan finds it ready.
    if (!pending && plan.visible.length + plan.ring.length <= this.chunkLimit) {
      const next = plan.ring.find((c) => !this.chunks.has(`${c.cx},${c.cy}`))
      if (next) {
        this.chunk(next.cx, next.cy)
        pending = true
      }
    }
    return pending
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
    const entry = this.chunkStructures.get(`${cx},${cy}`)
    if (!entry) return
    const houses = entry.houses.map((k) => town.houses[k]!).sort((a, b) => a.y - b.y)
    for (const h of houses) paintHouse(ctx, (h.x - x0) * TILE_PX, (h.y - y0) * TILE_PX, h)
    const landmarks = entry.landmarks.map((k) => town.landmarks[k]!).sort((a, b) => a.y - b.y)
    for (const l of landmarks) paintLandmark(ctx, (l.x - x0) * TILE_PX, (l.y - y0) * TILE_PX, l)
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
      [Terrain.plaza]: hex(P.overview.plaza),
      [Terrain.building]: hex(P.overview.lot),
    }
    const roofRgb = P.roofs.map((r) => hex(r[0]))
    const landmarkRgb = this.town.landmarks.map((l) => hex(l.kind === 'parkGate' ? P.stone : P.landmarks[l.kind].roof[0]))
    for (let i = 0; i < this.grid.terrain.length; i++) {
      const t = this.grid.terrain[i] ?? 0
      const house = this.town.houseAt[i] ?? -1
      const landmark = this.town.landmarkAt[i] ?? -1
      const rgb =
        landmark >= 0 && t !== Terrain.path
          ? landmarkRgb[landmark]!
          : house >= 0
            ? roofRgb[(this.town.houses[house]?.roof ?? 0) % roofRgb.length]!
            : colours[t]!
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
    // Ground colour (never black) where nothing is loaded; the loaded area is a shade lighter.
    ctx.fillStyle = P.groundB
    ctx.fillRect(0, 0, w, h)

    const scale = this.zoom * dpr // device px per tile
    const originX = Math.round(w / 2 - this.camX * scale)
    const originY = Math.round(h / 2 - this.camY * scale)
    const toScreen = (tx: number, ty: number) => ({ x: originX + tx * scale, y: originY + ty * scale })

    if (this.zoom >= DETAIL_ZOOM) {
      ctx.fillStyle = P.groundA
      ctx.fillRect(originX, originY, Math.round(this.grid.cols * scale), Math.round(this.grid.rows * scale))
      const plan = planChunks({ camX: this.camX, camY: this.camY, zoom: this.zoom, cssW, cssH, cols: this.grid.cols, rows: this.grid.rows, chunk: CHUNK, margin: PREFETCH_MARGIN })
      if (this.drawChunks(ctx, plan, originX, originY, scale)) this.requestRender()
    } else {
      ctx.fillStyle = P.groundA
      ctx.fillRect(originX, originY, Math.round(this.grid.cols * scale), Math.round(this.grid.rows * scale))
      ctx.drawImage(this.overviewCanvas(), originX, originY, this.grid.cols * scale, this.grid.rows * scale)
    }

    // Tram, metro and train tracks above ground.
    if (this.grid.rails.length) this.drawRails(ctx, scale, toScreen, w, h, dpr)

    // Avoided streets: hazard tape under the route.
    if (this.avoided.length) this.drawAvoided(ctx, scale, toScreen, w, h, dpr)

    // Route: red pixel footprints along the path (darker where already walked).
    if (this.routeCells.length || this.walkedLines.length) this.drawRoute(ctx, scale, toScreen, w, h, dpr)

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
        const at = this.drawWalker(ctx, player, toScreen, spriteScale)
        if (this.bubble) this.drawBubble(ctx, this.bubble, at, dpr, w, h)
      }
    } else {
      if (this.markers.end) drawSprite(FINISH_FLAG, this.markers.end, 0.9)
      if (this.markers.start) {
        drawSprite(START_MAT, this.markers.start, 0.75)
        const at = this.drawWalker(ctx, this.markers.start, toScreen, spriteScale)
        if (this.bubble) this.drawBubble(ctx, this.bubble, at, dpr, w, h)
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

  private drawWalker(ctx: CanvasRenderingContext2D, p: LatLon, toScreen: (x: number, y: number) => { x: number; y: number }, spriteScale: number): { x: number; y: number; size: number } {
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    const w = this.walker
    const target = this.grid.toTileXY(p)
    // Outside a quest (planning screen) the walker just stands at the start.
    const pos = this.quest?.player ? (this.walkerPos(now) ?? target) : target
    const moving = this.quest?.player !== undefined && now - w.movedAt < WALK_HOLD_MS && !prefersReducedMotion()
    const frames = this.walkerSprites[this.quest?.player ? w.facing : 'down']
    const sprite = frames[walkFrame(now, moving)] ?? frames[0]!
    const s = toScreen(pos.x, pos.y)
    const size = 16 * spriteScale
    ctx.drawImage(this.sprite(sprite), Math.round(s.x - size / 2), Math.round(s.y - size), size, size)
    const tweening = w.from && w.ms > 0 && now - w.t0 < w.ms
    if (moving || tweening) this.requestRender()
    return { x: s.x, y: s.y, size }
  }

  /** Show (or clear) the speech bubble next to the walker. */
  setBubble(text: string | undefined): void {
    if (text === this.bubble) return
    this.bubble = text
    this.requestRender()
  }

  /** Pixel-art speech bubble: ink outline with notched corners, paper fill, blue rule, a tail to the walker. */
  private drawBubble(ctx: CanvasRenderingContext2D, text: string, at: { x: number; y: number; size: number }, dpr: number, w: number, h: number): void {
    const px = Math.max(1, Math.round(dpr)) // one "art pixel"
    const font = 8 * px
    const margin = 4 * px
    ctx.font = `${font}px "Press Start 2P", monospace`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const maxChars = Math.max(10, Math.min(22, Math.floor((w * 0.62) / font)))
    const lines = wrapBubbleText(text, maxChars)
    const longest = Math.max(...lines.map((l) => l.length), 1)
    const pad = 4 * px
    const bw = longest * font + pad * 2 + 4 * px
    const lineH = Math.round(font * 1.5)
    const bh = lines.length * lineH + pad * 2 + 2 * px
    // To the right of the walker's head; to the left when it would leave the screen.
    let x = Math.round(at.x + at.size * 0.3)
    if (x + bw > w - margin) x = Math.round(at.x - at.size * 0.3 - bw)
    x = Math.max(margin, Math.min(w - bw - margin, x))
    let y = Math.round(at.y - at.size - bh + 2 * px)
    y = Math.max(margin, Math.min(h - bh - margin - 6 * px, y))
    const notch = (bx: number, by: number, bwid: number, bhei: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(bx + px, by, bwid - 2 * px, bhei)
      ctx.fillRect(bx, by + px, bwid, bhei - 2 * px)
    }
    // Stepped drop shadow, outline, paper, blue inner rule.
    notch(x + 2 * px, y + 2 * px, bw, bh, 'rgba(27, 26, 46, 0.45)')
    notch(x, y, bw, bh, P.ink)
    notch(x + px, y + px, bw - 2 * px, bh - 2 * px, P.white)
    notch(x + 2 * px, y + 2 * px, bw - 4 * px, bh - 4 * px, '#5d93c9')
    notch(x + 3 * px, y + 3 * px, bw - 6 * px, bh - 6 * px, P.white)
    // Tail: three stepped blocks pointing down to the walker's head.
    const tailX = Math.max(x + 4 * px, Math.min(x + bw - 8 * px, Math.round(at.x - 2 * px)))
    const tailY = y + bh
    ctx.fillStyle = P.ink
    ctx.fillRect(tailX, tailY - px, 6 * px, 2 * px)
    ctx.fillRect(tailX + px, tailY + px, 4 * px, 2 * px)
    ctx.fillRect(tailX + 2 * px, tailY + 3 * px, 2 * px, 2 * px)
    ctx.fillStyle = P.white
    ctx.fillRect(tailX + px, tailY - px, 4 * px, 2 * px)
    ctx.fillRect(tailX + 2 * px, tailY + px, 2 * px, 2 * px)
    ctx.fillStyle = P.ink
    lines.forEach((l, i) => ctx.fillText(l, x + pad + 2 * px, y + pad + px + i * lineH + Math.round((lineH - font) / 2)))
  }

  get railCount(): number {
    return this.grid.rails.length
  }

  private drawRails(
    ctx: CanvasRenderingContext2D,
    scale: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    w: number,
    h: number,
    dpr: number,
  ): void {
    const detail = this.zoom >= DETAIL_ZOOM
    const unit = detail ? Math.max(1, Math.round(scale / 16)) : Math.max(1, Math.round(dpr))
    // Gauge (between the two rails) in art pixels; a bit wider on the town map so it reads.
    const half = (detail ? 3 : 2) * unit
    const bed = half * 2 + 3 * unit
    const sleeperHalf = half + unit
    const gap = 4 * unit
    const margin = bed * 2
    const snap = (v: number) => Math.round(v / unit) * unit
    // Tracks run on past the loaded area: keep them inside the map.
    const origin = toScreen(0, 0)
    ctx.save()
    ctx.beginPath()
    ctx.rect(origin.x, origin.y, this.grid.cols * scale, this.grid.rows * scale)
    ctx.clip()
    for (const line of this.grid.rails) {
      const pts = line.map((p) => toScreen(p.x + 0.5, p.y + 0.5))
      if (!pts.some((p) => p.x > -margin && p.y > -margin && p.x < w + margin && p.y < h + margin)) continue
      const stamps = railStamps(pts, unit, gap)
      ctx.fillStyle = P.railBed
      for (const s of stamps) ctx.fillRect(snap(s.x) - Math.round(bed / 2), snap(s.y) - Math.round(bed / 2), bed, bed)
      ctx.fillStyle = P.railSleeper
      for (const s of stamps) {
        if (!s.sleeper) continue
        for (let o = -sleeperHalf; o <= sleeperHalf; o += unit) ctx.fillRect(snap(s.x + s.nx * o), snap(s.y + s.ny * o), unit, unit)
      }
      for (const side of [-1, 1]) {
        ctx.fillStyle = P.railShade
        for (const s of stamps) ctx.fillRect(snap(s.x + s.nx * (side * half)), snap(s.y + s.ny * (side * half)) + unit, unit, unit)
        ctx.fillStyle = P.railSteel
        for (const s of stamps) ctx.fillRect(snap(s.x + s.nx * (side * half)), snap(s.y + s.ny * (side * half)), unit, unit)
      }
    }
    ctx.restore()
  }

  private drawAvoided(
    ctx: CanvasRenderingContext2D,
    scale: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    w: number,
    h: number,
    dpr: number,
  ): void {
    const detail = this.zoom >= DETAIL_ZOOM
    const unit = detail ? Math.max(1, Math.round(scale / 16)) : Math.max(1, Math.round(dpr))
    // Bold on the town map so it reads at a glance; one road-width band up close.
    const band = detail ? 5 * unit : Math.max(5 * unit, Math.ceil(scale * 1.8))
    const inner = Math.max(unit, band - 2 * unit)
    const dash = detail ? 6 * unit : Math.max(5 * unit, band * 2)
    const margin = band * 2
    const lines = this.avoided
      .map((l) => l.map((p) => toScreen(p.x + 0.5, p.y + 0.5)))
      .filter((l) => l.some((p) => p.x > -margin && p.y > -margin && p.x < w + margin && p.y < h + margin))
    // Dark band with an outline, then the amber dashes.
    for (const pts of lines) {
      const stamps = hazardStamps(pts, unit, dash)
      ctx.fillStyle = P.avoidBand
      for (const s of stamps) ctx.fillRect(s.x - Math.round(band / 2), s.y - Math.round(band / 2), band, band)
      ctx.fillStyle = P.avoid
      for (const s of stamps) if (s.on) ctx.fillRect(s.x - Math.round(inner / 2), s.y - Math.round(inner / 2), inner, inner)
    }
    // One "no entry" sign per stretch long enough to carry it.
    const px = detail ? unit : Math.max(1, Math.round(dpr * 1.5))
    const size = NO_ENTRY.length * px
    for (const pts of lines) {
      let len = 0
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
      if (len < size * 3) continue
      const m = midpoint(pts)!
      const ox = Math.round(m.x - size / 2)
      const oy = Math.round(m.y - size / 2)
      NO_ENTRY.forEach((row, yy) => {
        for (let xx = 0; xx < row.length; xx++) {
          const ch = row[xx]
          if (ch === '.') continue
          ctx.fillStyle = ch === 'k' ? P.ink : ch === 'w' ? P.white : P.noEntry
          ctx.fillRect(ox + xx * px, oy + yy * px, px, px)
        }
      })
    }
  }

  private drawRoute(
    ctx: CanvasRenderingContext2D,
    scale: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    w: number,
    h: number,
    dpr: number,
  ): void {
    const detail = this.zoom >= DETAIL_ZOOM
    // One art pixel in device pixels.
    const unit = detail ? Math.max(1, Math.round(scale / 16)) : Math.max(1, Math.round(dpr))
    const margin = 12 * unit
    const visible = (p: { x: number; y: number }) => p.x > -margin && p.y > -margin && p.x < w + margin && p.y < h + margin
    const px = detail ? unit : Math.max(1, Math.round(dpr * (this.zoom >= 8 ? 1.5 : 1)))
    // Walked stretches of routes left behind by a reroute: all walked, under the current route.
    for (const line of this.walkedLines) this.drawFootprints(ctx, line, Infinity, toScreen, px, visible)
    // Footprints: bright red ahead, darker and faded where already walked.
    this.drawFootprints(ctx, this.routeLine, this.quest?.alongM ?? -1, toScreen, px, visible)
  }

  private drawFootprints(
    ctx: CanvasRenderingContext2D,
    line: readonly { cx: number; cy: number; along: number }[],
    walked: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
    px: number,
    visible: (p: { x: number; y: number }) => boolean,
  ): void {
    const pts = line.map((c) => ({ ...toScreen(c.cx, c.cy), along: c.along }))
    const prints = footprints(pts, 7 * px, 2 * px)
    const size = 9 * px
    for (const f of prints) {
      if (!visible(f)) continue
      const done = f.along <= walked
      const rows = FOOT_PATTERNS[f.left ? 0 : 1]![dirIndex(f.angle, FOOT_DIRS)]!
      const ox = Math.round(f.x - size / 2)
      const oy = Math.round(f.y - size / 2)
      ctx.globalAlpha = done ? 0.6 : 1
      rows.forEach((row, yy) => {
        for (let xx = 0; xx < row.length; xx++) {
          const ch = row[xx]
          if (ch === '.') continue
          ctx.fillStyle = ch === 'k' ? (done ? P.routeShadow : P.ink) : done ? P.routeWalked : P.route
          ctx.fillRect(ox + xx * px, oy + yy * px, px, px)
        }
      })
    }
    ctx.globalAlpha = 1
  }
}
