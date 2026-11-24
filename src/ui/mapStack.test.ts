import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { columnCapacity, planStack, PRIORITY, STACK, type StackId } from './mapStack.ts'

const PLANNER: StackId[] = ['zoomIn', 'zoomOut', 'fit', 'home', 'locate']
const QUEST: StackId[] = ['zoomIn', 'zoomOut', 'locate']
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (sel: string) => {
  const m = stripped.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'))
  return m?.[1] ?? ''
}

/** Height the stack really needs for a plan, as the CSS grid draws it. */
const needed = (rows: number) => STACK.top + rows * STACK.hit + (rows - 1) * STACK.gap + STACK.bottom + STACK.attr

describe('planStack', () => {
  it('shows everything in one column when it fits', () => {
    expect(planStack({ width: 390, height: 400, ids: PLANNER })).toEqual({ columns: 1, rows: 5, shown: PLANNER, more: [] })
  })

  it('shows everything when the size is not known yet', () => {
    expect(planStack({ width: 0, height: 0, ids: PLANNER }).shown).toEqual(PLANNER)
  })

  it('reflows into two columns when one is too tall', () => {
    const p = planStack({ width: 390, height: 230, ids: PLANNER })
    expect(p.columns).toBe(2)
    expect(p.rows).toBe(3)
    expect(p.shown).toEqual(PLANNER)
    expect(p.more).toEqual([])
  })

  it('collapses the least important buttons behind More at the smallest map', () => {
    const p = planStack({ width: 320, height: 160, ids: PLANNER })
    expect(p.more.length).toBeGreaterThan(0)
    expect(p.shown).toEqual(expect.arrayContaining(['zoomIn', 'zoomOut']))
    expect(p.more).toEqual(['fit', 'home'].filter((id) => p.more.includes(id as StackId)))
    expect([...p.shown, ...p.more].sort()).toEqual([...PLANNER].sort())
  })

  it('collapses in one column when the map is too narrow for two', () => {
    const p = planStack({ width: 120, height: 200, ids: PLANNER })
    expect(p.columns).toBe(1)
    expect(p.shown.length).toBeLessThan(PLANNER.length)
  })

  it('keeps shown buttons in the given order and by priority', () => {
    const p = planStack({ width: 320, height: 160, ids: PLANNER })
    expect(p.shown).toEqual(PLANNER.filter((id) => p.shown.includes(id)))
    const rank = (id: StackId) => PRIORITY.indexOf(id)
    expect(Math.max(...p.shown.map(rank))).toBeLessThan(Math.min(...p.more.map(rank)))
  })

  it('keeps the quest stack clear of the bottom HUD', () => {
    const open = planStack({ width: 390, height: 600, ids: QUEST, bottomReserve: 0 })
    expect(open.more).toEqual([])
    const crowded = planStack({ width: 390, height: 360, ids: QUEST, bottomReserve: 150 })
    expect(crowded.rows).toBeLessThanOrEqual(columnCapacity(360, 150) || 2)
  })

  // Map height = viewport minus header (~56), tab bar (~56) and a planner panel of up to 58 % of the rest.
  const sizes: [number, number][] = [
    [320, 568], [375, 667], [390, 844], [430, 932], // portrait
    [568, 320], [667, 375], [844, 390], [932, 430], // landscape
  ]
  it.each(sizes)('never needs more height than the map has at %i x %i', (w, h) => {
    const free = Math.max(160, h - 112)
    for (const panel of [0, 0.3, 0.58]) {
      const mapH = Math.max(160, Math.round(free * (1 - panel)))
      for (const ids of [PLANNER, QUEST]) {
        const p = planStack({ width: w, height: mapH, ids })
        const slots = p.shown.length + (p.more.length ? 1 : 0)
        expect(slots).toBeGreaterThan(0)
        expect(needed(p.rows)).toBeLessThanOrEqual(mapH)
        expect(p.rows * p.columns).toBeGreaterThanOrEqual(slots)
        // Every button is reachable: shown or behind More.
        expect([...p.shown, ...p.more].sort()).toEqual([...ids].sort())
      }
    }
  })
})

describe('map button CSS', () => {
  it('keeps the 48 px press area and draws the stack as a grid of --hit rows', () => {
    const b = rule('.map-buttons')
    expect(b).toMatch(/display:\s*grid/)
    expect(b).toMatch(/grid-template-rows:\s*repeat\(var\(--stack-rows,\s*5\),\s*var\(--hit\)\)/)
    expect(css).toMatch(/--hit:\s*48px/)
    expect(STACK.hit).toBe(48)
    expect(rule('.pix-btn.round')).toMatch(/width:\s*var\(--hit\)/)
  })

  it('opens the collapsed buttons sideways, not downwards', () => {
    const m = rule('.map-more')
    expect(m).toMatch(/right:\s*calc\(100% \+ 10px\)/)
    expect(m).toMatch(/display:\s*flex/)
  })

  it('uses the same gap and strip height as the layout rules', () => {
    expect(rule('.map-buttons')).toBeDefined()
    expect(css).toMatch(new RegExp(`--attr-h:\\s*${STACK.attr}px`))
    expect(stripped).toMatch(new RegExp(`\\.map-buttons \\{[^}]*gap:\\s*${STACK.gap}px[^}]*top:\\s*${STACK.top}px`))
  })
})
