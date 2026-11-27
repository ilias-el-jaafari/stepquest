import type { LatLon } from '../geo/geo.ts'
import type { Route } from '../routing/planner.ts'
import { cumulativeDistances } from '../routing/checkpoints.ts'
import type { TileGrid } from '../tiles/grid.ts'
import { drawBubble, type Anchor } from './bubble.ts'
import type { Lighting } from './daylight.ts'
import { makeCanvas, nowMs, prefersReducedMotion, releaseCanvas } from './env.ts'
import { FootprintLayer } from './footprintLayer.ts'
import type { LightingLayer } from './lightingLayer.ts'
import { WALKER_RGB } from './lights.ts'
import { P } from './palette.ts'
import { routeCells, smoothPolyline } from './routePath.ts'
import { CHECKPOINT, FINISH_FLAG, facingFrom, paintSprite, START_MAT, walkFrame, WALKER, type Facing, type Sprite } from './sprites.ts'
import { artUnit, drawAvoided } from './streetMarks.ts'
import { screenX, screenY, type View } from './view.ts'
import { WalkerMotion } from './walkerMotion.ts'
import { RouteLine, RouteWalker } from './routeWalker.ts'
import { ghostAlongM, type PacerPlan } from '../ghost/pacer.ts'
import { ghostBob, ghostPhase, ghostSprite, type GhostPose } from '../ghost/art.ts'

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
  /** Simulated walk: the hero's real speed in m/s (walking speed times time scale). Absent for real GPS. */
  simMps?: number
  /** Real GPS: the hero is off the route line and is drawn where the fix is. */
  offRoute?: boolean
  /** The guide ghost that paces the walk, when there is one. */
  ghost?: { plan: PacerPlan; pose: GhostPose }
}

export const PICKUP_MS = 900
/** Wisp is drawn this much larger than a tile sprite, so it reads next to the hero. */
export const GHOST_SCALE = 1.5

type TilePts = { x: number; y: number }[]

/**
 * Everything drawn over the tinted map: avoided-street tape, the footprint route, numbered gems,
 * start mat, finish flag, the walker with its glow, accuracy halo and speech bubble, and the pickup
 * sparkles. Route and walker keep their full colours at night because they come after the tint.
 */
export class OverlayLayer {
  private route: RouteShape | undefined
  private readonly trail = new FootprintLayer()
  private walked: FootprintLayer[] = []
  private walkedSource: QuestOverlay['walkedBefore']
  /** Avoided streets in tile coordinates. */
  private avoided: TilePts[] = []
  private markers: Markers = {}
  private quest: QuestOverlay | undefined
  private bubble: string | undefined
  private pickups: { point: LatLon; t0: number }[] = []
  private walkerSprites: Record<Facing, Sprite[]> = WALKER
  private readonly sprites = new Map<Sprite, HTMLCanvasElement>()
  readonly walker = new WalkerMotion()
  /** The hero's progress along the route (monotonic; constant pace in a simulation). */
  private readonly routed = new RouteWalker()
  private line: RouteLine | undefined
  private facing: Facing = 'down'
  private placedAt = NaN
  private placedValue: { x: number; y: number; moving: boolean; facing: Facing } | undefined

  private readonly grid: TileGrid
  private readonly lighting: LightingLayer

  constructor(grid: TileGrid, lighting: LightingLayer) {
    this.grid = grid
    this.lighting = lighting
  }

  setRoute(route: RouteShape | undefined): void {
    this.route = route
    const cells = route ? routeCells(route.points.map((p) => this.grid.toTileXY(p)), cumulativeDistances(route.points)) : []
    this.trail.setLine(smoothPolyline(cells))
    const total = route ? (cumulativeDistances(route.points).at(-1) ?? 0) : 0
    this.line = route && route.points.length > 1 ? new RouteLine(route.points.map((p) => this.grid.toTileXY(p)), total) : undefined
    this.routed.setLine(this.line)
    this.placedAt = NaN
  }

  /** Streets on the user's avoid list, drawn as hazard tape under the route. */
  setAvoided(lines: readonly (readonly LatLon[])[]): void {
    this.avoided = lines.filter((l) => l.length > 0).map((l) => l.map((p) => this.grid.toTileXY(p)))
  }

  /** Dress the walker (sprites for the four directions). */
  setWalker(sprites: Record<Facing, Sprite[]>): void {
    if (sprites === this.walkerSprites) return
    for (const frames of Object.values(this.walkerSprites)) {
      for (const f of frames) {
        const c = this.sprites.get(f)
        if (c) releaseCanvas(c)
        this.sprites.delete(f)
      }
    }
    this.walkerSprites = sprites
  }

  setMarkers(markers: Markers): void {
    this.markers = markers
  }

  setBubble(text: string | undefined): boolean {
    if (text === this.bubble) return false
    this.bubble = text
    return true
  }

