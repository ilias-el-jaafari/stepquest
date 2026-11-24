import { describe, expect, it } from 'vitest'
import { decodeOsm, encodeOsm } from '../osm/codec.ts'
import { loadDemoOsm } from '../osm/demo.ts'
import type { OsmData, OsmWay } from '../osm/types.ts'
import { buildTileGrid } from './rasterize.ts'

/**
 * Benchmark of the data layer on large areas (task 66.10). Budgets are
 * several times the measured times so a slow CI machine does not flake, and
 * far below the "before" numbers of the unbounded rasterizer (see design.md).
 */
function synthetic(km: number, withContinent: boolean): OsmData {
  const lat0 = 39.4
  const lon0 = -0.4
  const dLat = km / 111.32
  const dLon = km / (111.32 * Math.cos((lat0 * Math.PI) / 180))
  const lat: number[] = []
  const lon: number[] = []
  const ways: OsmWay[] = []
  const node = (la: number, lo: number) => (lat.push(la), lon.push(lo), lat.length - 1)
  const add = (kind: OsmWay['kind'], nodes: number[], extra: Partial<OsmWay> = {}) =>
    ways.push({ id: ways.length + 1, kind, walkable: kind === 'road', area: false, tunnel: false, crossing: false, nodes, ...(kind === 'road' ? { highway: 'residential' } : {}), ...extra })
  for (let la = lat0; la < lat0 + dLat; la += 0.0008) for (let lo = lon0; lo < lon0 + dLon; lo += 0.002) add('road', [node(la, lo), node(la, lo + 0.002)])
  for (let lo = lon0; lo < lon0 + dLon; lo += 0.00104) {
    let prev = node(lat0, lo)
    for (let la = lat0 + 0.002; la < lat0 + dLat; la += 0.002) {
      const n = node(la, lo)
      add('road', [prev, n])
      prev = n
    }
  }
  for (let la = lat0; la < lat0 + dLat; la += 0.0012) {
    for (let lo = lon0; lo < lon0 + dLon; lo += 0.0016) {
      const ring = [node(la + 0.0002, lo + 0.0002), node(la + 0.0002, lo + 0.001), node(la + 0.0008, lo + 0.001), node(la + 0.0008, lo + 0.0002)]
      add('building', [...ring, ring[0]!], { area: true })
    }
  }
  if (withContinent) {
    // A forest 110 km wide and a 70 km river, both mostly outside the area (as Overpass returns whole ways).
    const ring = [node(lat0 - 0.5, lon0 - 0.5), node(lat0 - 0.5, lon0 + 0.5), node(lat0 + 0.5, lon0 + 0.5), node(lat0 + 0.5, lon0 - 0.5)]
    add('park', [...ring, ring[0]!], { area: true, sub: 'wood' })
    add('waterway', [node(lat0 - 0.3, lon0 - 0.3), node(lat0 + 0.3, lon0 + 0.3)])
  }
  return { bbox: { south: lat0, west: lon0, north: lat0 + dLat, east: lon0 + dLon }, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [], source: 'overpass', timestamp: '' }
}

const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now()
  const out = fn()
  return [out, performance.now() - t0]
}

describe('data layer cost (66.10)', () => {
  it('rasterizes a 6 × 6 km area (the 36 km² cap, 1200 × 1200 tiles) in well under a second', () => {
    const data = synthetic(6, false)
    const [grid, ms] = time(() => buildTileGrid(data))
    expect(grid.cols).toBeGreaterThan(1100)
    expect(ms).toBeLessThan(1000)
  })

  it('costs the same when a continental forest and a long river cross the area (before: 5.1 s, unclipped)', () => {
    const [, plain] = time(() => buildTileGrid(synthetic(6, false)))
    const [grid, huge] = time(() => buildTileGrid(synthetic(6, true)))
    expect(huge).toBeLessThan(1500)
    expect(huge).toBeLessThan(plain * 8 + 300)
    // The forest covers the area, then streets and buildings are drawn on top of it.
    expect(grid.layers[grid.index(3, 3)]! & 2).toBe(2)
  })

  it('rasterizes the bundled Benicalap area and round-trips its extract quickly', () => {
    const demo = loadDemoOsm()
    expect(time(() => buildTileGrid(demo))[1]).toBeLessThan(500)
    const compact = encodeOsm(demo)
    expect(time(() => encodeOsm(demo))[1]).toBeLessThan(300)
    expect(time(() => decodeOsm(JSON.parse(JSON.stringify(compact))))[1]).toBeLessThan(500)
  })
})
