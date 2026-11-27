import type { BBox, LatLon } from '../geo/geo.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { Camera, DETAIL_ZOOM, FAR_ZOOM, ZOOM_LEVELS, type Pt } from './camera.ts'
import { drawFrontier } from './frontier.ts'
import { drawLoading } from './loading.ts'
import { questMinZoom } from '../world/window.ts'
import { isMapSource, staticSource, type MapSource } from './mapSource.ts'
import { ChunkLayer } from './chunkLayer.ts'
import { shotAt } from '../demo/camera.ts'
import type { Lighting } from './daylight.ts'
import { OverlayLayer, type Markers, type QuestOverlay, type RouteShape } from './overlayLayer.ts'
import { LightingLayer } from './lightingLayer.ts'
import { DecorLayer } from './decorLayer.ts'
import { SightLayer } from './sightLayer.ts'
import type { SightMark } from '../sights/types.ts'
import { decorOn } from '../decor/pref.ts'
import { FrameScheduler } from './frameScheduler.ts'
import { P } from './palette.ts'
import type { Facing, Sprite } from './sprites.ts'
import { drawRails } from './streetMarks.ts'
import type { LodLayer } from '../lod/layer.ts'
import { makeCanvas, nowMs, releaseCanvas } from './env.ts'
import { backingRatio, backingSize, MAX_PIXELS, watchPixelRatio } from './viewport.ts'
import type { View } from './view.ts'

export { DETAIL_ZOOM, FAR_ZOOM, ZOOM_LEVELS }
export { CHUNK_BUDGET_MS, PREFETCH_MARGIN, WATER_FRAME_MS, WATER_FRAMES, waterFrame } from './chunkLayer.ts'
export type { Markers, QuestOverlay, RouteShape }

/** Device px kept around the screen in the cached scene, a multiple of 32 so patterns keep their phase. */
const SCENE_STEP = 32
/** The scene (map, water, tracks, tint, night light) is redrawn when the camera has moved more than this many px of margin. */
export function sceneMargin(w: number, h: number): number {
  let m = Math.round((Math.min(w, h) * 0.25) / SCENE_STEP) * SCENE_STEP
  while (m > 0 && (w + 2 * m) * (h + 2 * m) > MAX_PIXELS / 2) m -= SCENE_STEP
  return Math.max(0, m)
}

/** The map as drawn without the overlay, kept between frames: a frame that only moves the walker blits it. */
type Scene = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** Size and margin in device px; the screen is the window `margin` px inside. */
  w: number
  h: number
  margin: number
  /** The view this scene was drawn for. */
  scale: number
  dpr: number
  zoom: number
  originX: number
  originY: number
  light: Lighting
}

/** What the demo camera is asked for (see `autoShot`). */
type Shot = { bounds: BBox; blend: number; closeZoom: number }

/**
 * The map renderer: a thin facade that owns the canvas and wires the layers of one frame, in order:
 * ground, terrain chunks (or the far-zoom town map), water, tracks, sky tint and night light, then
 * the overlay (tape, route, gems, walker, bubble). Each layer lives in its own module (see design.md,
 * "Architecture review"); this class only converts coordinates, sizes the canvas and schedules frames.
 * The map is a tile grid (a single extract) or a `MapSource` that grows (a streamed world): its
 * changes repaint only the tiles they touch, and cells still loading get a quiet stipple.
 */
export class MapRenderer {
  readonly grid: TileGrid
  readonly source: MapSource
  private readonly canvas: HTMLCanvasElement
  private readonly camera: Camera
  private readonly scheduler = new FrameScheduler(() => this.render())
  private readonly chunks: ChunkLayer
  private readonly lightingLayer: LightingLayer
  private readonly overlay: OverlayLayer
  private readonly decor: DecorLayer
  private readonly sights: SightLayer
  private readonly stopSightWatch: () => void
  private routeTiles: { x: number; y: number }[] = []
  private markerTiles: { x: number; y: number }[] = []
  private keepOut: ReadonlySet<number> | undefined
  private readonly stopPixelRatio: () => void
  private readonly stopSource: () => void
  private viewListener: ((box: BBox, centre: LatLon, zoom: number) => void) | undefined
  private lastViewKey = ''
  /** Last CSS size of the canvas that had a layout (kept while the canvas is hidden). */
  private lastCss: { w: number; h: number } | undefined
  private scene: Scene | undefined
  /** Something the scene shows changed (data, light, water frame): draw it again. A camera move alone does not set this. */
  private sceneDirty = true
  /** Camera follows the displayed walker every frame (set by `follow`, cleared by `stopFollow` and by a pan). */
  private following = false
  private shot: Shot | undefined
  /** The level-of-detail layer around the hero (requirement 25), or none (tests, the bundled demo). */
  private lod: LodLayer | undefined
  private stopLod: (() => void) | undefined
  /** Frames drawn and scene redraws, for tests and diagnostics. */
  readonly stats = { frames: 0, sceneDraws: 0 }
  private readonly view: View = { w: 0, h: 0, dpr: 1, zoom: 16, cssW: 0, cssH: 0, scale: 16, originX: 0, originY: 0, camX: 0, camY: 0, detail: true }

