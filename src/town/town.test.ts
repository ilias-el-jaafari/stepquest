import { describe, expect, it } from 'vitest'
import { classifyWay, parkStyle, wayStyle } from '../osm/classify.ts'
import { decodeOsm, encodeOsm } from '../osm/codec.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import { dedupePois, isGreenMarket, landmarkKind } from '../osm/landmarks.ts'
import { normalizeOverpass } from '../osm/normalize.ts'
import type { OsmData } from '../osm/types.ts'
import { ARROW_PATTERNS, chevrons, dir8, routeCells, smoothPolyline } from '../render/routePath.ts'
import { facingFrom, spriteIsValid, WALKER, walkFrame } from '../render/sprites.ts'
import { paintFrontFence, paintGardenTree, paintHouse, paintLandmark } from '../render/structures.ts'
import { Corner, diagonalCorners } from '../tiles/diagonal.ts'
import { Terrain, TileGrid } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { largestRect, layoutTown, LOT, rng, subdivide, townFor } from './layout.ts'

const BBOX = { south: 39.49, west: -0.4, north: 39.4915, east: -0.3985 }

/** A small grid painted from ASCII art: R road, B building, . ground, P park, - path. */
function gridFrom(art: string): TileGrid {
  const rows = art.trim().split('\n').map((r) => r.trim())
  const g = new TileGrid(BBOX, 5)
  const map: Record<string, number> = { R: Terrain.road, B: Terrain.building, '.': Terrain.ground, P: Terrain.park, '-': Terrain.path }
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++) g.terrain[g.index(x, y)] = map[rows[y]?.[x] ?? '.'] ?? Terrain.ground
  return g
}

let demoGrid: TileGrid | undefined
const demo = () => (demoGrid ??= buildTileGrid(loadDemoOsm()))

describe('lot subdivision', () => {
  it('cuts a block into lots that cover it exactly and respect the size limits', () => {
    const rect = { x: 3, y: 5, w: 31, h: 23 }
    const lots = subdivide(rect, rng(42))
    expect(lots.length).toBeGreaterThan(10)
    const area = lots.reduce((s, r) => s + r.w * r.h, 0)
    expect(area).toBe(rect.w * rect.h)
    const covered = new Set<string>()
    for (const r of lots) {
      expect(r.w).toBeGreaterThanOrEqual(LOT.minW)
      // A side is only cut when both halves can stay at least the minimum size.
      expect(r.w).toBeLessThanOrEqual(Math.max(LOT.maxW, LOT.minW * 2 - 1))
      expect(r.h).toBeGreaterThanOrEqual(LOT.minH)
      expect(r.h).toBeLessThanOrEqual(Math.max(LOT.maxH, LOT.minH * 2 - 1))
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const k = `${x},${y}`
          expect(covered.has(k)).toBe(false)
          covered.add(k)
        }
    }
  })

  it('keeps small blocks whole and is deterministic', () => {
    expect(subdivide({ x: 0, y: 0, w: 5, h: 4 }, rng(1))).toEqual([{ x: 0, y: 0, w: 5, h: 4 }])
    expect(subdivide({ x: 0, y: 0, w: 20, h: 20 }, rng(9))).toEqual(subdivide({ x: 0, y: 0, w: 20, h: 20 }, rng(9)))
  })

  it('finds the largest rectangle in a mask', () => {
    // prettier-ignore
    const mask = [
      1, 1, 0, 0, 0,
      1, 1, 1, 1, 0,
      0, 1, 1, 1, 0,
      0, 1, 1, 1, 1,
    ]
    expect(largestRect(mask, 5, 4)).toEqual({ x: 1, y: 1, w: 3, h: 3 })
    expect(largestRect([0, 0, 0, 0], 2, 2)).toBeUndefined()
  })
})

