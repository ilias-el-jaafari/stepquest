import type { LatLon } from '../geo/geo.ts'

/** One position reading, from the browser or the simulator. */
export type GpsFix = {
  lat: number
  lon: number
  /** Horizontal accuracy radius in metres (68 % confidence, as the browser reports it). */
  accuracy: number
  /** Milliseconds since the epoch. */
  timestamp: number
}

export type QuestRoute = {
  mode: 'loop' | 'oneway'
  points: LatLon[]
  distanceM: number
  steps: number
  targetSteps: number
  checkpoints: { index: number; point: LatLon; distanceM: number; isFinish: boolean }[]
}
