import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bboxAround } from '../geo/geo.ts'
import { LANDMARK_KINDS, type LandmarkKind, type Poi } from '../osm/types.ts'
import { PARK_STYLES, Terrain, TileGrid } from '../tiles/grid.ts'
import { layoutTown, type Landmark, type TownLayout } from './layout.ts'

/** Review (Nov 2026) regression and property tests for the town layout. */

const TERRAINS = [Terrain.ground, Terrain.road, Terrain.building, Terrain.park, Terrain.water, Terrain.path, Terrain.plaza] as const

/** A grid of about `tiles` × `tiles` tiles (5 m each) in Valencia. */
function sized(tiles: number): TileGrid {
  return new TileGrid(bboxAround({ lat: 39.49, lon: -0.39 }, (tiles * 5) / 2), 5)
}

function poiAt(g: TileGrid, kind: LandmarkKind, x: number, y: number): Poi {
  const p = g.projection.toLatLon((x + 0.5) * g.metresPerTile, (y + 0.5) * g.metresPerTile)
  return { kind, lat: p.lat, lon: p.lon }
}

function fillRect(g: TileGrid, x0: number, y0: number, w: number, h: number, t: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.terrain[g.index(x, y)] = t
}

function inRect(r: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
}

function overlap(a: Landmark, b: Landmark) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Everything that must hold for any grid. */
function checkInvariants(g: TileGrid, town: TownLayout) {
  const seen = new Set<number>()
  town.houses.forEach((h, k) => {
    expect(h.w).toBeGreaterThanOrEqual(2)
    expect(h.h).toBeGreaterThanOrEqual(2)
    expect(h.door).toBeGreaterThanOrEqual(0)
    expect(h.door).toBeLessThan(h.w)
    for (let y = h.y; y < h.y + h.h; y++)
      for (let x = h.x; x < h.x + h.w; x++) {
        expect(g.inBounds(x, y)).toBe(true)
        const i = g.index(x, y)
        expect(g.terrain[i]).toBe(Terrain.building)
        expect(seen.has(i)).toBe(false)
        seen.add(i)
        expect(town.houseAt[i]).toBe(k)
        for (const l of town.landmarks) expect(inRect(l, x, y)).toBe(false)
      }
  })
  for (let a = 0; a < town.landmarks.length; a++) {
    const l = town.landmarks[a]!
    expect(l.x).toBeGreaterThanOrEqual(0)
    expect(l.y).toBeGreaterThanOrEqual(0)
    expect(l.x + l.w).toBeLessThanOrEqual(g.cols)
    expect(l.y + l.h).toBeLessThanOrEqual(g.rows)
    for (let b = a + 1; b < town.landmarks.length; b++) expect(overlap(l, town.landmarks[b]!)).toBe(false)
  }
  for (const set of [town.trees, town.fences, town.gates]) for (const i of set) expect(town.houseAt[i]).toBe(-1)
  for (const i of town.trees) {
    expect(town.fences.has(i)).toBe(false)
    expect(town.gates.has(i)).toBe(false)
    expect(g.terrain[i]).toBe(Terrain.building)
  }
}