describe('town layout', () => {
  it('puts houses only on building tiles, without overlaps', () => {
    const g = gridFrom(`
      RRRRRRRRRRRRRRRRRRRR
      R..................R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R..................R
      RRRRRRRRRRRRRRRRRRRR`)
    const town = layoutTown(g)
    expect(town.houses.length).toBeGreaterThanOrEqual(4)
    const seen = new Set<number>()
    for (const h of town.houses) {
      expect(h.w).toBeGreaterThanOrEqual(2)
      expect(h.h).toBeGreaterThanOrEqual(2)
      expect(h.door).toBeGreaterThanOrEqual(0)
      expect(h.door).toBeLessThan(h.w)
      for (let y = h.y; y < h.y + h.h; y++)
        for (let x = h.x; x < h.x + h.w; x++) {
          const i = g.index(x, y)
          expect(g.terrain[i]).toBe(Terrain.building)
          expect(seen.has(i)).toBe(false)
          seen.add(i)
        }
    }
    // One big block becomes several houses, not one giant roof.
    expect(Math.max(...town.houses.map((h) => h.w * h.h))).toBeLessThan(16 * 8)
    expect(new Set(town.houses.map((h) => h.roof)).size).toBeGreaterThan(1)
  })

  it('places a landmark building next to its map point', () => {
    const g = gridFrom(`
      RRRRRRRRRRRRRRRRRRRR
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      R.BBBBBBBBBBBBBBBB.R
      RRRRRRRRRRRRRRRRRRRR`)
    const at = g.projection.toLatLon(9.5 * 5, 4.5 * 5)
    g.pois = [{ kind: 'greenMarket', lat: at.lat, lon: at.lon }]
    const town = layoutTown(g)
    expect(town.landmarks).toHaveLength(1)
    const lm = town.landmarks[0]!
    expect(lm.kind).toBe('greenMarket')
    expect(Math.abs(lm.x + lm.w / 2 - 9.5)).toBeLessThan(4)
    expect(Math.abs(lm.y + lm.h / 2 - 4.5)).toBeLessThan(4)
    // Houses never overlap the landmark.
    for (let y = lm.y; y < lm.y + lm.h; y++) for (let x = lm.x; x < lm.x + lm.w; x++) expect(town.houseAt[g.index(x, y)]).toBe(-1)
  })

  it('turns most of the demo town into houses and finds the supermarket landmarks', () => {
    const g = demo()
    const town = townFor(g)
    expect(townFor(g)).toBe(town) // cached
    let buildings = 0
    let housed = 0
    for (let i = 0; i < g.terrain.length; i++) {
      if (g.terrain[i] !== Terrain.building) continue
      buildings++
      if ((town.houseAt[i] ?? -1) >= 0) housed++
    }
    expect(housed / buildings).toBeGreaterThan(0.5)
    const kinds = new Set(town.landmarks.map((l) => l.kind))
    for (const k of ['greenMarket', 'market', 'healing', 'school', 'station'] as const) expect(kinds.has(k), k).toBe(true)
  })
})

describe('landmark tags', () => {
  it('maps supermarkets: the green chain gets the special shop, the rest a generic shop', () => {
    expect(landmarkKind({ shop: 'supermarket', brand: 'Mercadona', name: 'Mercadona' })).toBe('greenMarket')
    expect(landmarkKind({ shop: 'supermarket', name: 'MERCADONA Benicalap' })).toBe('greenMarket')
    expect(landmarkKind({ shop: 'supermarket', 'brand:wikidata': 'Q377705' })).toBe('greenMarket')
    expect(isGreenMarket({ shop: 'supermarket', name: 'Consum' })).toBe(false)
    expect(landmarkKind({ shop: 'supermarket', name: 'Consum' })).toBe('market')
    expect(landmarkKind({ shop: 'supermarket' })).toBe('market')
    expect(landmarkKind({ shop: 'bakery' })).toBeUndefined()
  })

  it('maps hospitals and public health centres, not every private clinic', () => {
    expect(landmarkKind({ amenity: 'hospital' })).toBe('healing')
    expect(landmarkKind({ amenity: 'clinic', name: 'Centre de Salut Azucena' })).toBe('healing')
    expect(landmarkKind({ amenity: 'clinic', name: 'Clínica Dental Sonrisa' })).toBeUndefined()
  })

  it('maps stations and schools', () => {
    expect(landmarkKind({ railway: 'station', name: 'Beniferri' })).toBe('station')
    expect(landmarkKind({ railway: 'subway_entrance' })).toBe('station')
    expect(landmarkKind({ public_transport: 'station', station: 'bus' })).toBeUndefined()
    expect(landmarkKind({ amenity: 'school' })).toBe('school')
    expect(landmarkKind({ building: 'school' })).toBe('school')
  })

  it('merges nearby points of the same kind', () => {
    const pois = dedupePois([
      { kind: 'station', lat: 39.49, lon: -0.4 },
      { kind: 'station', lat: 39.4901, lon: -0.4 },
      { kind: 'school', lat: 39.4901, lon: -0.4 },
      { kind: 'station', lat: 39.5, lon: -0.4 },
    ])
    expect(pois.map((p) => p.kind)).toEqual(['station', 'school', 'station'])
  })

  it('turns tagged nodes into landmark points when normalizing', () => {
    const bbox = { south: 39.48, west: -0.41, north: 39.5, east: -0.38 }
    const data = normalizeOverpass(
      {
        elements: [
          { type: 'node', id: 1, lat: 39.49, lon: -0.39, tags: { shop: 'supermarket', brand: 'Mercadona' } },
          { type: 'node', id: 2, lat: 39.491, lon: -0.395, tags: { amenity: 'school' } },
          { type: 'node', id: 3, lat: 40, lon: -0.39, tags: { amenity: 'school' } },
        ],
      },
      bbox,
    )
    expect(data.pois?.map((p) => p.kind).sort()).toEqual(['greenMarket', 'school'])
  })
})

