import { DETAIL_ZOOM } from './camera.ts'
import { hazardStamps, midpoint, NO_ENTRY } from './hazard.ts'
import { P } from './palette.ts'
import { railStamps } from './rails.ts'
import { screenX, screenY, type View } from './view.ts'

type TilePts = readonly { x: number; y: number }[]

/** One art pixel in device px: whole pixels of the tile at detail zoom, the pixel ratio at far zoom. */
export const artUnit = (v: View): number => (v.zoom >= DETAIL_ZOOM ? Math.max(1, Math.round(v.scale / 16)) : Math.max(1, Math.round(v.dpr)))

/** Does any point of the line lie on screen (with a margin)? No allocation. */
function touchesScreen(v: View, line: TilePts, margin: number, offset: number): boolean {
  for (const p of line) {
    const x = screenX(v, p.x + offset)
    const y = screenY(v, p.y + offset)
    if (x > -margin && y > -margin && x < v.w + margin && y < v.h + margin) return true
  }
  return false
}

const toScreen = (v: View, line: TilePts, offset: number) => line.map((p) => ({ x: screenX(v, p.x + offset), y: screenY(v, p.y + offset) }))

/** Tram, metro and train tracks above ground, kept inside the loaded map. */
export function drawRails(ctx: CanvasRenderingContext2D, v: View, rails: readonly TilePts[], cols: number, rows: number): void {
  const unit = artUnit(v)
  const detail = v.zoom >= DETAIL_ZOOM
  // Gauge (between the two rails) in art pixels; a bit wider on the town map so it reads.
  const half = (detail ? 3 : 2) * unit
  const bed = half * 2 + 3 * unit
  const sleeperHalf = half + unit
  const gap = 4 * unit
  const margin = bed * 2
  const snap = (x: number) => Math.round(x / unit) * unit
  // Tracks run on past the loaded area: keep them inside the map.
  ctx.save()
  ctx.beginPath()
  ctx.rect(screenX(v, 0), screenY(v, 0), cols * v.scale, rows * v.scale)
  ctx.clip()
  for (const line of rails) {
    if (!touchesScreen(v, line, margin, 0.5)) continue
    // Stamps off screen are dropped before the five passes below.
    // Segments wholly off screen are walked along, not stamped (the sleepers keep their places along the line).
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(a.x, b.x) > -margin && Math.max(a.y, b.y) > -margin && Math.min(a.x, b.x) < v.w + margin && Math.min(a.y, b.y) < v.h + margin
    const stamps = railStamps(toScreen(v, line, 0.5), unit, gap, near).filter((s) => s.x > -margin && s.y > -margin && s.x < v.w + margin && s.y < v.h + margin)
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

/** Hazard tape along the streets on the user's avoid list, with one "no entry" sign per long stretch. */
export function drawAvoided(ctx: CanvasRenderingContext2D, v: View, avoided: readonly TilePts[]): void {
  const detail = v.zoom >= DETAIL_ZOOM
  const unit = artUnit(v)
  // Bold on the town map so it reads at a glance; one road-width band up close.
  const band = detail ? 5 * unit : Math.max(5 * unit, Math.ceil(v.scale * 1.8))
  const inner = Math.max(unit, band - 2 * unit)
  const dash = detail ? 6 * unit : Math.max(5 * unit, band * 2)
  const margin = band * 2
  const lines = avoided.filter((l) => touchesScreen(v, l, margin, 0.5)).map((l) => toScreen(v, l, 0.5))
  // Dark band with an outline, then the amber dashes.
  for (const pts of lines) {
    const stamps = hazardStamps(pts, unit, dash)
    ctx.fillStyle = P.avoidBand
    for (const s of stamps) ctx.fillRect(s.x - Math.round(band / 2), s.y - Math.round(band / 2), band, band)
    ctx.fillStyle = P.avoid
    for (const s of stamps) if (s.on) ctx.fillRect(s.x - Math.round(inner / 2), s.y - Math.round(inner / 2), inner, inner)
  }
  // One "no entry" sign per stretch long enough to carry it.
  const px = detail ? unit : Math.max(1, Math.round(v.dpr * 1.5))
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