describe('town layout review: regressions', () => {
  it('B1: landmarks do not depend on the order of the points in the data', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    fillRect(g, 20, 20, 6, 6, Terrain.building)
    const pois = [poiAt(g, 'school', 22, 22), poiAt(g, 'market', 23, 23), poiAt(g, 'healing', 22, 24), poiAt(g, 'station', 24, 22)]
    g.pois = pois
    const a = layoutTown(g)
    g.pois = [...pois].reverse()
    const b = layoutTown(g)
    g.pois = [pois[2]!, pois[0]!, pois[3]!, pois[1]!]
    const c = layoutTown(g)
    expect(a.landmarks.length).toBeGreaterThan(1)
    expect(b.landmarks).toEqual(a.landmarks)
    expect(c.landmarks).toEqual(a.landmarks)
  })

  it('B2: two points of one kind on the same tile make one landmark', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    g.pois = [poiAt(g, 'school', 30, 30), poiAt(g, 'school', 30, 30), poiAt(g, 'school', 31, 30)]
    expect(layoutTown(g).landmarks.filter((l) => l.kind === 'school')).toHaveLength(1)
  })

  it('B3: a point with an unknown kind or broken coordinates is skipped instead of throwing', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    g.pois = [
      { kind: 'spaceport' as LandmarkKind, lat: g.bbox.north - 0.0002, lon: g.bbox.west + 0.0002 },
      { kind: 'school', lat: Number.NaN, lon: 0 },
      { kind: 'school', lat: g.bbox.north + 5, lon: g.bbox.west },
      poiAt(g, 'market', 30, 30),
    ]
    const town = layoutTown(g)
    expect(town.landmarks.map((l) => l.kind)).toEqual(['market'])
  })

  it('B4: a park gate never overlaps a landmark and never leaves the map', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    fillRect(g, 10, 10, 30, 30, Terrain.park)
    for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) g.style[g.index(x, y)] = PARK_STYLES.indexOf('park')
    // Footpath tiles stepping into the park at the top edge and along the map's first row.
    fillRect(g, 25, 8, 1, 3, Terrain.path)
    // A landmark right next to the entrance, partly inside the park.
    g.pois = [poiAt(g, 'market', 26, 11)]
    const town = layoutTown(g)
    const gates = town.landmarks.filter((l) => l.kind === 'parkGate')
    expect(gates.length).toBeGreaterThan(0)
    for (const gate of gates) {
      expect(gate.x).toBeGreaterThanOrEqual(0)
      expect(gate.y).toBeGreaterThanOrEqual(0)
      for (const l of town.landmarks) if (l !== gate) expect(overlap(gate, l)).toBe(false)
    }
    checkInvariants(g, town)
  })

  it('B4b: a house never covers the tiles of a park gate', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    fillRect(g, 10, 10, 30, 30, Terrain.park)
    fillRect(g, 25, 10, 1, 3, Terrain.path)
    // A small block of buildings right where the arch of the gate is drawn.
    fillRect(g, 22, 5, 7, 5, Terrain.building)
    const town = layoutTown(g)
    const gate = town.landmarks.find((l) => l.kind === 'parkGate')
    expect(gate).toBeDefined()
    for (let y = gate!.y; y < gate!.y + gate!.h; y++) for (let x = gate!.x; x < gate!.x + gate!.w; x++) expect(town.houseAt[g.index(x, y)]).toBe(-1)
    checkInvariants(g, town)
  })

  it('B5: a gate in the first rows of the map stays inside the map', () => {
    const g = sized(60)
    fillRect(g, 0, 0, g.cols, g.rows, Terrain.ground)
    fillRect(g, 20, 0, 26, 6, Terrain.park)
    // An east–west footpath tile on row 1 with park above and below: its gate would start at row -1.
    fillRect(g, 20, 1, 1, 1, Terrain.path)
    const town = layoutTown(g)
    for (const l of town.landmarks) {
      expect(l.x).toBeGreaterThanOrEqual(0)
      expect(l.y).toBeGreaterThanOrEqual(0)
      expect(l.x + l.w).toBeLessThanOrEqual(g.cols)
      expect(l.y + l.h).toBeLessThanOrEqual(g.rows)
    }
  })

  it('B6: garden trees never stand on a fence or a gate tile', () => {
    let fences = 0
    for (let seed = 0; seed < 12; seed++) {
      // Shift the block so the BSP and random draws differ.
      const h = sized(80)
      fillRect(h, 0, 0, h.cols, h.rows, Terrain.road)
      fillRect(h, 3 + seed, 4 + (seed % 5), 50 + seed, 40 + seed, Terrain.building)
      const town = layoutTown(h)
      fences += town.fences.size
      for (const i of town.trees) expect(town.fences.has(i) || town.gates.has(i)).toBe(false)
    }
    expect(fences).toBeGreaterThan(0)
  })
})

describe('town layout review: properties', () => {
  const gridArb = fc
    .record({
      seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
      size: fc.integer({ min: 12, max: 48 }),
      blobs: fc.integer({ min: 1, max: 12 }),
    })
    .map(({ seed, size, blobs }) => {
      const g = sized(size)
      let s = seed
      const next = (n: number) => {
        s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
        return s % n
      }
      for (let k = 0; k < blobs; k++) {
        const t = TERRAINS[next(TERRAINS.length)]!
        fillRect(g, next(g.cols), next(g.rows), 1 + next(24), 1 + next(24), t)
      }
      // Clip painting that ran past the edge: fillRect writes by index, so wrap-around cells are real tiles. Fine.
      const pois: Poi[] = []
      for (let k = 0; k < next(6); k++) pois.push(poiAt(g, LANDMARK_KINDS[next(LANDMARK_KINDS.length)]!, next(g.cols), next(g.rows)))
      g.pois = pois
      return g
    })

  it('houses stay on building tiles, never overlap, never sit on a landmark or gate', () => {
    fc.assert(
      fc.property(gridArb, (g) => {
        checkInvariants(g, layoutTown(g))
      }),
      { numRuns: 60 },
    )
  })

  it('the layout is the same whatever the order of the points and each landmark is placed at most once', () => {
    fc.assert(
      fc.property(gridArb, fc.integer({ min: 0, max: 1000 }), (g, shuffleSeed) => {
        const a = layoutTown(g)
        const pois = [...g.pois]
        let s = shuffleSeed + 1
        for (let i = pois.length - 1; i > 0; i--) {
          s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
          const j = s % (i + 1)
          ;[pois[i], pois[j]] = [pois[j]!, pois[i]!]
        }
        g.pois = pois
        const b = layoutTown(g)
        expect(b.landmarks).toEqual(a.landmarks)
        expect(b.houses).toEqual(a.houses)
        const real = a.landmarks.filter((l) => l.kind !== 'parkGate')
        expect(real.length).toBeLessThanOrEqual(new Set(pois.map((p) => `${p.kind}:${g.toTileXY(p).x | 0},${g.toTileXY(p).y | 0}`)).size)
        // Each landmark lies near a point of its own kind.
        for (const l of real) {
          const near = pois.some((p) => {
            const t = g.toTileXY(p)
            return p.kind === l.kind && Math.abs(l.x + l.w / 2 - t.x) <= 9 + l.w / 2 + 1 && Math.abs(l.y + l.h / 2 - t.y) <= 9 + l.h / 2 + 1
          })
          expect(near).toBe(true)
        }
      }),
      { numRuns: 40 },
    )
  })
})