describe('feature styles', () => {
  it('classifies park styles, barriers, squares and building types', () => {
    expect(parkStyle({ leisure: 'park' })).toBe('park')
    expect(parkStyle({ leisure: 'garden' })).toBe('garden')
    expect(parkStyle({ landuse: 'grass' })).toBe('grass')
    expect(parkStyle({ leisure: 'pitch' })).toBe('pitch')
    expect(classifyWay({ barrier: 'hedge' })).toBe('barrier')
    expect(wayStyle('barrier', { barrier: 'hedge' })).toBe('hedge')
    expect(wayStyle('path', { place: 'square' })).toBe('plaza')
    expect(wayStyle('building', { building: 'warehouse' })).toBe('industrial')
    expect(wayStyle('building', { building: 'house' })).toBe('house')
    expect(wayStyle('building', { building: 'yes' })).toBeUndefined()
  })

  it('round-trips landmark points and styles through the v2 codec, and still reads v1', () => {
    const base = { walkable: false, tunnel: false, crossing: false }
    const data: OsmData = {
      bbox: BBOX,
      source: 'overpass',
      timestamp: '2026-11-20T00:00:00Z',
      lat: new Float64Array([39.49, 39.4901, 39.4902]),
      lon: new Float64Array([-0.4, -0.3999, -0.4]),
      ways: [
        { ...base, id: 10, kind: 'park', nodes: [0, 1, 2, 0], area: true, sub: 'garden' },
        { ...base, id: 11, kind: 'road', highway: 'residential', nodes: [0, 1], area: false },
      ],
      pois: [{ kind: 'greenMarket', lat: 39.490123, lon: -0.399876 }],
    }
    const enc = encodeOsm(data)
    const back = decodeOsm(JSON.parse(JSON.stringify(enc)))
    expect(back.ways[0]?.sub).toBe('garden')
    expect(back.ways[1]?.sub).toBeUndefined()
    expect(back.pois).toEqual([{ kind: 'greenMarket', lat: 39.490123, lon: -0.399876 }])
    // Version 1 rows had no style column and no landmark list.
    const v1 = { ...enc, v: 1 as const, subs: undefined, pois: undefined, ways: enc.ways.map((r) => [...r.slice(0, 3), ...r.slice(4)]) }
    const old = decodeOsm(v1)
    expect(old.ways[0]?.nodes).toEqual([0, 1, 2, 0])
    expect(old.ways[0]?.sub).toBeUndefined()
    expect(old.pois).toEqual([])
    // The committed demo fixture decodes with its landmark points.
    expect((loadDemoOsm().pois ?? []).length).toBeGreaterThan(50)
  })
})

describe('diagonal streets', () => {
  it('fills the step corners of a staircase road with asphalt', () => {
    const g = gridFrom(`
      RR....
      .RR...
      ..RR..
      ...RR.`)
    // (0,1) has road to the north and east, and on the NE diagonal (1,0).
    expect(diagonalCorners(g, 0, 1) & Corner.NE).toBe(Corner.NE)
    // (2,1) has road to the west (1,1) and south (2,2), and on the SW diagonal (1,2)? No, (1,2) is ground.
    expect(diagonalCorners(g, 2, 1) & Corner.SW).toBe(0)
    // Road tiles themselves never get corners.
    expect(diagonalCorners(g, 1, 1)).toBe(0)
  })

  it('turns a tile boxed in by roads into road', () => {
    const g = gridFrom(`
      .R.
      R.R
      .R.`)
    expect(diagonalCorners(g, 1, 1)).toBe(-1)
  })
})

