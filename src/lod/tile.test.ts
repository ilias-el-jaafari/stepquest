import { describe, expect, it } from 'vitest'
import { tileBBox, tileSizeM } from '../vector/tileMath.ts'
import { Area, NO_FOOT, Street, CLASS_MASK } from './classes.ts'
import { emptyLod, isLodTile, lodBytes, MIN_BUILDING_M2, ringArea, shapeCount, simplify, tileToLod, LOD_EXTENT } from './tile.ts'
import { makeLod, makeMvt, square } from './testing.ts'

const T = { z: 14, x: 8174, y: 6232 }
const mPerUnit = tileSizeM(T.z, (tileBBox(T).north + tileBBox(T).south) / 2) / LOD_EXTENT

describe('MVT to LOD tile (requirement 25.2)', () => {
  it('keeps streets by class with the flags that decide walkability', () => {
    const t = makeLod(T, {
      lines: [
        { cls: 'minor', pts: [[0, 100], [4096, 100]] },
        { cls: 'primary', pts: [[0, 200], [4096, 200]] },
        { cls: 'motorway', pts: [[0, 300], [4096, 300]] },
        { cls: 'trunk', pts: [[0, 350], [4096, 350]] },
        { cls: 'path', sub: 'footway', pts: [[0, 400], [4096, 400]] },
        { cls: 'path', sub: 'pedestrian', pts: [[0, 450], [4096, 450]] },
        { cls: 'service', pts: [[0, 500], [4096, 500]], props: { foot: 'no' } },
        { cls: 'service', pts: [[0, 550], [4096, 550]], props: { access: 'private' } },
        { cls: 'service', pts: [[0, 600], [4096, 600]], props: { access: 'private', foot: 'yes' } },
        { cls: 'minor', pts: [[0, 650], [4096, 650]], props: { brunnel: 'tunnel' } },
        { cls: 'rail', sub: 'rail', pts: [[0, 700], [4096, 700]] },
        { cls: 'ferry', pts: [[0, 750], [4096, 750]] },
      ],
    })
    const kinds = [...t.streets.kind]
    expect(kinds).toEqual([Street.minor, Street.primary, Street.motorway | NO_FOOT, Street.trunk | NO_FOOT, Street.path, Street.minor, Street.service | NO_FOOT, Street.service | NO_FOOT, Street.service, Street.rail | NO_FOOT])
    expect(kinds.map((k) => k & CLASS_MASK)).not.toContain(undefined)
  })

  it('reads street names from transportation_name, in the tile\'s own language and spelling', () => {
    const t = makeLod(T, {
      names: [
        { cls: 'minor', name: 'Carrer de Pare Lluís', pts: [[0, 100], [4096, 100]] },
        { cls: 'primary', name: 'Avinguda del Cardenal Benlloch', pts: [[0, 200], [4096, 200]] },
        { cls: 'minor', name: 'Нева́ский проспект', pts: [[0, 300], [4096, 300]] },
        { cls: 'rail', name: 'Not a street', pts: [[0, 400], [4096, 400]] },
      ],
    })
    expect(t.names.text).toEqual(['Carrer de Pare Lluís', 'Avinguda del Cardenal Benlloch', 'Нева́ский проспект'])
    expect([...t.names.kind]).toEqual([Street.minor, Street.primary, Street.minor])
  })

  it('simplifies footprints, drops tiny ones and keeps parks and water as filled areas', () => {
    const big = 12 / mPerUnit // 12 m
    const tiny = Math.sqrt(MIN_BUILDING_M2 / 4) / mPerUnit // a 1.7 m square: far below the minimum
    const wobbly: [number, number][] = []
    // A 60 m square with a 0.3 m wobble on every side: simplification must remove the wobble points.
    const side = 60 / mPerUnit
    for (let i = 0; i <= 10; i++) wobbly.push([1000 + (side * i) / 10, 1000 + (i % 2 ? 0.3 / mPerUnit : 0)])
    wobbly.push([1000 + side, 1000 + side], [1000, 1000 + side])
    const t = makeLod(T, {
      areas: [
        { layer: 'building', ring: square(100, 100, big) },
        { layer: 'building', ring: square(300, 300, tiny) },
        { layer: 'building', ring: wobbly },
        { layer: 'park', ring: square(2000, 2000, 500) },
        { layer: 'water', ring: square(3000, 3000, 400) },
        { layer: 'landcover', cls: 'wood', ring: square(3500, 100, 300) },
        { layer: 'landcover', cls: 'ice', ring: square(3500, 500, 300) },
      ],
    })
    const kinds = [...t.areas.kind]
    expect(kinds).toEqual([Area.building, Area.building, Area.green, Area.water, Area.green])
    // The wobbly 60 m square came out as its 4 corners.
    expect(t.areas.start[2]! - t.areas.start[1]!).toBe(4)
  })

  it('keeps coordinates in tile units and does not clip at the edge, so a street cut at a seam meets its neighbour', () => {
    const a = makeLod({ ...T, x: T.x }, { lines: [{ cls: 'minor', pts: [[3000, 2048], [4096, 2048]] }] })
    const b = makeLod({ ...T, x: T.x + 1 }, { lines: [{ cls: 'minor', pts: [[0, 2048], [1000, 2048]] }] })
    expect(a.streets.xy[a.streets.xy.length - 2]).toBe(4096)
    expect(b.streets.xy[0]).toBe(0)
    expect(a.streets.xy[a.streets.xy.length - 1]).toBe(b.streets.xy[1])
  })

  it('is a valid, storable tile: typed arrays of consistent length, and an empty tile is valid too', () => {
    const t = makeLod(T, { lines: [{ cls: 'minor', pts: [[0, 0], [10, 10]] }], names: [{ cls: 'minor', name: 'X', pts: [[0, 0], [10, 10]] }] })
    expect(isLodTile(t)).toBe(true)
    expect(isLodTile(structuredClone(t))).toBe(true)
    expect(isLodTile({ ...t, v: 2 })).toBe(false)
    expect(isLodTile({ ...t, streets: { ...t.streets, xy: new Int16Array(3) } })).toBe(false)
    expect(isLodTile(null)).toBe(false)
    const e = emptyLod(T)
    expect(isLodTile(e)).toBe(true)
    expect(shapeCount(e.streets)).toBe(0)
    expect(lodBytes(e)).toBeLessThan(64)
    expect(shapeCount(tileToLod(makeMvt({}), T).areas)).toBe(0)
  })
})

describe('simplification', () => {
  it('keeps the ends and drops points within the tolerance; ring area is absolute', () => {
    expect(simplify([[0, 0], [5, 0.2], [10, 0]], 1)).toEqual([[0, 0], [10, 0]])
    expect(simplify([[0, 0], [5, 3], [10, 0]], 1)).toHaveLength(3)
    expect(simplify([[0, 0]], 1)).toHaveLength(1)
    expect(ringArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100)
    expect(ringArea([[0, 0], [0, 10], [10, 10], [10, 0]])).toBe(100)
  })
})
