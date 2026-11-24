/**
 * Console-button colours, mirrored from the CSS variables in `src/index.css`
 * (a test checks both agree). Every label is ink, so each fill must give the ink
 * label a contrast of at least 4.5:1 (WCAG AA for normal text).
 */
export type ButtonColor = { fill: string; hi: string; lo: string }

export const INK = '#1b1a2e'

export const BUTTON_COLORS = {
  sky: { fill: '#5fc1ff', hi: '#c4ecff', lo: '#2a7fc4' },
  gold: { fill: '#ffd84a', hi: '#fff3a8', lo: '#c99a10' },
  coral: { fill: '#ff4f6d', hi: '#ffb0bd', lo: '#a8304a' },
  mint: { fill: '#4be0b8', hi: '#b8fff0', lo: '#12997f' },
  orange: { fill: '#ff9a3d', hi: '#ffd3a0', lo: '#b34a10' },
  grey: { fill: '#c9c6d8', hi: '#eceaf5', lo: '#8a879f' },
} as const satisfies Record<string, ButtonColor>

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio of two `#rrggbb` colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Corner staircase of the pill and round buttons: row `k` (3 px tall, counted from
 * the top) is indented by `CORNER_STEPS[k]` px. On a 48 px button that is a full pill;
 * on a 48 px square it is a circle.
 */
export const CORNER_STEP_PX = 3
export const CORNER_STEPS = [15, 9, 6, 3, 3] as const

/** The `clip-path` polygon for that staircase, as written in the CSS. */
export function stepPolygon(steps: readonly number[] = CORNER_STEPS, row = CORNER_STEP_PX): string {
  const n = steps.length
  const px = (v: number) => (v === 0 ? '0' : `${v}px`)
  const fromEnd = (v: number, end: '100%') => (v === 0 ? end : `calc(${end} - ${v}px)`)
  // One corner as (distance from the side, distance from the top or bottom), walked from the top edge down to the side.
  const corner: [number, number][] = []
  steps.forEach((o, k) => {
    corner.push([o, k * row], [o, (k + 1) * row])
  })
  corner.push([0, n * row])
  const pts: string[] = []
  const add = (x: string, y: string) => pts.push(`${x} ${y}`)
  // top-right, walking down
  for (const [dx, dy] of corner) add(fromEnd(dx, '100%'), px(dy))
  // bottom-right, walking from the side down to the bottom edge
  for (const [dx, dy] of [...corner].reverse()) add(fromEnd(dx, '100%'), fromEnd(dy, '100%'))
  // bottom-left, walking from the bottom edge up
  for (const [dx, dy] of corner) add(px(dx), fromEnd(dy, '100%'))
  // top-left, walking from the side up to the top edge
  for (const [dx, dy] of [...corner].reverse()) add(px(dx), px(dy))
  return `polygon(${pts.join(', ')})`
}
