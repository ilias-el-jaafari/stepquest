/**
 * Street-name labels (requirement 25.6). Pure: lines in device px in, placed boxes out. The pixel font is square, so a text of
 * `n` characters is `n × fontPx` wide and `fontPx` high.
 */

export type LabelLine = {
  text: string
  /** Higher is placed first. */
  rank: number
  /** x, y pairs in device px, in street order. */
  pts: readonly number[]
}

export type Placed = { text: string; x: number; y: number; w: number; h: number; vertical: boolean; rank: number }

export type LayoutOptions = {
  /** Visible window in device px: a label lies wholly inside it. */
  width: number
  height: number
  /** Font size in device px. */
  fontPx: number
  /** Empty px kept around a label (2 CSS px). */
  gap: number
  /** The same name is not placed twice closer than this between centres (160 CSS px). */
  sameNameGap: number
  max: number
}

/** Most labels in one view. */
export const MAX_LABELS = 60
/** Streets steeper than this from the horizontal turn the label by 90°; flatter ones keep it level. A window must be within this of an axis. */
const MAX_TILT_DEG = 35

export const labelWidth = (text: string, fontPx: number): number => text.length * fontPx

const polylineLength = (pts: readonly number[]): number => {
  let s = 0
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)
  return s
}

/** Point at distance `s` along the polyline, with the index of the segment it lies on. */
function pointAt(pts: readonly number[], s: number): { x: number; y: number } {
  let left = s
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i]! - pts[i - 2]!
    const dy = pts[i + 1]! - pts[i - 1]!
    const len = Math.hypot(dx, dy)
    if (left <= len || i === pts.length - 2) {
      const t = len === 0 ? 0 : Math.min(1, left / len)
      return { x: pts[i - 2]! + dx * t, y: pts[i - 1]! + dy * t }
    }
    left -= len
  }
  return { x: pts[0]!, y: pts[1]! }
}

/** Largest distance from the points of the polyline between distances `a` and `b` to the chord between them. */
function deviation(pts: readonly number[], a: number, b: number): number {
  const p = pointAt(pts, a)
  const q = pointAt(pts, b)
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy) || 1
  let worst = 0
  let at = 0
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)
    const s0 = at
    at += seg
    if (at <= a || s0 >= b) continue
    const x = pts[i]!
    const y = pts[i + 1]!
    worst = Math.max(worst, Math.abs((x - p.x) * dy - (y - p.y) * dx) / len)
  }
  return worst
}

/** A spatial hash of placed boxes. */
class Grid {
  private readonly cells = new Map<number, Placed[]>()
  private readonly size = 64
  private key(cx: number, cy: number): number {
    return cy * 100_003 + cx
  }
  add(b: Placed, pad: number): void {
    for (let cy = Math.floor((b.y - pad) / this.size); cy <= Math.floor((b.y + b.h + pad) / this.size); cy++) {
      for (let cx = Math.floor((b.x - pad) / this.size); cx <= Math.floor((b.x + b.w + pad) / this.size); cx++) {
        const k = this.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(b)
        else this.cells.set(k, [b])
      }
    }
  }
  hits(x: number, y: number, w: number, h: number, pad: number): boolean {
    for (let cy = Math.floor((y - pad) / this.size); cy <= Math.floor((y + h + pad) / this.size); cy++) {
      for (let cx = Math.floor((x - pad) / this.size); cx <= Math.floor((x + w + pad) / this.size); cx++) {
        for (const o of this.cells.get(this.key(cx, cy)) ?? []) {
          if (x < o.x + o.w + pad && o.x < x + w + pad && y < o.y + o.h + pad && o.y < y + h + pad) return true
        }
      }
    }
    return false
  }
}

/**
 * Place labels: higher rank first, then the longer street, then the text (so the result does not depend on the input order).
 * A label sits on a stretch of its street that is as long as the text and runs within `MAX_TILT_DEG` of horizontal (level text)
 * or of vertical (turned 90°), hugging the line, wholly inside the window, not touching a placed label (gap) and not within
 * `sameNameGap` of the same name. Of the stretches that qualify the first one from the middle of the visible street outwards wins.
 */
export function layoutLabels(lines: readonly LabelLine[], o: LayoutOptions): Placed[] {
  const grid = new Grid()
  const placed: Placed[] = []
  const sorted = lines
    .filter((l) => l.pts.length >= 4 && l.text.length > 0)
    .map((l) => ({ l, len: polylineLength(l.pts) }))
    .sort((a, b) => b.l.rank - a.l.rank || b.len - a.len || (a.l.text < b.l.text ? -1 : a.l.text > b.l.text ? 1 : 0) || a.l.pts[0]! - b.l.pts[0]! || a.l.pts[1]! - b.l.pts[1]!)
  const tilt = Math.tan((MAX_TILT_DEG * Math.PI) / 180)
  for (const { l, len } of sorted) {
    if (placed.length >= o.max) break
    const tw = labelWidth(l.text, o.fontPx)
    if (len < tw) continue
    const steps = Math.max(1, Math.min(24, Math.floor((len - tw) / Math.max(4, tw / 4))))
    const mid = (len - tw) / 2
    // Try the middle first, then outwards.
    const offsets: number[] = [mid]
    for (let k = 1; k <= steps; k++) {
      const d = ((len - tw) / 2 / steps) * k
      offsets.push(mid - d, mid + d)
    }
    for (const a of offsets) {
      if (a < -1e-6 || a + tw > len + 1e-6) continue
      const p = pointAt(l.pts, a)
      const q = pointAt(l.pts, a + tw)
      const dx = q.x - p.x
      const dy = q.y - p.y
      const horizontal = Math.abs(dy) <= Math.abs(dx) * tilt
      const vertical = Math.abs(dx) <= Math.abs(dy) * tilt
      if (!horizontal && !vertical) continue
      if (deviation(l.pts, a, a + tw) > o.fontPx * 0.75) continue
      const cx = (p.x + q.x) / 2
      const cy = (p.y + q.y) / 2
      const w = horizontal ? tw : o.fontPx
      const h = horizontal ? o.fontPx : tw
      const x = Math.round(cx - w / 2)
      const y = Math.round(cy - h / 2)
      if (x < 0 || y < 0 || x + w > o.width || y + h > o.height) continue
      if (grid.hits(x, y, w, h, o.gap)) continue
      if (placed.some((b) => b.text === l.text && Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) < o.sameNameGap)) continue
      const box: Placed = { text: l.text, x, y, w, h, vertical: !horizontal, rank: l.rank }
      grid.add(box, o.gap)
      placed.push(box)
      break
    }
  }
  return placed
}
