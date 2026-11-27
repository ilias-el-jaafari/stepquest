/**
 * Where a landmark's name goes so that all of it stays on the screen (landmarks spec, task 91.2). The name
 * is centred under the sprite; it is slid sideways to stay inside the view, and put above the sprite when
 * the room below runs out. Pure.
 */
export type LabelFit = { x: number; y: number }

/** `cx` is the sprite's centre, `spriteTop` and `spriteBottom` its vertical extent; `x` is the label's centre. */
export function fitLabel(cx: number, spriteTop: number, spriteBottom: number, textW: number, font: number, viewW: number, viewH: number, margin: number, gap: number): LabelFit {
  const half = textW / 2
  const lo = margin + half
  const hi = viewW - margin - half
  // A name wider than the view is centred (it cannot fit; the caller shortens it first).
  const x = lo > hi ? viewW / 2 : Math.min(hi, Math.max(lo, cx))
  let y = spriteBottom + gap
  if (y + font + margin > viewH) y = spriteTop - gap - font
  y = Math.min(viewH - margin - font, Math.max(margin, y))
  return { x, y }
}
