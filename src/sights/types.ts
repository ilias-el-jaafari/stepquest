/**
 * Sights (landmarks spec): places worth a look along the route. Order matters: the index is stored in the
 * compact codec. Append only.
 */
export const SIGHT_KINDS = ['university', 'school', 'hospital', 'church', 'mosque', 'synagogue', 'temple', 'townHall', 'tower', 'arch', 'statue', 'fountain'] as const
export type SightKind = (typeof SIGHT_KINDS)[number]

/** Generic monument designs; only these compete for the two "best-known monument" places. */
export const MONUMENT_KINDS: readonly SightKind[] = ['tower', 'arch', 'statue', 'fountain']
export const isMonumentKind = (k: SightKind): boolean => MONUMENT_KINDS.includes(k)

/** What a monument candidate is in the data (tourism=attraction, historic=*). Order matters: stored in the codec. */
export const MONUMENT_CLASSES = ['attraction', 'monument', 'memorial', 'castle', 'ruins'] as const
export type MonumentClass = (typeof MONUMENT_CLASSES)[number]

/** A sight as loaded with the map. */
export type Sight = {
  kind: SightKind
  lat: number
  lon: number
  name?: string
  /** OpenMapTiles poi rank (lower is more important); absent when the source has none. */
  rank?: number
  /** Monument candidates: what the data calls it. */
  monument?: MonumentClass
  wikidata?: boolean
  wikipedia?: boolean
}

/**
 * The real area of a sight (task 92). `grounds`: a landuse polygon (university, school, hospital campus);
 * `footprint`: the building polygon that holds the sight's point. `ring` is flat `[lat, lon, lat, lon, ...]`,
 * not closed, clipped at the tile edge like every polygon of the tiles.
 */
export type Ground = { kind: SightKind; mode: 'grounds' | 'footprint'; ring: number[] }

/** A sight with the rings of its linked area (one or more pieces, flat lat/lon). */
export type LinkedSight = Sight & { area?: { mode: Ground['mode']; rings: number[][] } }

/** A sight kept for one route: where it is and where it lies along the way. */
export type SightMark = {
  id: string
  kind: SightKind
  lat: number
  lon: number
  name?: string
  /** Metres along the route to the point closest to the sight. */
  alongM: number
  /** Metres from the route (to the grounds or footprint when it has one). */
  lateralM: number
  /** The area to draw at its real size, when the data has one. */
  area?: { mode: Ground['mode']; rings: number[][] }
}

/** Draw only sights this close to the route (metres). */
export const CORRIDOR_M = 50
/** Wisp comments when the hero is this close (metres): the sight is on the phone screen then (a sight is drawn out to `CORRIDOR_M`). */
export const PASS_M = 35
/** Sights of one kind this close are one place (metres). */
export const MERGE_M = 80

export const sightId = (s: Pick<Sight, 'kind' | 'lat' | 'lon'>): string => `${s.kind}:${Math.round(s.lat * 1e6)}:${Math.round(s.lon * 1e6)}`