  constructor(canvas: HTMLCanvasElement, map: TileGrid | MapSource) {
    const source = isMapSource(map) ? map : staticSource(map)
    const grid = source.grid
    this.canvas = canvas
    this.source = source
    this.grid = grid
    this.camera = new Camera(grid.cols, grid.rows)
    // These come from the layers (data arrived, a water or flicker step, the sky): the scene shows them.
    const tick = () => {
      this.sceneDirty = true
      this.requestRender()
    }
    this.chunks = new ChunkLayer(source, tick)
    this.stopSource = source.subscribe(tick)
    this.lightingLayer = new LightingLayer(grid, this.chunks, tick)
    this.overlay = new OverlayLayer(grid, this.lightingLayer)
    this.decor = new DecorLayer(grid, () => this.requestRender(), decorOn(), source.town)
    this.sights = new SightLayer(grid)
    // Sights look for their spot again when the loaded map changes (not on every water or flicker step).
    this.stopSightWatch = source.subscribe(() => {
      if (!this.sights.hasMarks) return
      this.sights.invalidate()
    })
    this.stopPixelRatio = watchPixelRatio(tick)
  }

  // Camera state (tile units and CSS px per tile) is readable and settable for the UI and tests.
  get camX(): number {
    return this.camera.x
  }
  set camX(v: number) {
    this.camera.x = v
  }
  get camY(): number {
    return this.camera.y
  }
  set camY(v: number) {
    this.camera.y = v
  }
  get zoom(): number {
    return this.camera.zoom
  }
  set zoom(v: number) {
    this.camera.zoom = v
  }

