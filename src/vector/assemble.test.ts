import { describe, expect, it } from 'vitest'
import { decodeOsm, encodeOsm } from '../osm/codec.ts'
import { Terrain } from '../tiles/grid.ts'
import { cellBBox, cellOf, type CellId } from '../world/cells.ts'
import { makeRecord } from '../world/testing.ts'
import { TileWorld } from '../world/tileWorld.ts'
import { anchorBuildings, cellFromTiles, DETAIL_Z, tilesForCell, type LoadedTile } from './assemble.ts'
import { tileToOsm } from './omt.ts'
import { encodeMvt, px } from './testing.ts'
import { latOf, lonOf, tileBBox, tileXY } from './tileMath.ts'

/**
 * A building across a real z14 seam over València: the vertical seam between columns 8174 and 8175
 * (lon -0.37353), inside cell (3949, -38). Each tile gets the whole outline with its buffer, as
 * OpenFreeMap sends it, and the decoder cuts it at the edge.
 */
const W = { z: DETAIL_Z, x: 8174, y: tileYAt(39.4951) }
const E = { ...W, x: W.x + 1 }
function tileYAt(lat: number) {
  return Math.floor(tileXY(lat, -0.3735, DETAIL_Z).y)
}
const seamLon = tileBBox(W).east
/** 60 × 40 m, a little more on the west side; corners in global tile units so both tiles hold the same numbers. */
const corners: [number, number][] = [
  [39.4953, seamLon - 0.0004],
  [39.4953, seamLon + 0.0003],
  [39.4949, seamLon + 0.0003],
  [39.4949, seamLon - 0.0004],
]

function tileWith(t: typeof W, codec = false): LoadedTile {
  const ring = [...corners, corners[0]!].map(([la, lo]) => px(t, la, lo))
  const bytes = encodeMvt([{ name: 'building', features: [{ type: 3, geometry: [ring] }] }])
  const data = tileToOsm(bytes, t)
  return { id: t, data: codec ? decodeOsm(encodeOsm(data)) : data }
}

/** The same outline, whole, at the exact degrees of the integer tile coordinates. */
function wholeRecord(cell: CellId) {
  const g = (la: number, lo: number): [number, number] => {
    const [x, y] = px(W, la, lo)
    return [latOf(W.y + y / 4096, DETAIL_Z), lonOf(W.x + x / 4096, DETAIL_Z)]
  }
  const ring = [...corners, corners[0]!].map(([la, lo]) => g(la, lo))
  return makeRecord(cell, [{ id: 1, kind: 'building', area: true, pts: ring }])
}

const cell = cellOf({ lat: 39.4951, lon: seamLon })

function paintRec(rec: ReturnType<typeof wholeRecord>) {
  const tw = new TileWorld(cell)
  tw.paint(rec)
  const own = tw.ownedRect(cell)!
  const building: number[] = []
  const houses: string[] = []
  for (let y = own.y; y < own.y + own.h; y++) {
    for (let x = own.x; x < own.x + own.w; x++) {
      const i = tw.grid.index(x, y)
      if (tw.grid.terrain[i] === Terrain.building) building.push(i)
      const h = tw.town.houseAt(i)
      if (h) houses.push(`${i}:${h.x},${h.y},${h.w},${h.h}`)
    }
  }
  return { building, houses }
}

describe('buildings across a tile seam (requirement 21.6)', () => {
  it('sits on a real seam: the building is in both tiles, cut at the shared edge', () => {
    expect(tilesForCell(cell, DETAIL_Z).map((t) => t.x)).toEqual(expect.arrayContaining([W.x, E.x]))
    const w = tileWith(W).data
    const e = tileWith(E).data
    expect(w.ways).toHaveLength(1)
    expect(e.ways).toHaveLength(1)
    expect(Math.max(...w.ways[0]!.nodes.map((n) => w.lon[n]!))).toBe(seamLon)
    expect(Math.min(...e.ways[0]!.nodes.map((n) => e.lon[n]!))).toBe(seamLon)
    expect(cellBBox(cell).west).toBeLessThan(seamLon - 0.0004)
    expect(cellBBox(cell).east).toBeGreaterThan(seamLon + 0.0003)
  })

  it('groups the two halves and gives them one anchor, also after the cache codec', () => {
    for (const codec of [false, true]) {
      const tiles = [tileWith(W, codec), tileWith(E, codec)]
      const anchors = anchorBuildings(tiles)
      expect(anchors.size).toBe(2)
      const [a, b] = [...anchors.values()]
      expect(a).toEqual(b)
      expect(a!.lon).toBeCloseTo(seamLon - 0.00005, 5)
    }
  })

  it('rasterizes the two halves to exactly the tiles of the whole building, with the same houses', () => {
    const whole = paintRec(wholeRecord(cell))
    for (const codec of [false, true]) {
      const rec = cellFromTiles(cell, [tileWith(W, codec), tileWith(E, codec)], true)!
      const cut = paintRec(rec)
      expect(cut.building.length).toBeGreaterThan(60)
      // At most a tile of rounding where the codec moved a corner by 0.1 m; none from the seam.
      const diff = cut.building.filter((i) => !whole.building.includes(i)).length + whole.building.filter((i) => !cut.building.includes(i)).length
      expect(diff).toBeLessThanOrEqual(codec ? 2 : 0)
      if (!codec) expect(cut.houses).toEqual(whole.houses)
      expect(cut.houses.length).toBeGreaterThan(cut.building.length * 0.5)
    }
  })

  it('builds the houses once, from the cell that holds the group centre, whichever cell arrives first', () => {
    const tiles = [tileWith(W), tileWith(E)]
    const west = { i: cell.i, j: cell.j - 1 }
    const recs = [cellFromTiles(cell, tiles, true)!, cellFromTiles(west, tiles, true)!]
    const layout = (order: typeof recs) => {
      const tw = new TileWorld(cell)
      for (const r of order) tw.paint(r)
      const seen = new Set<string>()
      for (let cy = 0; cy * 32 < tw.grid.rows; cy++) for (let cx = 0; cx * 32 < tw.grid.cols; cx++) for (const h of tw.town.structuresIn(cx, cy, 32)?.houses ?? []) seen.add(`${h.x},${h.y},${h.w},${h.h}`)
      return [...seen].sort()
    }
    expect(layout(recs)).toEqual(layout([...recs].reverse()))
    expect(layout(recs).length).toBeGreaterThan(0)
  })
})
