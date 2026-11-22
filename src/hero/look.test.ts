import { describe, expect, it } from 'vitest'
import { spriteIsValid, WALKER } from '../render/sprites.ts'
import { DEFAULT_LOOK, lighten, loadLook, LOOK_PARTS, LOOK_STORAGE_KEY, lookColors, normalizeLook, PALETTES, saveLook, walkerFor } from './look.ts'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('walker look', () => {
  it('offers a short retro palette (6–8 swatches) for every part, without repeats', () => {
    for (const part of LOOK_PARTS) {
      const p = PALETTES[part]
      expect(p.length).toBeGreaterThanOrEqual(6)
      expect(p.length).toBeLessThanOrEqual(8)
      expect(new Set(p).size).toBe(p.length)
      for (const c of p) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('draws valid 16×16 sprites for both bodies in every direction and frame', () => {
    for (const body of ['boy', 'girl'] as const) {
      const w = walkerFor({ ...DEFAULT_LOOK, body, shirt: 3, cap: 5 })
      for (const frames of Object.values(w)) {
        expect(frames).toHaveLength(3)
        for (const f of frames) expect(spriteIsValid(f)).toBe(true)
      }
    }
    // Girl and boy differ (hair), and the default look is the original walker.
    expect(walkerFor({ ...DEFAULT_LOOK, body: 'girl' }).down[0]!.rows).not.toEqual(WALKER.down[0]!.rows)
    expect(walkerFor(DEFAULT_LOOK).down[0]!.rows).toEqual(WALKER.down[0]!.rows)
    expect(lookColors(DEFAULT_LOOK).t).toBe(WALKER.down[0]!.colors.t)
  })

  it('dresses the parts in the chosen colours and reuses the same sprites for the same look', () => {
    const look = { ...DEFAULT_LOOK, skin: 2, hair: 3, cap: 1, shirt: 4, pants: 5 }
    const c = lookColors(look)
    expect([c.s, c.h, c.t, c.p, c.b]).toEqual([PALETTES.skin[2], PALETTES.hair[3], PALETTES.cap[1], PALETTES.shirt[4], PALETTES.pants[5]])
    expect(c.T).toBe(lighten(PALETTES.cap[1]!, 0.5))
    expect(walkerFor(look)).toBe(walkerFor({ ...look }))
    expect(lighten('#000000', 0.5)).toBe('#808080')
  })

  it('saves and loads the look, and repairs anything odd', () => {
    const store = memory()
    expect(loadLook(store)).toEqual(DEFAULT_LOOK)
    saveLook({ body: 'girl', skin: 5, hair: 6, cap: 7, shirt: 7, pants: 5 }, store)
    expect(loadLook(store)).toEqual({ body: 'girl', skin: 5, hair: 6, cap: 7, shirt: 7, pants: 5 })
    store.setItem(LOOK_STORAGE_KEY, '{oops')
    expect(loadLook(store)).toEqual(DEFAULT_LOOK)
    expect(normalizeLook({ body: 'robot', skin: 99, hair: -1, cap: 1.5, shirt: '2', pants: 3 })).toEqual({ ...DEFAULT_LOOK, pants: 3 })
  })
})