  /** The canvas size in CSS px: its layout size, the last one seen while hidden, or the attribute size before any layout. */
  private measure(): { w: number; h: number } {
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (cw > 0 && ch > 0) return (this.lastCss = { w: cw, h: ch })
    if (!this.lastCss) {
      const r = backingRatio(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
      this.lastCss = { w: cw > 0 ? cw : this.canvas.width / r, h: ch > 0 ? ch : this.canvas.height / r }
    }
    return this.lastCss
  }

  private questFloor = false

  /**
   * Let the camera roam `radiusM` around `centre` (the hero) instead of staying near the loaded frame (requirement 26.1); undefined
   * goes back to the frame. Does not move the camera; the next pan or zoom keeps it inside.
   */
  setReach(centre: LatLon | undefined, radiusM: number): void {
    if (!centre) {
      this.camera.limit = undefined
      return
    }
    const c = this.grid.toTileXY(centre)
    const r = radiusM / this.grid.metresPerTile
    this.camera.limit = { x0: c.x - r, x1: c.x + r, y0: c.y - r, y1: c.y + r }
  }

  /** Lowest zoom the view may have now (requirement 20.13): in a quest, the view must stay coverable. */
  get minZoom(): number {
    return this.camera.minZoom
  }

  /** While a quest runs, keep the zoom at or above the floor for this screen size and place. */
  private applyFloor(): void {
    const cam = this.camera
    if (!this.questFloor) {
      cam.minZoom = 0
      return
    }
    const lat = this.grid.tileToLatLon(cam.x, cam.y).lat
    cam.minZoom = questMinZoom(cam.width, cam.height, this.grid.metresPerTile, lat)
    if (cam.zoom < cam.minZoom) cam.zoomTo(cam.minZoom)
  }

  /** Bring the camera's idea of the screen size up to date. Returns true when it changed. */
  private syncSize(): boolean {
    const { w, h } = this.measure()
    if (w === this.camera.width && h === this.camera.height) return false
    this.camera.setSize(w, h)
    return true
  }

  get cssWidth(): number {
    this.syncSize()
    return this.camera.width
  }

  get cssHeight(): number {
    this.syncSize()
    return this.camera.height
  }

  /** Draw the far zooms from z14 data around the hero and name the streets (requirement 25). */
  setLod(layer: LodLayer | undefined): void {
    if (layer === this.lod) return
    this.stopLod?.()
    this.lod = layer
    this.stopLod = layer?.subscribe(() => {
      this.sceneDirty = true
      this.requestRender()
    })
    this.sceneDirty = true
    this.requestRender()
  }

  /** Halloween decor on or off (the Settings tab and `?decor=`); redraws the scene when it changes. */
  setDecor(on: boolean): void {
    if (!this.decor.setEnabled(on)) return
    this.sceneDirty = true
    this.requestRender()
  }

  /** The sights along the route (landmarks spec); an empty list shows none. */
  setSights(marks: readonly SightMark[]): void {
    if (!this.sights.setMarks(marks)) return
    this.sceneDirty = true
    this.requestRender()
  }

  /** Keep the decor off the route, the start and the finish: every tile within 1 of them is left bare. */
  private updateKeepOut(): void {
    const keep = new Set<number>()
    const { cols, rows } = this.grid
    const mark = (p: { x: number; y: number }) => {
      const x0 = Math.floor(p.x)
      const y0 = Math.floor(p.y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x0 + dx >= 0 && y0 + dy >= 0 && x0 + dx < cols && y0 + dy < rows) keep.add((y0 + dy) * cols + x0 + dx)
    }
    const pts = this.routeTiles
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!
      mark(a)
      const b = pts[i + 1]
      if (!b) break
      // Points of a route are metres apart; fill the gaps at half-tile steps.
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5)
      for (let k = 1; k < n; k++) mark({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
    }
    for (const m of this.markerTiles) mark(m)
    // Only a real change redraws the scene (the same route set again, or a start on the route, changes nothing).
    const old = this.keepOut
    let same = old !== undefined && old.size === keep.size
    if (same) for (const k of keep) if (!old!.has(k)) { same = false; break }
    if (same) return
    this.keepOut = keep
    this.decor.setKeepOut(keep)
    this.sights.setKeepOut(keep)
    if (this.sights.hasMarks) this.sceneDirty = true
    if (this.decor.isEnabled) this.sceneDirty = true
  }

  setRoute(route: RouteShape | undefined): void {
    this.overlay.setRoute(route)
    this.routeTiles = route ? route.points.map((p) => this.grid.toTileXY(p)) : []
    this.updateKeepOut()
    this.requestRender()
  }

  /** Streets on the user's avoid list, drawn as hazard tape under the route. */
  setAvoided(lines: readonly (readonly LatLon[])[]): void {
    this.overlay.setAvoided(lines)
    this.requestRender()
  }

  /** Dress the walker (sprites for the four directions). */
  setWalker(sprites: Record<Facing, Sprite[]>): void {
    this.overlay.setWalker(sprites)
    this.requestRender()
  }

  setQuest(quest: QuestOverlay | undefined): void {
    this.overlay.setQuest(quest)
    this.questFloor = quest !== undefined
    this.requestRender()
  }

  setMarkers(markers: Markers): void {
    this.overlay.setMarkers(markers)
    this.markerTiles = [markers.start, markers.end].filter((p): p is LatLon => p !== undefined).map((p) => this.grid.toTileXY(p))
    this.updateKeepOut()
    this.requestRender()
  }

  /** Show (or clear) the speech bubble next to the walker. */
  setBubble(text: string | undefined): void {
    if (this.overlay.setBubble(text)) this.requestRender()
  }

  /** Start the sparkle animation for a collected checkpoint. */
  pickup(point: LatLon): void {
    this.overlay.pickup(point)
    this.requestRender()
  }

  /**
   * Follow mode: from now on the camera sits on the walker as it is drawn every frame (so it glides with it),
   * not on the last fix. The first call also centres on `p`.
   */
  follow(p: LatLon): void {
    if (!this.following || !this.overlay.walkerTile(nowMs())) {
      const t = this.grid.toTileXY(p)
      this.camera.centerOn(t.x, t.y)
    }
    this.following = true
    this.requestRender()
  }

  /** Leave follow mode: the camera stays where it is. */
  stopFollow(): void {
    this.following = false
  }

  /** Hand the camera back from the demo run. */
  clearShot(): void {
    this.shot = undefined
  }

  /** True while the camera follows the walker or the demo camera runs. */
  get cameraLocked(): boolean {
    return this.following || this.shot !== undefined
  }

  centerOn(p: LatLon, zoom?: number): void {
    const t = this.grid.toTileXY(p)
    this.camera.centerOn(t.x, t.y, zoom)
    this.requestRender()
  }

  /** The demo camera: `blend` 0 is close on the player, 1 shows the whole `bounds` (never below the quest floor). */
  autoShot(player: LatLon, bounds: BBox, blend: number, closeZoom: number): void {
    this.shot = { bounds, blend, closeZoom }
    this.applyShot(this.grid.toTileXY(player))
    this.requestRender()
  }

  private applyShot(player: Pt): void {
    const s = this.shot
    if (!s) return
    const { bounds, blend, closeZoom } = s
    this.syncSize()
    this.applyFloor()
    const a = this.grid.toTileXY({ lat: bounds.south, lon: bounds.west })
    const b = this.grid.toTileXY({ lat: bounds.north, lon: bounds.east })
    const shot = shotAt({
      blend,
      player,
      bounds: { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) },
      viewport: { w: this.cssWidth, h: this.cssHeight },
      closeZoom,
      minZoom: this.camera.minZoom,
    })
    this.camera.centerOn(shot.x, shot.y, Math.max(shot.zoom, this.camera.minZoom))
  }

