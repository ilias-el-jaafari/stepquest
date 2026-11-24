import { describe, expect, it } from 'vitest'
import { chunkLimit, LruCache, planChunks, type PlanInput } from './chunkPlan.ts'

const base: PlanInput = { camX: 100, camY: 100, zoom: 8, cssW: 400, cssH: 800, cols: 400, rows: 400, chunk: 32, margin: 1 }

describe('planChunks', () => {
  it('lists every chunk touching the screen, nearest the centre first', () => {
    const { visible } = planChunks(base)
    // 50 × 100 tiles around (100,100): chunks x 2..3, y 1..4.
    expect(visible).toHaveLength(8)
    const dist = (c: { cx: number; cy: number }) => Math.hypot((c.cx + 0.5) * 32 - 100, (c.cy + 0.5) * 32 - 100)
    for (let i = 1; i < visible.length; i++) expect(dist(visible[i]!)).toBeGreaterThanOrEqual(dist(visible[i - 1]!))
    expect(visible[0]).toEqual({ cx: 3, cy: 3 })
  })

  it('puts a one-chunk ring around the screen, without overlap', () => {
    const { visible, ring } = planChunks(base)
    expect(visible.length + ring.length).toBe(4 * 6)
    const keys = new Set(visible.map((c) => `${c.cx},${c.cy}`))
    for (const c of ring) expect(keys.has(`${c.cx},${c.cy}`)).toBe(false)
  })

  it('stays inside the grid and is empty when the view is off the map', () => {
    const corner = planChunks({ ...base, camX: 0, camY: 0, cols: 64, rows: 64 })
    for (const c of [...corner.visible, ...corner.ring]) expect(c.cx >= 0 && c.cy >= 0 && c.cx <= 1 && c.cy <= 1).toBe(true)
    const away = planChunks({ ...base, camX: 5000, camY: 5000 })
    expect(away.visible).toHaveLength(0)
  })
})

describe('LruCache', () => {
  it('drops the least recently used entry over the limit', () => {
    const c = new LruCache<number>(2)
    c.set('a', 1)
    c.set('b', 2)
    c.get('a')
    c.set('c', 3)
    expect([c.has('a'), c.has('b'), c.has('c')]).toEqual([true, false, true])
  })

  it('never evicts protected keys (the chunks on screen) nor the new entry', () => {
    const c = new LruCache<number>(2)
    const keep = new Set(['a', 'b', 'c'])
    c.set('a', 1, keep)
    c.set('b', 2, keep)
    c.set('c', 3, keep)
    expect(c.size).toBe(3)
    c.set('d', 4, new Set(['d']))
    expect(c.size).toBe(2)
    expect(c.has('d')).toBe(true)
  })

  it('shrinks to a new limit on the next insert', () => {
    const c = new LruCache<number>(3)
    for (const k of 'abc') c.set(k, 1)
    c.setLimit(1)
    c.set('d', 1)
    expect(c.size).toBe(1)
  })
})

describe('chunkLimit', () => {
  it('never goes below what the screen needs', () => {
    const plan = planChunks({ ...base, zoom: 1, cssW: 3000, cssH: 3000, cols: 4000, rows: 4000 })
    expect(chunkLimit(10, plan)).toBe(plan.visible.length + 8)
    expect(chunkLimit(5000, plan)).toBe(5000)
  })
})
