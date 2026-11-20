// Builds the bundled offline demo area from saved Overpass responses.
// Usage: node scripts/build-fixture.ts <out.json> <overpass.json> [more.json ...]
// Inputs are merged (e.g. the main `out geom` extract plus a landmark `out center` extract).
// The data is © OpenStreetMap contributors, available under the ODbL.
import { readFileSync, writeFileSync } from 'node:fs'
import { encodeOsm } from '../src/osm/codec.ts'
import { normalizeOverpass, type OverpassResponse } from '../src/osm/normalize.ts'
import { DEMO_AREA } from '../src/osm/demoArea.ts'

const [output, ...inputs] = process.argv.slice(2)
if (!output || inputs.length === 0) {
  console.error('usage: node scripts/build-fixture.ts <out.json> <overpass.json> [more.json ...]')
  process.exit(1)
}
type Element = NonNullable<OverpassResponse['elements']>[number] & { id?: number }
const merged = new Map<string, Element>()
let timestamp = ''
for (const input of inputs) {
  const raw = JSON.parse(readFileSync(input, 'utf8')) as OverpassResponse
  timestamp ||= raw.osm3s?.timestamp_osm_base ?? ''
  for (const el of (raw.elements ?? []) as Element[]) {
    const key = `${el.type}/${el.id ?? ''}`
    const prev = merged.get(key)
    // Keep the copy with geometry; carry over a centre if only the other copy has one.
    if (!prev || (!prev.geometry && el.geometry)) merged.set(key, { ...el, center: el.center ?? prev?.center })
  }
}
const data = normalizeOverpass({ elements: [...merged.values()], osm3s: { timestamp_osm_base: timestamp } }, DEMO_AREA.bbox, 'fixture')
writeFileSync(output, JSON.stringify(encodeOsm(data)))
const counts = new Map<string, number>()
for (const p of data.pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
console.log(`${data.ways.length} ways, ${data.lat.length} nodes, landmarks ${JSON.stringify(Object.fromEntries(counts))} -> ${output}`)
