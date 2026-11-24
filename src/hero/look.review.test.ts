import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BODIES, DEFAULT_LOOK, LOOK_PARTS, LOOK_STORAGE_KEY, loadLook, lookColors, normalizeLook, PALETTES, walkerFor, type Look } from './look.ts'

/** Review (Nov 2026): the look is always valid, whatever was stored or passed in. */

const valid = (l: Look) => BODIES.includes(l.body) && LOOK_PARTS.every((p) => Number.isInteger(l[p]) && l[p] >= 0 && l[p] < PALETTES[p].length && !Object.is(l[p], -0))

describe('look validation (review)', () => {
  it('B7: -0 from stored JSON becomes 0', () => {
    expect(Object.is(normalizeLook(JSON.parse('{"skin":-0}')).skin, 0)).toBe(true)
  })

  it('B8: a hand-made look with a string index or unknown body cannot poison the sprite cache', () => {
    const before = walkerFor(DEFAULT_LOOK)
    const frames = before.down[0]!.rows.slice()
    const odd = { ...DEFAULT_LOOK, shirt: '2', body: 'robot' } as unknown as Look
    expect(walkerFor(odd)).toBe(walkerFor(DEFAULT_LOOK))
    expect(walkerFor(DEFAULT_LOOK).down[0]!.rows).toEqual(frames)
    expect(walkerFor(DEFAULT_LOOK).down[0]!.colors.p).toBe(PALETTES.shirt[0])
    expect(lookColors(odd).p).toBe(PALETTES.shirt[0])
  })

  it('always returns a valid look for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(valid(normalizeLook(v))).toBe(true)
        const store = { getItem: () => JSON.stringify(v), setItem: () => {} }
        expect(valid(loadLook(store))).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('keeps every valid look unchanged and repairs one part at a time', () => {
    const part = fc.constantFrom(...LOOK_PARTS)
    fc.assert(
      fc.property(fc.constantFrom(...BODIES), fc.tuple(...LOOK_PARTS.map((p) => fc.integer({ min: 0, max: PALETTES[p].length - 1 }))), part, fc.oneof(fc.integer({ min: 100, max: 999 }), fc.constant(-1), fc.constant(0.5)), (body, idx, bad, junk) => {
        const look = { body, ...Object.fromEntries(LOOK_PARTS.map((p, i) => [p, idx[i]])) } as Look
        expect(normalizeLook(look)).toEqual(look)
        expect(normalizeLook({ ...look, [bad]: junk })).toEqual({ ...look, [bad]: 0 })
      }),
    )
  })

  it('survives storage that throws or holds the wrong type', () => {
    expect(loadLook({ getItem: () => { throw new Error('denied') }, setItem: () => {} })).toEqual(DEFAULT_LOOK)
    for (const raw of ['[]', '7', '"x"', 'null', 'true', '{"body":"girl","skin":"3"}']) {
      const l = loadLook({ getItem: (k: string) => (k === LOOK_STORAGE_KEY ? raw : null), setItem: () => {} })
      expect(valid(l)).toBe(true)
    }
  })
})
