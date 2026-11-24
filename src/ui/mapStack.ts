/** Layout rules for the round map buttons (pure, no DOM). Sizes are CSS px. */

export type StackId = 'zoomIn' | 'zoomOut' | 'fit' | 'home' | 'locate'

export const STACK = {
  /** Smallest press area (`--hit`). */
  hit: 48,
  gap: 10,
  /** Distance from the top edge of the map (`.map-buttons { top }`). */
  top: 13,
  /** Free space kept under the stack. */
  bottom: 8,
  /** Height of the credit strip (`--attr-h`). */
  attr: 16,
  /** Narrowest map that still takes a second column. */
  twoColumnsFrom: 160,
} as const

/** Most important first: what stays when buttons have to be collapsed. */
export const PRIORITY: readonly StackId[] = ['zoomIn', 'zoomOut', 'locate', 'fit', 'home']

export type StackPlan = {
  columns: 1 | 2
  /** Rows of the grid (the grid fills a column first). */
  rows: number
  /** Buttons drawn in the stack, in the order given. */
  shown: StackId[]
  /** Buttons behind the "More" button (empty when everything fits). */
  more: StackId[]
}

export type StackInput = {
  width: number
  height: number
  ids: readonly StackId[]
  /** Height taken at the bottom by a HUD that overlays the map. */
  bottomReserve?: number
}

/** Buttons per column that fit in `height`. */
export function columnCapacity(height: number, bottomReserve = 0): number {
  const avail = height - STACK.top - STACK.bottom - STACK.attr - bottomReserve
  return Math.max(0, Math.floor((avail + STACK.gap) / (STACK.hit + STACK.gap)))
}

export function planStack({ width, height, ids, bottomReserve = 0 }: StackInput): StackPlan {
  const n = ids.length
  // Not measured yet: show everything.
  if (!(height > 0) || !(width > 0)) return { columns: 1, rows: n, shown: [...ids], more: [] }
  const cap = columnCapacity(height, bottomReserve)
  if (n <= cap) return { columns: 1, rows: n, shown: [...ids], more: [] }
  const two = width >= STACK.twoColumnsFrom
  if (two && n <= 2 * cap) return { columns: 2, rows: Math.ceil(n / 2), shown: [...ids], more: [] }
  const columns = two ? 2 : 1
  // One slot goes to the More button; at least one button stays beside it.
  const slots = Math.max(2, columns * cap)
  const keep = new Set(PRIORITY.filter((id) => ids.includes(id)).slice(0, slots - 1))
  const shown = ids.filter((id) => keep.has(id))
  const more = ids.filter((id) => !keep.has(id))
  return { columns, rows: Math.ceil(slots / columns), shown, more }
}