  /** Fit a set of points on screen, choosing the largest zoom level that fits. */
  fit(points: LatLon[], paddingPx = 48): void {
    this.syncSize()
    this.camera.fit(points.map((p) => this.grid.toTileXY(p)), paddingPx)
    this.requestRender()
  }

  /** Step the zoom ladder, keeping the point under (sx, sy) fixed on screen. */
  zoomStep(direction: 1 | -1, sx?: number, sy?: number): void {
    this.syncSize()
    this.applyFloor()
    this.camera.zoomStep(direction, sx, sy)
    this.requestRender()
  }

  zoomTo(zoom: number, sx?: number, sy?: number): void {
    this.syncSize()
    this.applyFloor()
    this.camera.zoomTo(zoom, sx, sy)
    this.requestRender()
  }

  panBy(dxCss: number, dyCss: number): void {
    // A drag takes the camera back from the walker (the screen above also turns follow off).
    this.following = false
    this.shot = undefined
    this.syncSize()
    this.camera.panBy(dxCss, dyCss)
    this.requestRender()
  }

  screenToTile(sx: number, sy: number): Pt {
    this.syncSize()
    return this.camera.screenToTile(sx, sy)
  }

  screenToLatLon(sx: number, sy: number): LatLon {
    const t = this.screenToTile(sx, sy)
    return this.grid.tileToLatLon(t.x, t.y)
  }

  /** The part of the world on screen. */
  viewBBox(): BBox {
    const a = this.screenToLatLon(0, 0)
    const b = this.screenToLatLon(this.cssWidth, this.cssHeight)
    return { south: Math.min(a.lat, b.lat), west: Math.min(a.lon, b.lon), north: Math.max(a.lat, b.lat), east: Math.max(a.lon, b.lon) }
  }

  /** Hear where the view is after every frame that moved it (pan, zoom, follow, fit, resize), with its zoom. */
  onViewChange(fn: ((box: BBox, centre: LatLon, zoom: number) => void) | undefined): void {
    this.viewListener = fn
    this.lastViewKey = ''
    this.requestRender()
  }

  /** Preview a time of day for the lighting only (minutes after local midnight), or undefined for real time. */
  setClockOverride(minutes: number | undefined): void {
    this.lightingLayer.setClockOverride(minutes)
    this.sceneDirty = true
    this.requestRender()
  }

  /** Light the map as at this moment (epoch ms; the demo run's dusk), or undefined for the usual clock. */
  setClockAt(ms: number | undefined): void {
    this.lightingLayer.setClockAt(ms)
    this.sceneDirty = true
    this.requestRender()
  }

  /** Current lighting from the real (or overridden) clock and the map's location; recomputed at most once per 30 s. */
  get lighting(): Lighting {
    return this.lightingLayer.lighting
  }

  /** How often the overviews were built whole (tests: a new cell repaints only its rectangle). */
  get overviewBuilds(): { town: number; far: number } {
    return this.chunks.overviewBuilds
  }

  /** Chunks painted so far (tests and diagnostics). */
  get chunkCount(): number {
    return this.chunks.chunkCount
  }

