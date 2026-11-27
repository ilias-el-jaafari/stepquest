import { describe, expect, it } from 'vitest'
import { shotAt } from './camera.ts'
import { lightingAt } from '../render/daylight.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { DEMO_CLOCK, DEMO_DAY_MS, demoClockAt, DEMO_SETTINGS, demoGapM, demoGapScript, DEMO_WALK_SECONDS, demoCameraBlend, demoClockMinutes, demoProgress, demoTimeline, demoTimeScale, parseDemo } from './script.ts'
import { nextPacerStatus, pacerDistanceM, paceFor, startPacer, type PacerStatus } from '../ghost/pacer.ts'

describe('parseDemo', () => {
  it('turns on only for demo=1, with an optional language', () => {
    expect(parseDemo('')).toBeUndefined()
    expect(parseDemo('?demo=0')).toBeUndefined()
    expect(parseDemo('?demo=1')).toEqual({ lang: undefined })
    expect(parseDemo('?demo=1&lang=es')).toEqual({ lang: 'es' })
    expect(parseDemo('?lang=ES&demo=1')).toEqual({ lang: 'es' })
    expect(parseDemo('?demo=1&lang=fr')).toEqual({ lang: undefined })
    expect(parseDemo('?lang=es')).toBeUndefined()
  })
})

describe('demo timeline', () => {
  it('is the same every time and fits 60 to 90 seconds with room for the start and the summary', () => {
    const a = demoTimeline()
    expect(demoTimeline()).toEqual(a)
    expect(a.map((e) => e.event)).toEqual(['closeUp', 'pullOut', 'wholeRoute', 'comeBack', 'closeAgain', 'arrive'])
    expect(a.map((e) => e.atS)).toEqual([...a.map((e) => e.atS)].sort((x, y) => x - y))
    expect(a.at(-1)!.atS).toBe(DEMO_WALK_SECONDS)
    expect(DEMO_WALK_SECONDS + 12).toBeGreaterThanOrEqual(60)
    expect(DEMO_WALK_SECONDS + 12).toBeLessThanOrEqual(90)
  })

  it('walks any route in the same time', () => {
    for (const metres of [1500, 3375, 7500]) {
      const walkS = metres / (5 / 3.6)
      expect(walkS / demoTimeScale(metres)).toBeCloseTo(DEMO_WALK_SECONDS, 0)
    }
    expect(demoTimeScale(0)).toBe(1)
  })

  it('plans a loop of 6,000 steps', () => {
    expect(DEMO_SETTINGS).toEqual({ mode: 'loop', targetSteps: 6000, strideM: 0.75 })
  })
})

describe('demo clock', () => {
  it('runs from 18:30 to 22:30 in a straight line', () => {
    expect(demoClockMinutes(0)).toBe(18 * 60 + 30)
    expect(demoClockMinutes(0.5)).toBe(20 * 60 + 30)
    expect(demoClockMinutes(1)).toBe(22 * 60 + 30)
    expect(DEMO_CLOCK.toMin - DEMO_CLOCK.fromMin).toBe(240)
  })

  it('never goes backwards and stays inside the range for any input', () => {
    let last = -Infinity
    for (let i = 0; i <= 100; i++) {
      const m = demoClockMinutes(i / 100)
      expect(m).toBeGreaterThanOrEqual(last)
      last = m
    }
    expect(demoClockMinutes(-3)).toBe(DEMO_CLOCK.fromMin)
    expect(demoClockMinutes(9)).toBe(DEMO_CLOCK.toMin)
    expect(demoClockMinutes(Number.NaN)).toBe(DEMO_CLOCK.fromMin)
  })

  it('goes from afternoon light through sunset to lamps and windows on, in any time zone', () => {
    expect(new Date(demoClockAt(0)).toISOString()).toBe('2026-06-21T16:30:00.000Z')
    expect(demoClockAt(1) - demoClockAt(0)).toBe(240 * 60_000)
    expect(demoClockAt(0) - DEMO_DAY_MS).toBe((18 * 60 + 30) * 60_000)
    const start = lightingAt(demoClockAt(0), DEMO_AREA.center)
    const end = lightingAt(demoClockAt(1), DEMO_AREA.center)
    expect(start.lamps).toBe(0)
    expect(start.windows).toBe(0)
    expect(end.lamps).toBe(1)
    expect(end.windows).toBeGreaterThan(0.9)
    expect(end.darkness).toBeGreaterThan(start.darkness)
    let last = -1
    for (let i = 0; i <= 40; i++) {
      const lamps = lightingAt(demoClockAt(i / 40), DEMO_AREA.center).lamps
      expect(lamps).toBeGreaterThanOrEqual(last)
      last = lamps
    }
  })

  it('progress is the share of the route walked, and 1 once finished', () => {
    expect(demoProgress(750, 3000, false)).toBe(0.25)
    expect(demoProgress(10, 0, false)).toBe(0)
    expect(demoProgress(100, 3000, true)).toBe(1)
  })
})

