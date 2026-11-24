import { describe, expect, it } from 'vitest'
import { encodeOsm, decodeOsm } from '../osm/codec.ts'
import { clipLine, clipRing, poiTags, tileToOsm, transportationTags } from './omt.ts'
import { encodeMvt, type FixtureFeature } from './testing.ts'
import { latOf, lonOf, tileBBox, tileXY, tilesInBBox, tileSizeM } from './tileMath.ts'

/** The z14 tile over Benicalap (measured: 8174/6232 is the tile of 39.4935, -0.392). */
const T = { z: 14, x: 8174, y: 6232 }
const line = (props: Record<string, string | number>, ...pts: [number, number][]): FixtureFeature => ({ type: 2, props, geometry: [pts] })
const square = (props: Record<string, string | number>, x: number, y: number, s: number): FixtureFeature => ({ type: 3, props, geometry: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] })
const point = (props: Record<string, string | number>, x: number, y: number): FixtureFeature => ({ type: 1, props, geometry: [[[x, y]]] })

const fixture = () =>
  encodeMvt([
    {
      name: 'transportation',
      features: [
        line({ class: 'minor' }, [100, 100], [1000, 100]),
        line({ class: 'primary', ramp: 1 }, [100, 200], [1000, 200]),
        line({ class: 'path', subclass: 'footway' }, [100, 300], [1000, 300]),
        line({ class: 'path', subclass: 'cycleway' }, [100, 350], [1000, 350]),
        line({ class: 'rail', subclass: 'rail' }, [100, 400], [1000, 400]),
        line({ class: 'minor', brunnel: 'tunnel' }, [100, 500], [1000, 500]),
        line({ class: 'secondary', brunnel: 'bridge' }, [100, 600], [1000, 600]),
        line({ class: 'ferry' }, [100, 700], [1000, 700]),
        square({ class: 'path', subclass: 'pedestrian' }, 2000, 2000, 100),
      ],
    },
    { name: 'building', features: [square({}, 1200, 1200, 80)] },
    { name: 'landcover', features: [square({ class: 'grass', subclass: 'park' }, 1500, 1500, 200), square({ class: 'wood', subclass: 'forest' }, 1800, 1500, 100), square({ class: 'grass', subclass: 'grass' }, 2500, 2500, 50)] },
    { name: 'landuse', features: [square({ class: 'pitch' }, 3000, 3000, 60), square({ class: 'residential' }, 0, 0, 4096)] },
    { name: 'water', features: [square({ class: 'lake' }, 3200, 3200, 100), square({ class: 'swimming_pool' }, 3400, 3400, 20)] },
    { name: 'waterway', features: [line({ class: 'river' }, [10, 4000], [4000, 4000])] },
    {
      name: 'poi',
      features: [
        point({ class: 'grocery', subclass: 'supermarket', name: 'Mercadona' }, 1240, 1240),
        point({ class: 'grocery', subclass: 'supermarket', name: 'Consum' }, 3000, 1000),
        point({ class: 'hospital', subclass: 'hospital', name: 'Hospital Arnau' }, 500, 3000),
        point({ class: 'railway', subclass: 'subway', name: 'Benicalap' }, 2000, 500),
        point({ class: 'school', subclass: 'school' }, 3500, 500),
        point({ class: 'restaurant', subclass: 'restaurant' }, 3600, 600),
        point({ class: 'grocery', subclass: 'supermarket' }, 5000, 600),
      ],
    },
  ])

describe('tile maths (requirement 21.2)', () => {
  it('names the measured tile over Benicalap and gives neighbours exactly shared edges', () => {
    const p = tileXY(39.4935, -0.392, 14)
    expect([Math.floor(p.x), Math.floor(p.y)]).toEqual([T.x, T.y])
    expect(tileBBox(T).east).toBe(tileBBox({ ...T, x: T.x + 1 }).west)
    expect(tileBBox(T).south).toBe(tileBBox({ ...T, y: T.y + 1 }).north)
    expect(tilesInBBox(tileBBox(T), 14)).toEqual([T])
    expect(lonOf(0, 0)).toBe(-180)
    expect(latOf(1, 1)).toBeCloseTo(0, 9)
    // About 1.9 km at València, 7.5 km at z12.
    expect(tileSizeM(14, 39.5)).toBeGreaterThan(1800)
    expect(tileSizeM(14, 39.5)).toBeLessThan(1950)
    expect(tileSizeM(12, 39.5) / 1000).toBeCloseTo(7.55, 1)
  })
})