  requestRender(): void {
    this.lightingLayer.start()
    this.scheduler.request()
  }

  /** Draw now instead of at the next animation frame (a resize callback runs before paint, so no stretched frame is ever shown). */
  renderNow(): void {
    this.scheduler.cancel()
    this.render()
  }

  dispose(): void {
    this.scheduler.cancel()
    this.stopPixelRatio()
    this.stopSource()
    this.stopLod?.()
    this.viewListener = undefined
    this.lightingLayer.dispose()
    this.decor.dispose()
    this.stopSightWatch()
    this.chunks.dispose()
    this.overlay.dispose()
    if (this.scene) releaseCanvas(this.scene.canvas)
    this.scene = undefined
  }

  render(): void {
    const css = this.measure()
    const resized = this.syncSize()
    const b = backingSize(css.w, css.h, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)
    if (resized) this.camera.clamp()
    this.applyFloor()
    if (b.w > 0 && b.h > 0 && (this.canvas.width !== b.w || this.canvas.height !== b.h)) {
      this.canvas.width = b.w
      this.canvas.height = b.h
    }
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    this.stats.frames++

    // One clock reading per frame: the camera, the walker sprite and the pickups all use it.
    const now = nowMs()
    const cam = this.camera
    const shown = this.overlay.walkerTile(now)
    if (shown && this.shot) this.applyShot(shown)
    else if (shown && this.following) cam.centerOn(shown.x, shown.y)

    const { w, h } = b
    const scale = cam.zoom * b.dpr // device px per tile
    const v = this.view
    v.w = w
    v.h = h
    v.dpr = b.dpr
    v.zoom = cam.zoom
    v.cssW = css.w
    v.cssH = css.h
    v.scale = scale
    v.originX = Math.round(w / 2 - cam.x * scale)
    v.originY = Math.round(h / 2 - cam.y * scale)
    v.camX = cam.x
    v.camY = cam.y
    v.detail = cam.zoom >= DETAIL_ZOOM

    const light = this.lightingLayer.lighting
    const at = this.updateScene(v, light)
    if (at) ctx.drawImage(this.scene!.canvas, at.sx, at.sy, w, h, 0, 0, w, h)
    // The sparse part of the work, once per idle moment: one ring chunk per frame, outside any scene redraw.
    if (!this.sceneDirty && this.chunks.prefetchStep()) this.requestRender()

    this.decor.drawAnimated(ctx, v, light, now, shown)
    // Diagnostics for browser checks: decor items on screen (still, moving).
    const dc = `${this.decor.stats.onScreen},${this.decor.stats.animated}`
    if (this.canvas.dataset && this.canvas.dataset.decor !== dc) this.canvas.dataset.decor = dc
    // Sights standing on the map and drawn in the last scene paint.
    const sg = `${this.sights.stats.placed},${this.sights.stats.drawn}`
    if (this.canvas.dataset && this.canvas.dataset.sights !== sg) this.canvas.dataset.sights = sg
    if (this.overlay.draw(ctx, v, light, now)) this.requestRender()
    this.reportView(v)
  }

  /**
   * Make the cached scene fit this view: draw it again when something it shows changed, the zoom or size
   * changed, or the camera left its margin; otherwise it is reused as it is. Returns where the screen
   * window starts inside the scene canvas.
   */
  private updateScene(v: View, light: Lighting): { sx: number; sy: number } | undefined {
    const margin = sceneMargin(v.w, v.h)
    let s = this.scene
    const fits =
      s !== undefined &&
      !this.sceneDirty &&
      s.light === light &&
      s.margin === margin &&
      s.w === v.w + 2 * margin &&
      s.h === v.h + 2 * margin &&
      s.scale === v.scale &&
      s.dpr === v.dpr &&
      s.zoom === v.zoom &&
      Math.abs(v.originX - s.originX) <= margin &&
      Math.abs(v.originY - s.originY) <= margin
    if (!fits) {
      if (v.w <= 0 || v.h <= 0) return undefined
      const w = v.w + 2 * margin
      const h = v.h + 2 * margin
      if (!s || s.w !== w || s.h !== h) {
        if (s) releaseCanvas(s.canvas)
        const canvas = makeCanvas(w, h)
        const sctx = canvas.getContext('2d', { alpha: false })
        if (!sctx) return undefined
        s = { canvas, ctx: sctx, w, h, margin, scale: 0, dpr: 0, zoom: 0, originX: 0, originY: 0, light }
        this.scene = s
      }
      s.margin = margin
      s.scale = v.scale
      s.dpr = v.dpr
      s.zoom = v.zoom
      s.originX = v.originX
      s.originY = v.originY
      s.light = light
      this.sceneDirty = false
      this.stats.sceneDraws++
      const stand = this.paintScene(s, v, light)
      // Chunks that did not fit in the frame budget are stand-ins for now: draw the scene again next frame.
      if (stand) {
        this.sceneDirty = true
        this.requestRender()
      }
    }
    const s2 = this.scene!
    return { sx: s2.margin - (v.originX - s2.originX), sy: s2.margin - (v.originY - s2.originY) }
  }

