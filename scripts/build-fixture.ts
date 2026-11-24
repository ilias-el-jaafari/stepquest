// Builds the bundled offline demo area from saved Overpass responses.
// Usage: node scripts/build-fixture.ts <out.json> <overpass.json> [more.json ...]
// Inputs are merged (e.g. the main `out geom` extract plus a landmark `out center` extract).
// Set KEEP_POIS=<old fixture.json> to carry over landmarks from a previous build
// (handy when the landmark `out center` query cannot be re-run).
// The data is © OpenStreetMap contributors, available under the ODbL.
import { readFileSync, writeFileSync } from 'node:fs'
import { decodeOsm, encodeOsm, type CompactOsm } from '../src/osm/codec.ts'
import { dedupePois } from '../src/osm/landmarks.ts'
import { isOverpassResponse } from '../src/osm/download.ts'
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
  const raw: unknown = JSON.parse(readFileSync(input, 'utf8'))
  if (!isOverpassResponse(raw)) {
    console.error(`${input}: not an Overpass answer (no "elements" array); nothing written`)
    process.exit(1)
  }
  // The newest base timestamp of all inputs (ISO strings sort like dates).
  const stamp = raw.osm3s?.timestamp_osm_base ?? ''
  if (stamp > timestamp) timestamp = stamp
  for (const el of (raw.elements ?? []) as Element[]) {
    const key = `${el.type}/${el.id ?? ''}`
    const prev = merged.get(key)
    // Keep the copy with geometry (or relation members); carry over a centre if only the other copy has one.
    if (!prev || (!prev.geometry && el.geometry) || (!prev.members && el.members)) merged.set(key, { ...el, center: el.center ?? prev?.center })
  }
}
const data = normalizeOverpass({ elements: [...merged.values()], osm3s: { timestamp_osm_base: timestamp } }, DEMO_AREA.bbox, 'fixture')
if (process.env.KEEP_POIS) {
  const old = decodeOsm(JSON.parse(readFileSync(process.env.KEEP_POIS, 'utf8')) as CompactOsm)
  data.pois = dedupePois([...old.pois, ...data.pois])
}
if (data.ways.length === 0) {
  console.error('no ways in the inputs; refusing to overwrite the fixture with an empty map')
  process.exit(1)
}
const compact = encodeOsm(data)
decodeOsm(JSON.parse(JSON.stringify(compact)) as CompactOsm) // throws if the encoded file would not load
writeFileSync(output, JSON.stringify(compact))
const counts = new Map<string, number>()
for (const p of data.pois) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1)
console.log(`${data.ways.length} ways (${data.ways.filter((w) => w.holes).length} with holes, ${data.ways.filter((w) => w.bridge).length} bridges), ${data.lat.length} nodes, landmarks ${JSON.stringify(Object.fromEntries(counts))} -> ${output}`)