  setQuest(quest: QuestOverlay | undefined): void {
    const prev = this.quest?.player
    if (quest?.walkedBefore !== this.walkedSource) {
      this.walkedSource = quest?.walkedBefore
      this.walked = (quest?.walkedBefore ?? [])
        .filter((l) => l.length > 1)
        .map((l) => {
          const layer = new FootprintLayer()
          layer.setLine(smoothPolyline(routeCells(l.map((p) => this.grid.toTileXY(p)), cumulativeDistances([...l]))))
          return layer
        })
    }
    this.quest = quest
    this.routed.setSim(quest?.simMps)
    if (quest?.player) this.routed.observe(quest.alongM, nowMs())
    this.placedAt = NaN
    const next = quest?.player
    if (next) this.walker.moveTo(this.grid.toTileXY(next), prev ? this.grid.toTileXY(prev) : undefined, nowMs(), prefersReducedMotion())
  }

  /** Where the walker is shown at `now` (tile units) while a quest runs; undefined outside one. */
  walkerTile(now: number): { x: number; y: number } | undefined {
    return this.placed(now)
  }

  /** The hero as shown at `now`: on the route line (constant pace in a simulation, never back with GPS) or at the fix when off it. */
  private placed(now: number): { x: number; y: number; moving: boolean; facing: Facing } | undefined {
    const q = this.quest
    if (!q?.player) return undefined
    if (now === this.placedAt) return this.placedValue
    const reduced = prefersReducedMotion()
    const glide = this.walker.position(now)
    const sim = this.routed.isSim
    let out: { x: number; y: number; moving: boolean; facing: Facing } | undefined
    if (sim || !q.offRoute) {
      const r = this.routed.at(now, glide)
      if (r) {
        this.facing = facingFrom(r.dx, r.dy, this.facing, 1e-6)
        out = { x: r.x, y: r.y, moving: !reduced && (sim ? r.moving : r.moving || this.walker.isWalking(now, reduced)), facing: this.facing }
      }
    }
    if (!out && glide) out = { x: glide.x, y: glide.y, moving: this.walker.isWalking(now, reduced), facing: this.walker.facing }
    this.placedAt = now
    this.placedValue = out
    return out
  }

  /** Start the sparkle animation for a collected checkpoint. */
  pickup(point: LatLon): void {
    this.pickups.push({ point, t0: nowMs() })
  }

  private sprite(sprite: Sprite): HTMLCanvasElement {
    let c = this.sprites.get(sprite)
    if (!c) {
      c = makeCanvas(16, 16)
      paintSprite(c.getContext('2d')!, sprite, 0, 0)
      this.sprites.set(sprite, c)
    }
    return c
  }

  /** Draw avoided tape, route, gems, walker, bubble and pickups. Returns true when another frame is needed. */
  draw(ctx: CanvasRenderingContext2D, v: View, light: Lighting, now: number = nowMs()): boolean {
    let animating = false
    if (this.avoided.length) drawAvoided(ctx, v, this.avoided)

    // Route: red pixel footprints along the path (darker where already walked).
    if (!this.trail.isEmpty || this.walked.length) {
      const px = artUnit(v)
      // Walked stretches of routes left behind by a reroute: all walked, under the current route.
      for (const layer of this.walked) layer.draw(ctx, v, px, Infinity)
      this.trail.draw(ctx, v, px, this.quest?.alongM ?? -1)
    }

    const spriteScale = Math.max(1, Math.round((v.zoom >= 16 ? v.zoom / 16 : 1.5) * v.dpr))
    const drawSprite = (sprite: Sprite, p: LatLon, anchorY = 0.85): Anchor => {
      const t = this.grid.toTileXY(p)
      const sx = screenX(v, t.x)
      const sy = screenY(v, t.y)
      const size = 16 * spriteScale
      if (sprite === CHECKPOINT && light.lamps > 0.02) {
        ctx.globalCompositeOperation = 'lighter'
        this.lighting.drawGlow(ctx, sx, sy - size * 0.4, 2.4, v.scale, WALKER_RGB, light.lamps * 0.8)
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.drawImage(this.sprite(sprite), Math.round(sx - size / 2), Math.round(sy - size * anchorY), size, size)
      return { x: sx, y: sy, size }
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
          const r = Math.max(4, (acc / this.grid.metresPerTile) * v.scale)
          ctx.fillStyle = 'rgba(74, 143, 240, 0.18)'
          ctx.strokeStyle = 'rgba(44, 95, 184, 0.7)'
          ctx.lineWidth = Math.max(1, Math.round(v.dpr))
          ctx.beginPath()
          ctx.arc(Math.round(screenX(v, t.x)), Math.round(screenY(v, t.y)), r, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
        animating ||= this.drawGhost(ctx, v, spriteScale, light, now)
        const w = this.drawWalker(ctx, v, player, spriteScale, light, now)
        animating ||= w.animating
        if (this.bubble) drawBubble(ctx, this.bubble, w.at, v.dpr, v.w, v.h)
      }
    } else {
      if (this.markers.end) drawSprite(FINISH_FLAG, this.markers.end, 0.9)
      if (this.markers.start) {
        drawSprite(START_MAT, this.markers.start, 0.75)
        const w = this.drawWalker(ctx, v, this.markers.start, spriteScale, light, now)
        animating ||= w.animating
        if (this.bubble) drawBubble(ctx, this.bubble, w.at, v.dpr, v.w, v.h)
      }
    }

    // Pickup animation: the gem jumps up and bursts into stepped sparkles.
    if (this.pickups.some((p) => now - p.t0 >= PICKUP_MS)) this.pickups = this.pickups.filter((p) => now - p.t0 < PICKUP_MS)
    for (const p of this.pickups) {
      const k = (now - p.t0) / PICKUP_MS
      const t = this.grid.toTileXY(p.point)
      const sx = screenX(v, t.x)
      const sy = screenY(v, t.y)
      const unit = spriteScale
      const rise = Math.round(Math.sin(Math.min(1, k * 1.4) * Math.PI) * 14) * unit
      if (k < 0.6) {
        const size = 16 * unit
        ctx.drawImage(this.sprite(CHECKPOINT), Math.round(sx - size / 2), Math.round(sy - size - rise), size, size)
      }
      const spread = Math.round(k * 18) * unit
      ctx.fillStyle = Math.floor(k * 10) % 2 ? P.routeGlow : P.white
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const px = Math.round(sx + Math.cos(a) * spread)
        const py = Math.round(sy - 8 * unit + Math.sin(a) * spread)
        const d = Math.max(1, Math.round((1 - k) * 3)) * unit
        ctx.fillRect(px - d / 2, py - d / 2, d, d)
      }
    }
    return animating || this.pickups.length > 0
  }