describe('OpenMapTiles to the map model (requirement 21.3)', () => {
  const data = tileToOsm(fixture(), T)
  const kinds = data.ways.map((w) => `${w.kind}:${w.highway ?? w.sub ?? ''}${w.bridge ? ':bridge' : ''}${w.tunnel ? ':tunnel' : ''}`)

  it('maps every drawn layer through the same rules as an Overpass answer', () => {
    expect(kinds).toEqual(
      expect.arrayContaining(['road:residential', 'road:primary_link', 'path:footway', 'path:cycleway', 'rail:', 'road:residential:tunnel', 'road:secondary:bridge', 'building:', 'park:park', 'park:wood', 'park:grass', 'park:pitch', 'water:', 'waterway:']),
    )
    // A pedestrian area is a plaza, as with Overpass.
    expect(data.ways.find((w) => w.kind === 'path' && w.area)?.sub).toBe('plaza')
    // Not drawn: ferries, plain residential land, swimming pools.
    expect(kinds.filter((k) => k.startsWith('water:'))).toHaveLength(1)
    expect(data.ways.filter((w) => w.kind === 'park')).toHaveLength(4)
    expect(data.ways.every((w) => w.kind !== 'road' || w.highway !== 'ferry')).toBe(true)
    expect(data.source).toBe('tiles')
  })

  it('turns points of interest into the same landmarks, the green market by name, and keeps only those inside the tile', () => {
    expect(data.pois.map((p) => p.kind).sort()).toEqual(['greenMarket', 'healing', 'market', 'school', 'station'])
    expect(poiTags({ class: 'restaurant', subclass: 'restaurant' })).toBeUndefined()
  })

  it('places tile coordinates at the right degrees', () => {
    const b = tileBBox(T)
    const footway = data.ways.find((w) => w.highway === 'footway')!
    const first = footway.nodes[0]!
    expect(data.lon[first]).toBeCloseTo(b.west + ((b.east - b.west) * 100) / 4096, 9)
    expect(data.lat[first]).toBeCloseTo(latOf(T.y + 300 / 4096, 14), 9)
    expect(data.bbox).toEqual(b)
  })

  it('keeps only the coarse layer for a coarse tile: streets, big green, water and rail', () => {
    const coarse = tileToOsm(fixture(), T, { coarse: true })
    const k = new Set(coarse.ways.map((w) => w.kind))
    expect([...k].sort()).toEqual(['park', 'rail', 'road', 'water', 'waterway'])
    expect(coarse.ways.some((w) => w.sub === 'grass' || w.sub === 'pitch')).toBe(false)
    expect(coarse.pois).toEqual([])
  })

  it('survives the cache codec (what IndexedDB stores) and reads an empty tile as empty', () => {
    const back = decodeOsm(encodeOsm(data))
    expect(back.ways.length).toBe(data.ways.length)
    expect(back.source).toBe('tiles')
    expect(tileToOsm(new Uint8Array(0), T).ways).toEqual([])
  })

  it('maps road classes, ramps and links, and drops what is not drawn', () => {
    expect(transportationTags({ class: 'minor' }, false)).toEqual({ highway: 'residential' })
    expect(transportationTags({ class: 'trunk', ramp: 1 }, false)).toEqual({ highway: 'trunk_link' })
    expect(transportationTags({ class: 'transit', subclass: 'tram' }, false)).toEqual({ railway: 'tram' })
    expect(transportationTags({ class: 'path', subclass: 'footway', foot: 'no' }, false)).toEqual({ highway: 'footway', foot: 'no' })
    expect(transportationTags({ class: 'aerialway' }, false)).toBeUndefined()
    expect(transportationTags({ class: 'minor' }, true)).toBeUndefined()
  })
})

describe('clipping at the tile edge (requirement 21.6)', () => {
  it('cuts a line that runs into the buffer exactly at the edge, and splits one that leaves and comes back', () => {
    expect(clipLine([{ x: -100, y: 50 }, { x: 200, y: 50 }], 4096)).toEqual([[{ x: 0, y: 50 }, { x: 200, y: 50 }]])
    const pieces = clipLine([{ x: 10, y: 10 }, { x: 10, y: 5000 }, { x: 20, y: 5000 }, { x: 20, y: 10 }], 4096)
    expect(pieces).toEqual([[{ x: 10, y: 10 }, { x: 10, y: 4096 }], [{ x: 20, y: 4096 }, { x: 20, y: 10 }]])
  })

  it('cuts a polygon at the edge into a closed ring with corners on the edge', () => {
    const r = clipRing([{ x: 4000, y: 100 }, { x: 4200, y: 100 }, { x: 4200, y: 300 }, { x: 4000, y: 300 }], 4096)
    expect(r).toEqual([{ x: 4000, y: 100 }, { x: 4096, y: 100 }, { x: 4096, y: 300 }, { x: 4000, y: 300 }, { x: 4000, y: 100 }])
    expect(clipRing([{ x: 5000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 100 }], 4096)).toEqual([])
  })

  it('gives the shared edge of two neighbours the same degrees on both sides', () => {
    const east = { ...T, x: T.x + 1 }
    const across: FixtureFeature = { type: 2, props: { class: 'minor' }, geometry: [[[4000, 2000], [4196, 2000]]] }
    const shifted: FixtureFeature = { type: 2, props: { class: 'minor' }, geometry: [[[-96, 2000], [100, 2000]]] }
    const a = tileToOsm(encodeMvt([{ name: 'transportation', features: [across] }]), T)
    const b = tileToOsm(encodeMvt([{ name: 'transportation', features: [shifted] }]), east)
    const endA = a.lon[a.ways[0]!.nodes.at(-1)!]
    const startB = b.lon[b.ways[0]!.nodes[0]!]
    expect(endA).toBe(startB)
    expect(endA).toBe(tileBBox(T).east)
  })
})