describe('route path', () => {
  const pts = [
    { x: 0.5, y: 0.5 },
    { x: 10.5, y: 0.5 },
    { x: 10.5, y: 6.5 },
    { x: 4.5, y: 12.5 },
  ]
  const cum = [0, 50, 80, 122]
  const cells = routeCells(pts, cum)

  it('is a continuous chain of 4-adjacent tiles in walking order', () => {
    expect(cells[0]).toMatchObject({ x: 0, y: 0 })
    expect(cells[cells.length - 1]).toMatchObject({ x: 4, y: 12 })
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!
      const b = cells[i]!
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1)
      expect(b.along).toBeGreaterThanOrEqual(a.along - 1e-6)
    }
  })

  it('points arrows along the walking direction', () => {
    expect(dir8(1, 0)).toBe(0)
    expect(dir8(0, 1)).toBe(2)
    expect(dir8(-1, 0)).toBe(4)
    expect(dir8(0, -1)).toBe(6)
    expect(dir8(-1, 1)).toBe(3)
    const arrows = chevrons(cells, 6)
    expect(arrows.length).toBeGreaterThan(3)
    expect(arrows[0]!.dir).toBe(0) // first leg goes east
    const last = arrows[arrows.length - 1]!
    expect([2, 3, 4]).toContain(last.dir) // last leg goes south-west
    for (const p of ARROW_PATTERNS) {
      expect(p).toHaveLength(9)
      for (const row of p) expect(row).toMatch(/^[wk.]{9}$/)
    }
  })

  it('drops staircase corners so diagonals draw straight', () => {
    const diag = cells.filter((c) => c.y >= 7)
    const smooth = smoothPolyline(diag)
    expect(smooth.length).toBeLessThan(diag.length)
    expect(smooth[0]).toMatchObject({ x: diag[0]!.x, y: diag[0]!.y })
    expect(smooth[smooth.length - 1]).toMatchObject({ x: diag[diag.length - 1]!.x, y: diag[diag.length - 1]!.y })
  })
})

describe('walker sprite', () => {
  it('has three valid 16×16 frames per facing', () => {
    for (const f of ['down', 'up', 'left', 'right'] as const) {
      expect(WALKER[f]).toHaveLength(3)
      for (const s of WALKER[f]) {
        expect(spriteIsValid(s)).toBe(true)
        expect(s.rows).toHaveLength(16)
      }
      // The step frames differ from the standing one.
      expect(WALKER[f][1]!.rows.join()).not.toBe(WALKER[f][0]!.rows.join())
    }
    expect(WALKER.left[0]!.rows.join()).not.toBe(WALKER.right[0]!.rows.join())
  })

  it('faces the way it moves, with hysteresis on diagonals', () => {
    expect(facingFrom(1, 0)).toBe('right')
    expect(facingFrom(-1, 0)).toBe('left')
    expect(facingFrom(0, -1)).toBe('up')
    expect(facingFrom(0, 1)).toBe('down')
    expect(facingFrom(0.01, 0, 'up')).toBe('up')
    expect(facingFrom(1, 1.1, 'right')).toBe('right')
    expect(facingFrom(1, 1.1, 'down')).toBe('down')
  })

  it('cycles stand, step, stand, other step only while moving', () => {
    expect([0, 140, 280, 420, 560].map((t) => walkFrame(t, true))).toEqual([0, 1, 0, 2, 0])
    expect(walkFrame(140, false)).toBe(0)
  })
})

describe('structure painters', () => {
  class Recorder {
    fillStyle: string | CanvasGradient | CanvasPattern = ''
    calls = 0
    colours = new Set<string>()
    fillRect(x: number, y: number, w: number, h: number) {
      expect(Number.isFinite(x + y + w + h)).toBe(true)
      this.calls++
      this.colours.add(String(this.fillStyle))
    }
  }

  it('paints every house and landmark kind with several colours', () => {
    for (const kind of ['house', 'apartments', 'warehouse'] as const) {
      const ctx = new Recorder()
      paintHouse(ctx, 0, 0, { x: 0, y: 0, w: 4, h: 3, kind, roof: 2, wall: 1, door: 1, seed: 7, frontYard: true })
      expect(ctx.calls, kind).toBeGreaterThan(20)
      expect(ctx.colours.size, kind).toBeGreaterThan(4)
    }
    for (const kind of ['healing', 'station', 'school', 'greenMarket', 'market', 'parkGate'] as const) {
      const ctx = new Recorder()
      paintLandmark(ctx, 0, 0, { kind, x: 0, y: 0, w: kind === 'parkGate' ? 3 : 5, h: kind === 'parkGate' ? 2 : 4, vertical: true })
      expect(ctx.calls, kind).toBeGreaterThan(20)
      expect(ctx.colours.size, kind).toBeGreaterThan(4)
    }
    const ctx = new Recorder()
    paintGardenTree(ctx, 0, 0, 1)
    paintFrontFence(ctx, 0, 0, false)
    paintFrontFence(ctx, 0, 0, true)
    expect(ctx.calls).toBeGreaterThan(10)
  })
})
