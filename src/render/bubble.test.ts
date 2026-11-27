import { describe, expect, it } from 'vitest'
import { drawBubble, type Box } from './bubble.ts'

/** A context that records the paper-coloured and ink fills so the bubble's outer box can be read back. */
function boxOf(avoid: Box | undefined, at = { x: 200, y: 400, size: 48 }, w = 390, h = 800) {
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] = []
  let fill = ''
  const ctx = {
    set fillStyle(v: string) {
      fill = v
    },
    set font(_: string) {},
    set textAlign(_: string) {},
    set textBaseline(_: string) {},
    fillRect: (x: number, y: number, rw: number, rh: number) => rects.push({ x, y, w: rw, h: rh, fill }),
    fillText: () => {},
  } as unknown as CanvasRenderingContext2D
  drawBubble(ctx, 'En 30 metros, gira a la izquierda', at, 1, w, h, avoid)
  // The widest ink rectangle is the outline (the shadow is translucent).
  const ink = rects.filter((r) => r.fill === '#1b1a2e' || r.fill.toLowerCase().includes('1b1a2e'))
  const outline = ink.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a), ink[0]!)
  return outline
}
const hits = (a: { x: number; y: number; w: number; h: number }, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

describe('speech bubble', () => {
  it('sits over the walker as before when there is no ghost', () => {
    const b = boxOf(undefined)
    expect(b.x).toBeGreaterThan(200)
  })
  it('steps aside so it never covers the ghost (right of the hero, left of the hero, or above)', () => {
    const base = boxOf(undefined)
    for (const ghost of [
      { x: base.x + 10, y: base.y + 5, w: 40, h: 40 },
      { x: base.x - 60, y: base.y + 5, w: 40, h: 40 },
      { x: base.x + 10, y: base.y, w: 40, h: 120 },
    ]) {
      const b = boxOf(ghost)
      expect(hits(b, ghost)).toBe(false)
    }
  })
})
