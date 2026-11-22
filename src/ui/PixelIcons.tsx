import type { Sprite } from '../render/sprites.ts'
import { ICONS, type Icon } from './pixelArt.ts'

export type IconName = keyof typeof ICONS

/** Draw a pixel grid as crisp SVG rectangles (one per run of equal pixels in a row). */
export function PixelSvg({ art, size, className }: { art: Icon | Sprite; size: number; className?: string }) {
  const rects: { x: number; y: number; w: number; c: string }[] = []
  art.rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x] ?? '.'
      let w = 1
      while (row[x + w] === ch) w++
      const c = art.colors[ch]
      if (c) rects.push({ x, y, w, c })
      x += w
    }
  })
  const cols = Math.max(...art.rows.map((r) => r.length))
  return (
    <svg className={className} viewBox={`0 0 ${cols} ${art.rows.length}`} width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      {rects.map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
      ))}
    </svg>
  )
}

export function PixelIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <PixelSvg art={ICONS[name]} size={size} className="pixel-icon" />
}
