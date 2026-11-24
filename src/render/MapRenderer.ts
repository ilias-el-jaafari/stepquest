import type { BBox, LatLon } from '../geo/geo.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { Camera, DETAIL_ZOOM, FAR_ZOOM, ZOOM_LEVELS, type Pt } from './camera.ts'
import { drawFrontier } from './frontier.ts'
import { drawLoading } from './loading.ts'
import { questMinZoom } from '../world/window.ts'
import { isMapSource, staticSource, type MapSource } from './mapSource.ts'
import { ChunkLayer } from './chunkLayer.ts'
import type { Lighting } from './daylight.ts'
import { OverlayLayer, type Markers, type QuestOverlay, type RouteShape } from './overlayLayer.ts'
import { LightingLayer } from './lightingLayer.ts'
import { FrameScheduler } from './frameScheduler.ts'
import { P } from './palette.ts'
import type { Facing, Sprite } from './sprites.ts'
import { drawRails } from './streetMarks.ts'
import { backingSize, watchPixelRatio } from './viewport.ts'
import type { View } from './view.ts'

export { DETAIL_ZOOM, FAR_ZOOM, ZOOM_LEVELS }
export { CHUNK_BUDGET_MS, PREFETCH_MARGIN, WATER_FRAME_MS, WATER_FRAMES, waterFrame } from './chunkLayer.ts'
export type { Markers, QuestOverlay, RouteShape }

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
  private readonly stopPixelRatio: () => void
  private readonly stopSource: () => void
  private viewListener: ((box: BBox, centre: LatLon, zoom: number) => void) | undefined
  private lastViewKey = ''
  /** Last CSS size of the canvas that had a layout (kept while the canvas is hidden). */
  private lastCss: { w: number; h: number } | undefined
  private readonly view: View = { w: 0, h: 0, dpr: 1, zoom: 16, cssW: 0, cssH: 0, scale: 16, originX: 0, originY: 0, camX: 0, camY: 0, detail: true }

  constructor(canvas: HTMLCanvasElement, map: TileGrid | MapSource) {
    const source = isMapSource(map) ? map : staticSource(map)
    const grid = source.grid
    this.canvas = canvas
    this.source = source
    this.grid = grid
    this.camera = new Camera(grid.cols, grid.rows)
    const tick = () => this.requestRender()
    this.chunks = new ChunkLayer(source, tick)
    this.stopSource = source.subscribe(tick)
    this.lightingLayer = new LightingLayer(grid, this.chunks, tick)
    this.overlay = new OverlayLayer(grid, this.lightingLayer)
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
      const r = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
      this.lastCss = { w: cw > 0 ? cw : this.canvas.width / r, h: ch > 0 ? ch : this.canvas.height / r }
    }
    return this.lastCss
  }

  private questFloor = false

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

  setRoute(route: RouteShape | undefined): void {
    this.overlay.setRoute(route)
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

  /** Move the camera to a point without changing zoom (follow mode). */
  follow(p: LatLon): void {
    const t = this.grid.toTileXY(p)
    this.camera.centerOn(t.x, t.y)
    this.requestRender()
  }

  centerOn(p: LatLon, zoom?: number): void {
    const t = this.grid.toTileXY(p)
    this.camera.centerOn(t.x, t.y, zoom)
    this.requestRender()
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

  dispose(): void {
    this.scheduler.cancel()
    this.stopPixelRatio()
    this.stopSource()
    this.viewListener = undefined
    this.lightingLayer.dispose()
    this.chunks.dispose()
    this.overlay.dispose()
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

    const { w, h } = b
    const cam = this.camera
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

    // Ground colour (never black) where nothing is loaded; the loaded area is a shade lighter. In a
    // streamed world the tiles without data are left clear by the layers, so this shows through there.
    ctx.fillStyle = P.groundB
    ctx.fillRect(0, 0, w, h)
    if (!this.grid.covered) {
      ctx.fillStyle = P.groundA
      ctx.fillRect(v.originX, v.originY, Math.round(this.grid.cols * scale), Math.round(this.grid.rows * scale))
    }

    let frame: ReturnType<ChunkLayer['draw']> | undefined
    if (v.detail) {
      frame = this.chunks.draw(ctx, v)
      if (frame.pending) this.requestRender()
      this.chunks.drawWater(ctx, v, frame.plan)
    } else {
      // Far out: the simplified map (streets, water, parks; no houses), quick for a whole world on screen.
      this.chunks.drawOverview(ctx, v, cam.zoom <= FAR_ZOOM)
    }
    // A source whose frame moved describes another grid until the map view rebuilds this renderer.
    const current = this.source.grid === this.grid
    const loading = current ? this.source.loading() : []
    if (loading.length) drawLoading(ctx, v, loading)
    const edges = current ? this.source.frontier?.() : undefined
    if (edges?.length) drawFrontier(ctx, v, edges)

    // Tram, metro and train tracks above ground.
    if (this.grid.rails.length) drawRails(ctx, v, this.grid.rails, this.grid.cols, this.grid.rows)

    // Day cycle: multiply the map by the sky tint, then add window and lamp light. The route,
    // gems and walker are drawn afterwards, so they keep their full colours.
    const light = this.lightingLayer.lighting
    if (light.darkness > 0.005) {
      this.lightingLayer.drawTint(ctx, v, light)
      if (frame) this.lightingLayer.drawNightLights(ctx, v, frame.plan, frame.painted, light)
    }

    if (this.overlay.draw(ctx, v, light)) this.requestRender()
    this.reportView(v)
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
