// Downloads four z14 OpenFreeMap tiles around a tile corner in València and keeps only the walkable
// street lines within about 1 km of the corner (the seam test fixture of src/vector/walkNet.test.ts).
// Usage: node scripts/build-tile-fixture.ts [out.json]
import { writeFileSync } from 'node:fs'
import { encodeOsm } from '../src/osm/codec.ts'
import type { OsmData } from '../src/osm/types.ts'
import { tileToOsm } from '../src/vector/omt.ts'
import { latOf, lonOf, tileXY } from '../src/vector/tileMath.ts'

const UA = 'StepQuest-fixture/1.0 (ilias.el.jaafari.el.idrissi@gmail.com)'
const out = process.argv[2] ?? 'src/vector/__fixtures__/valencia-z14.json'
const Z = 14
const c = tileXY(39.4697, -0.3774, Z)
const x0 = Math.round(c.x) - 1
const y0 = Math.round(c.y) - 1
const corner = { lat: latOf(y0 + 1, Z), lon: lonOf(x0 + 1, Z) }
const R = 1000
const dLat = R / 111_195
const dLon = R / (111_195 * Math.cos((corner.lat * Math.PI) / 180))
const json = (await (await fetch('https://tiles.openfreemap.org/planet', { headers: { 'User-Agent': UA } })).json()) as { tiles: string[] }
const tiles: unknown[] = []
for (const y of [y0, y0 + 1]) {
  for (const x of [x0, x0 + 1]) {
    const url = json.tiles[0]!.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y))
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    const data = tileToOsm(new Uint8Array(await res.arrayBuffer()), { z: Z, x, y })
    const keep = data.ways.filter((w) => w.walkable && !w.area && (w.kind === 'road' || w.kind === 'path') && w.nodes.some((n) => Math.abs(data.lat[n]! - corner.lat) < dLat && Math.abs(data.lon[n]! - corner.lon) < dLon))
    const lat: number[] = []
    const lon: number[] = []
    const ways = keep.map((w) => ({ ...w, nodes: w.nodes.map((n) => (lat.push(data.lat[n]!), lon.push(data.lon[n]!), lat.length - 1)) }))
    const slim: OsmData = { ...data, lat: Float64Array.from(lat), lon: Float64Array.from(lon), ways, pois: [] }
    tiles.push({ id: { z: Z, x, y }, data: encodeOsm(slim) })
  }
}
writeFileSync(out, JSON.stringify({ corner, tiles }))
console.log('wrote', out, JSON.stringify({ corner, tiles }).length, 'bytes')
