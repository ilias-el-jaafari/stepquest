import { P } from '../render/palette.ts'

/**
 * Street classes of a LOD tile (requirement 25.2), in drawing order from the smallest to the biggest.
 * The class is stored in a byte; bit `NO_FOOT` marks a line a pedestrian may not use.
 */
export const Street = { path: 0, track: 1, service: 2, minor: 3, tertiary: 4, secondary: 5, primary: 6, trunk: 7, motorway: 8, busway: 9, rail: 10 } as const
export type StreetClass = (typeof Street)[keyof typeof Street]
export const STREET_CLASS_COUNT = 11
/** Flag on a street line: walking is not allowed (motorway, trunk, busway, `foot=no`, private access). */
export const NO_FOOT = 0x80
export const CLASS_MASK = 0x7f

/** Area kinds of a LOD tile. */
export const Area = { green: 0, water: 1, building: 2 } as const
export type AreaKind = (typeof Area)[keyof typeof Area]

/** Widths in device px at the 256 px level; the 512 and 1024 levels scale them. */
export const STREET_WIDTH: Record<number, number> = {
  [Street.path]: 1,
  [Street.track]: 1,
  [Street.service]: 1,
  [Street.minor]: 2,
  [Street.tertiary]: 3,
  [Street.secondary]: 4,
  [Street.primary]: 5,
  [Street.trunk]: 5,
  [Street.motorway]: 6,
  [Street.busway]: 2,
  [Street.rail]: 1,
}

/** Classes drawn with a darker casing (tertiary and up). */
export const hasCasing = (cls: number): boolean => cls >= Street.tertiary && cls <= Street.motorway

/** Label priority: higher is placed first. */
export const labelRank = (cls: number): number => (cls >= Street.tertiary && cls <= Street.motorway ? cls : cls === Street.minor ? 3 : cls === Street.service ? 2 : 1)

/** The OpenMapTiles `class` of a `transportation` or `transportation_name` feature as a street class (undefined: not drawn). */
export function streetClassOf(cls: string | undefined, sub?: string): StreetClass | undefined {
  switch (cls) {
    case 'motorway':
      return Street.motorway
    case 'trunk':
      return Street.trunk
    case 'primary':
      return Street.primary
    case 'secondary':
      return Street.secondary
    case 'tertiary':
      return Street.tertiary
    case 'minor':
      return Street.minor
    case 'service':
      return Street.service
    case 'track':
      return Street.track
    case 'busway':
      return Street.busway
    case 'path':
      // A pedestrian street is a street for the eye; footways, steps and cycleways are paths.
      return sub === 'pedestrian' ? Street.minor : Street.path
    case 'rail':
    case 'transit':
      return Street.rail
    default:
      return undefined
  }
}

/** Colours of the LOD look, from the overview palette (original; nothing taken from another map style). */
export const lodColours = () => ({
  ground: P.overview.ground,
  green: P.overview.park,
  water: P.overview.water,
  building: P.lod.building,
  rail: P.lod.rail,
  street: (cls: number): string => (cls === Street.path || cls === Street.track ? P.lod.path : cls >= Street.secondary && cls <= Street.motorway ? P.lod.major : P.lod.street),
  casing: (cls: number): string => (cls >= Street.secondary && cls <= Street.motorway ? P.lod.majorCasing : P.lod.streetCasing),
})