  private drawWalker(ctx: CanvasRenderingContext2D, v: View, p: LatLon, spriteScale: number, light: Lighting, now: number): { at: Anchor; animating: boolean } {
    const target = this.grid.toTileXY(p)
    // Outside a quest (planning screen) the walker just stands at the start.
    const shown = this.placed(now)
    const pos = shown ?? target
    const moving = shown?.moving ?? false
    const frames = this.walkerSprites[shown ? shown.facing : 'down']
    const sprite = frames[walkFrame(now, moving)] ?? frames[0]!
    const sx = screenX(v, pos.x)
    const sy = screenY(v, pos.y)
    const size = 16 * spriteScale
    // A small lantern glow keeps the walker clear of the dark.
    if (light.lamps > 0.02) {
      ctx.globalCompositeOperation = 'lighter'
      this.lighting.drawGlow(ctx, sx, sy - size * 0.4, 4, v.scale, WALKER_RGB, light.lamps * 0.9)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.drawImage(this.sprite(sprite), Math.round(sx - size / 2), Math.round(sy - size), size, size)
    return { at: { x: sx, y: sy, size }, animating: moving || (shown !== undefined && (this.routed.isMoving(now) || this.walker.isTweening(now))) }
  }

  /** The guide ghost on the route, a little ahead of the pace point. Only sprite blits and one glow. Returns true while it moves or bobs. */
  private drawGhost(ctx: CanvasRenderingContext2D, v: View, spriteScale: number, light: Lighting, now: number): boolean {
    const g = this.quest?.ghost
    const line = this.line
    if (!g || !line) return false
    const reduced = prefersReducedMotion()
    const along = ghostAlongM(g.plan, now, line.totalM)
    const at = line.pointAt(along)
    const sx = screenX(v, at.x)
    const sy = screenY(v, at.y)
    const size = 16 * spriteScale * GHOST_SCALE
    const bob = ghostBob(now, reduced) * spriteScale
    // Slightly ahead of the ground, as if floating; mirrored when it heads left so the lantern leads.
    const lift = Math.round(size * 0.12)
    const left = at.dx < 0
    const sprite = this.sprite(ghostSprite(g.pose, reduced ? 0 : ghostPhase(now)))
    if (light.lamps > 0.02) {
      ctx.globalCompositeOperation = 'lighter'
      this.lighting.drawGlow(ctx, sx, sy - size * 0.5, 5 * GHOST_SCALE, v.scale, WALKER_RGB, light.lamps * 0.5)
      ctx.globalCompositeOperation = 'source-over'
    }
    const dx = Math.round(sx - size / 2)
    const dy = Math.round(sy - size - lift - bob)
    if (left) {
      ctx.save()
      ctx.translate(dx + size, dy)
      ctx.scale(-1, 1)
      ctx.drawImage(sprite, 0, 0, size, size)
      ctx.restore()
    } else ctx.drawImage(sprite, dx, dy, size, size)
    // Keep drawing while the pace point moves (it always does until the finish) or the ghost bobs.
    return !reduced || along < line.totalM
  }

  dispose(): void {
    for (const c of this.sprites.values()) releaseCanvas(c)
    this.sprites.clear()
  }
}
