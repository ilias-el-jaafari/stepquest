export const METER_SEGMENTS = 10

/** Filled segments for a percentage (0…segments), rounding down so a segment means a full tenth. */
export function filledSegments(pct: number, segments = METER_SEGMENTS): number {
  if (!Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(segments, Math.floor((pct / 100) * segments)))
}
