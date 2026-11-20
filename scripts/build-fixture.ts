// Builds the bundled offline demo area from a saved Overpass `out geom` response.
// Usage: node scripts/build-fixture.ts <overpass.json> [out.json]
// The data is © OpenStreetMap contributors, available under the ODbL.
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeOsm } from '../src/osm/codec.ts'
import { normalizeOverpass, type OverpassResponse } from '../src/osm/normalize.ts'
import { DEMO_AREA } from '../src/osm/demoArea.ts'

const [input, output = 'src/data/benicalap.osm.json'] = process.argv.slice(2)
if (!input) {
  console.error('usage: node scripts/build-fixture.ts <overpass.json> [out.json]')
  process.exit(1)
}
const raw = JSON.parse(readFileSync(input, 'utf8')) as OverpassResponse
const data = normalizeOverpass(raw, DEMO_AREA.bbox, 'fixture')
const compact = encodeOsm(data)
writeFileSync(output, JSON.stringify(compact))
console.log(`${data.ways.length} ways, ${data.lat.length} nodes -> ${output}`)
