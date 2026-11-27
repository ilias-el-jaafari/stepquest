import { wrapBubbleText } from '../audio/speechBubble.ts'
import { P } from './palette.ts'

export type Box = { x: number; y: number; w: number; h: number }

export type Anchor = { x: number; y: number; size: number }

let lastWrap: { text: string; maxChars: number; lines: string[] } | undefined
function wrap(text: string, maxChars: number): string[] {
  if (lastWrap?.text === text && lastWrap.maxChars === maxChars) return lastWrap.lines
  const lines = wrapBubbleText(text, maxChars)
  lastWrap = { text, maxChars, lines }
  return lines
}

/** Pixel-art speech bubble: ink outline with notched corners, paper fill, blue rule, a tail to the walker. `w`, `h` are device px. */
export function drawBubble(ctx: CanvasRenderingContext2D, text: string, at: Anchor, dpr: number, w: number, h: number, avoid?: Box): void {
  const px = Math.max(1, Math.round(dpr)) // one "art pixel"
  const font = 8 * px
  const margin = 4 * px
  ctx.font = `${font}px "Press Start 2P", monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const maxChars = Math.max(10, Math.min(22, Math.floor((w * 0.62) / font)))
  const lines = wrap(text, maxChars)
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
  // Keep clear of the ghost: try the other side of the walker, then above the ghost.
  if (avoid && overlaps(x, y, bw, bh, avoid)) {
    const otherX = x > at.x ? Math.round(at.x - at.size * 0.3 - bw) : Math.round(at.x + at.size * 0.3)
    const cx = Math.max(margin, Math.min(w - bw - margin, otherX))
    if (!overlaps(cx, y, bw, bh, avoid)) x = cx
    else {
      const above = Math.round(avoid.y - bh - 2 * px)
      if (above >= margin) y = above
      else y = Math.min(h - bh - margin - 6 * px, Math.round(avoid.y + avoid.h + 2 * px))
    }
  }
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

function overlaps(x: number, y: number, bw: number, bh: number, b: Box): boolean {
  return x < b.x + b.w && x + bw > b.x && y < b.y + b.h && y + bh > b.y
}