  /** Everything under the overlay, drawn into the scene canvas (which is `margin` px larger than the screen on every side). Returns true while stand-ins remain. */
  private paintScene(s: Scene, screen: View, light: Lighting): boolean {
    const ctx = s.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    const m = s.margin
    // The view of the scene canvas: the same map position, the screen window shifted by the margin.
    const v: View = { ...screen, w: s.w, h: s.h, cssW: s.w / screen.dpr, cssH: s.h / screen.dpr, originX: screen.originX + m, originY: screen.originY + m, inset: m }
    const scale = v.scale

    // Ground colour (never black) where nothing is loaded; the loaded area is a shade lighter. In a
    // streamed world the tiles without data are left clear by the layers, so this shows through there.
    ctx.fillStyle = P.groundB
    ctx.fillRect(0, 0, v.w, v.h)
    if (!this.grid.covered) {
      ctx.fillStyle = P.groundA
      ctx.fillRect(v.originX, v.originY, Math.round(this.grid.cols * scale), Math.round(this.grid.rows * scale))
    }

    let frame: ReturnType<ChunkLayer['draw']> | undefined
    if (v.detail) {
      frame = this.chunks.draw(ctx, v)
      this.chunks.drawWater(ctx, v, frame.plan)
    } else {
      // Far out: the simplified map (streets, water, parks; no houses), quick for a whole world on screen.
      this.chunks.drawOverview(ctx, v, v.zoom <= FAR_ZOOM)
    }
    // A source whose frame moved describes another grid until the map view rebuilds this renderer.
    const current = this.source.grid === this.grid
    const loading = current ? this.source.loading() : []
    if (loading.length) drawLoading(ctx, v, loading)
    const edges = current ? this.source.frontier?.() : undefined
    if (edges?.length) drawFrontier(ctx, v, edges)
    // Far out, the z14 tiles around the hero in their LOD look, over the coarse map, the stipple and the fog (each bitmap is opaque).
    if (this.lod && v.zoom <= FAR_ZOOM) this.lod.drawBlocks(ctx, v, this.grid, this.grid.tileToLatLon(v.camX, v.camY))

    // Tram, metro and train tracks above ground.
    if (this.grid.rails.length) drawRails(ctx, v, this.grid.rails, this.grid.cols, this.grid.rows)

    // Halloween decor: still items under the sky tint, so the night tints them too.
    if (frame) this.decor.drawStatic(ctx, v, frame.plan, frame.painted, light)
    if (frame) this.sights.drawStatic(ctx, v, frame.painted)
    // Day cycle: multiply the map by the sky tint, then add window and lamp light. The route,
    // gems and walker are drawn afterwards, so they keep their full colours.
    if (light.darkness > 0.005) {
      this.lightingLayer.drawTint(ctx, v, light)
      if (frame) this.lightingLayer.drawNightLights(ctx, v, frame.plan, frame.painted, light)
      else this.lightingLayer.drawNightDots(ctx, v, light)
      if (frame) this.decor.drawNight(ctx, v, light)
      if (frame) this.sights.drawNight(ctx, v, light, frame.painted)
    } else this.lightingLayer.idle()
    if (frame) this.sights.drawLabels(ctx, v, frame.painted)
    // Street names last: they are signs, not part of the lit map.
    this.lod?.drawLabels(ctx, v, this.grid)
    return frame?.pending ?? false
  }

  private reportView(v: View): void {
    const fn = this.viewListener
    if (!fn || v.cssW <= 0 || v.cssH <= 0) return
    const key = `${v.camX},${v.camY},${v.zoom},${v.cssW},${v.cssH}`
    if (key === this.lastViewKey) return
    this.lastViewKey = key
    fn(this.viewBBox(), this.grid.tileToLatLon(v.camX, v.camY), v.zoom)
  }
}
