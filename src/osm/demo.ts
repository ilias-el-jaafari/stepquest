import fixture from '../data/benicalap.osm.json'
import { decodeOsm, type CompactOsm } from './codec.ts'
import type { OsmData } from './types.ts'

let cached: OsmData | undefined

/** Synchronous access to the bundled Benicalap extract (tests and Node scripts). */
export function loadDemoOsm(): OsmData {
  cached ??= decodeOsm(fixture as unknown as CompactOsm)
  return cached
}
