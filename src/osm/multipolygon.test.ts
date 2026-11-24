import { describe, expect, it } from 'vitest'
import { assembleRings, buildPolygons, ringContains, type Ring } from './multipolygon.ts'

const sq = (x: number, y: number, s: number): Ring => [
  { lat: y, lon: x },
  { lat: y, lon: x + s },
  { lat: y + s, lon: x + s },
  { lat: y + s, lon: x },
  { lat: y, lon: x },
]

describe('assembleRings', () => {
  it('keeps closed ways as they are', () => {
    expect(assembleRings([sq(0, 0, 1)])).toHaveLength(1)
  })
  it('joins the halves of a ring, whatever their direction', () => {
    const ring = sq(0, 0, 4)
    const a = ring.slice(0, 3)
    const b = ring.slice(2).reverse() // second half stored backwards
    const rings = assembleRings([a, b])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(rings[0]![0]).toEqual(rings[0]![4])
  })
  it('drops chains that never close (the rest of the ring lies outside the download)', () => {
    expect(assembleRings([sq(0, 0, 1).slice(0, 3)])).toEqual([])
  })
  it('drops degenerate input without looping', () => {
    expect(assembleRings([[], [{ lat: 0, lon: 0 }], [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }]])).toEqual([])
  })
})

describe('buildPolygons', () => {
  it('gives a hole to the smallest outer ring that contains it', () => {
    const lake = sq(0, 0, 10)
    const island = sq(2, 2, 6)
    const pond = sq(4, 4, 1)
    const stray = sq(50, 50, 1)
    const polys = buildPolygons([lake, island], [pond, stray])
    expect(polys[0]!.holes).toHaveLength(0)
    expect(polys[1]!.holes).toEqual([pond])
  })
  it('tests containment by even-odd', () => {
    expect(ringContains(sq(0, 0, 2), { lat: 1, lon: 1 })).toBe(true)
    expect(ringContains(sq(0, 0, 2), { lat: 3, lon: 1 })).toBe(false)
  })
})