describe('demo camera', () => {
  it('starts close, pulls out to the whole route, comes back and ends close', () => {
    expect(demoCameraBlend(0)).toBe(0)
    expect(demoCameraBlend(0.05)).toBe(0)
    expect(demoCameraBlend(0.45)).toBe(1)
    expect(demoCameraBlend(0.99)).toBe(0)
    expect(demoCameraBlend(1)).toBe(0)
    const mid = demoCameraBlend(0.19)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    for (let i = 0; i <= 200; i++) {
      const b = demoCameraBlend(i / 200)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(1)
    }
  })

  it('moves in small steps (no jump between neighbouring points of progress)', () => {
    for (let i = 0; i < 1000; i++) expect(Math.abs(demoCameraBlend((i + 1) / 1000) - demoCameraBlend(i / 1000))).toBeLessThan(0.05)
  })

  const base = { player: { x: 100, y: 100 }, bounds: { minX: 0, minY: 0, maxX: 600, maxY: 400 }, viewport: { w: 360, h: 640 }, closeZoom: 24, minZoom: 0.5 }

  it('shot 0 is the close view on the walker, shot 1 frames the whole route', () => {
    expect(shotAt({ ...base, blend: 0 })).toEqual({ x: 100, y: 100, zoom: 24 })
    const whole = shotAt({ ...base, blend: 1 })
    expect(whole.x).toBe(300)
    expect(whole.y).toBe(200)
    expect(whole.zoom).toBeLessThan(1)
    expect(whole.zoom * 600).toBeLessThanOrEqual(360)
  })

  it('never goes below the floor zoom and never past the close zoom', () => {
    expect(shotAt({ ...base, blend: 1, minZoom: 2 }).zoom).toBe(2)
    expect(shotAt({ ...base, blend: 1, bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 } }).zoom).toBe(24)
    expect(shotAt({ ...base, blend: Number.NaN })).toEqual({ x: 100, y: 100, zoom: 24 })
  })
})

describe('demo ghost choreography', () => {
  const script = demoGapScript(52)
  const statusAt = (walkS: number, prev: PacerStatus) => nextPacerStatus(prev, demoGapM(walkS), walkS * 1000 * 52)

  it('starts 34 m behind the ghost, catches up by 10 s, pulls ahead later and settles at the end', () => {
    expect(demoGapM(0)).toBe(-34)
    expect(demoGapM(10)).toBe(0)
    expect(demoGapM(40)).toBe(38)
    expect(demoGapM(DEMO_WALK_SECONDS)).toBe(0)
    expect(demoGapM(1e6)).toBe(0)
    expect(demoGapM(-3)).toBe(-34)
  })

  it('shows behind, on pace, then ahead, in that order, the first two within 15 s', () => {
    let status: PacerStatus = 'warmup'
    const seen: { s: number; status: PacerStatus }[] = []
    for (let s = 0; s <= DEMO_WALK_SECONDS; s += 0.5) {
      const next = statusAt(s, status)
      if (next !== status) seen.push({ s, status: next })
      status = next
    }
    expect(seen.map((x) => x.status)).toEqual(['behind', 'on', 'ahead', 'on'])
    expect(seen[0]!.s).toBeLessThan(2)
    expect(seen[1]!.s).toBeLessThan(15)
    expect(seen[2]!.s).toBeGreaterThan(25)
  })

  it('is deterministic and keeps the ghost moving forward', () => {
    expect(script(12_345)).toBe(demoGapScript(52)(12_345))
    // Ghost distance = hero's nominal distance minus the gap: never decreases in real time.
    let last = -Infinity
    for (let s = 0; s <= DEMO_WALK_SECONDS; s += 0.1) {
      const d = (s * 52 * 5) / 3.6 - demoGapM(s)
      expect(d).toBeGreaterThanOrEqual(last)
      last = d
    }
  })

  it('moves the pace point only when a plan has a script', () => {
    const plan = startPacer(0, paceFor(0.75), { rate: 52 })
    const scripted = { ...plan, gapScript: script }
    expect(pacerDistanceM(plan, 0)).toBe(0)
    expect(pacerDistanceM(scripted, 0)).toBe(34)
  })
})
