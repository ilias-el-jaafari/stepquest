import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { chunkLimit, LruCache, planChunks, type PlanInput } from './chunkPlan.ts'

const SEED = 20261204

const inputArb: fc.Arbitrary<PlanInput> = fc.record({
  camX: fc.double({ min: -50, max: 900, noNaN: true }),
  camY: fc.double({ min: -50, max: 900, noNaN: true }),
  zoom: fc.double({ min: 0.5, max: 64, noNaN: true }),
  cssW: fc.integer({ min: 100, max: 2000 }),
  cssH: fc.integer({ min: 100, max: 2000 }),
  cols: fc.integer({ min: 16, max: 800 }),
  rows: fc.integer({ min: 16, max: 800 }),
  chunk: fc.constantFrom(16, 32, 64),
  margin: fc.integer({ min: 0, max: 3 }),
})

describe('chunk planning properties', () => {
  it('P-D1: every chunk that touches the screen and the grid is in `visible`, with no duplicates or overlap with the ring', () => {
    fc.assert(
      fc.property(inputArb, (p) => {
        const { visible, ring } = planChunks(p)
        const keys = [...visible, ...ring].map((c) => `${c.cx},${c.cy}`)
        expect(new Set(keys).size).toBe(keys.length)
        const have = new Set(visible.map((c) => `${c.cx},${c.cy}`))
        // Independent check: any tile of the screen rectangle that lies on the grid belongs to a visible chunk.
        const x0 = p.camX - p.cssW / 2 / p.zoom
        const x1 = p.camX + p.cssW / 2 / p.zoom
        const y0 = p.camY - p.cssH / 2 / p.zoom
        const y1 = p.camY + p.cssH / 2 / p.zoom
        const maxCx = Math.ceil(p.cols / p.chunk) - 1
        const maxCy = Math.ceil(p.rows / p.chunk) - 1
        for (let cx = 0; cx <= maxCx; cx++) {
          for (let cy = 0; cy <= maxCy; cy++) {
            const overlaps = cx * p.chunk <= x1 && (cx + 1) * p.chunk >= x0 && cy * p.chunk <= y1 && (cy + 1) * p.chunk >= y0
            const strictlyInside = (cx + 1) * p.chunk > x0 && cx * p.chunk < x1 && (cy + 1) * p.chunk > y0 && cy * p.chunk < y1
            if (strictlyInside) expect(have.has(`${cx},${cy}`), `chunk ${cx},${cy}`).toBe(true)
            if (!overlaps) expect(have.has(`${cx},${cy}`)).toBe(false)
          }
        }
        for (const c of [...visible, ...ring]) expect(c.cx >= 0 && c.cy >= 0 && c.cx <= maxCx && c.cy <= maxCy).toBe(true)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })

  it('P-D1: visible and ring are each sorted nearest-the-centre first', () => {
    fc.assert(
      fc.property(inputArb, (p) => {
        const d = (c: { cx: number; cy: number }) => Math.hypot((c.cx + 0.5) * p.chunk - p.camX, (c.cy + 0.5) * p.chunk - p.camY)
        const { visible, ring } = planChunks(p)
        for (const list of [visible, ring]) for (let i = 1; i < list.length; i++) expect(d(list[i]!)).toBeGreaterThanOrEqual(d(list[i - 1]!))
      }),
      { seed: SEED, numRuns: 100 },
    )
  })

  it('P-D2: the cache never evicts a protected (on-screen) chunk, and respects its limit otherwise', () => {
    const op = fc.record({ key: fc.integer({ min: 0, max: 60 }), protect: fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 12 }) })
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), fc.array(op, { maxLength: 150 }), (limit, ops) => {
        const cache = new LruCache<number>(limit)
        for (const { key, protect } of ops) {
          const protectedKeys = new Set(protect.map(String))
          // Protected chunks that are already cached must survive this insertion.
          const before = [...protectedKeys].filter((k) => cache.has(k))
          cache.set(String(key), key, protectedKeys)
          for (const k of before) expect(cache.has(k), `protected ${k} evicted`).toBe(true)
          expect(cache.has(String(key))).toBe(true)
          // Over the limit only when everything else in the cache is protected.
          const evictable = (k: string) => k !== String(key) && !protectedKeys.has(k)
          if (cache.size > limit) for (let k = 0; k <= 60; k++) expect(evictable(String(k)) && cache.has(String(k))).toBe(false)
        }
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('P-D2: the cache limit always leaves room for the visible chunks plus a prefetch margin', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 200 }), (p, base) => {
        const plan = planChunks(p)
        const limit = chunkLimit(base, plan)
        expect(limit).toBeGreaterThanOrEqual(base)
        expect(limit).toBeGreaterThanOrEqual(plan.visible.length + 8)
        // Filling the cache with the visible chunks as protected keeps every one of them.
        const cache = new LruCache<number>(limit)
        const keys = new Set(plan.visible.map((c) => `${c.cx},${c.cy}`))
        for (const c of [...plan.ring, ...plan.visible, ...plan.ring]) cache.set(`${c.cx},${c.cy}`, 1, keys)
        for (const k of keys) expect(cache.has(k)).toBe(true)
      }),
      { seed: SEED, numRuns: 100 },
    )
  })
})
