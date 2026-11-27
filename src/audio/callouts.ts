import { haversine, type LatLon } from '../geo/geo.ts'
import { directionTo, type CompassPoint } from '../quest/compass.ts'
import { gemTotal } from '../quest/gems.ts'
import { trackFor, type QuestEvent, type QuestState } from '../quest/quest.ts'
import { snapToRoute, type RouteTrack } from '../quest/snap.ts'
import { pointAlong } from '../routing/checkpoints.ts'
import { bearingBetween } from '../routing/planner.ts'
import type { Translate } from '../i18n/en.ts'
import type { SfxName } from './sfx.ts'

/**
 * What the voice says, and when. Pure: compares the quest state before and
 * after a GPS fix and returns phrases (as i18n keys and values). Distances
 * are rounded the way a person would say them.
 */

export type VoiceKey =
  | 'voice.start'
  | 'voice.startFlag'
  | 'voice.gem'
  | 'voice.gemLast'
  | 'voice.distance'
  | 'voice.distanceFlag'
  | 'voice.turnLeft'
  | 'voice.turnRight'
  | 'voice.offRoute'
  | 'voice.backOnRoute'
  | 'voice.halfway'
  | 'voice.finish'

/** Higher wins when the voice is busy. */
export const PRIORITY: Record<VoiceKey, number> = {
  'voice.finish': 5,
  'voice.gem': 4,
  'voice.gemLast': 4,
  'voice.offRoute': 3,
  'voice.start': 3,
  'voice.startFlag': 3,
  'voice.turnLeft': 2,
  'voice.turnRight': 2,
  'voice.backOnRoute': 2,
  'voice.halfway': 1,
  'voice.distance': 1,
  'voice.distanceFlag': 1,
}

export type Callout = { key: VoiceKey; vars: { m?: number; dir?: CompassPoint; n?: number; total?: number; steps?: number }; priority: number }

export const DISTANCE_MARKS = [500, 200, 100, 50] as const
/** Turns are announced this far ahead (metres along the route). */
export const TURN_WARN_M = 30
/** Heading change (degrees) that counts as a turn. */
export const TURN_MIN_DEG = 50

/** Round a distance like people say it: 10 m steps below 100, 50 m below 1 km, then 100 m. */
export function spokenMetres(m: number): number {
  const v = Math.max(0, m)
  if (v < 100) return Math.max(10, Math.round(v / 10) * 10)
  if (v < 1000) return Math.round(v / 50) * 50
  return Math.round(v / 100) * 100
}

export type Turn = { alongM: number; side: 'left' | 'right'; angle: number }

/** Signed heading change from a to b in degrees, -180…180 (negative = left). */
export function headingChange(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180
}

/**
 * Turns along the route: vertices where the heading (measured over ±20 m,
 * so tiny zig-zags do not count) changes by at least TURN_MIN_DEG. Close
 * vertices of one corner are merged into the sharpest.
 */
export function findTurns(track: RouteTrack, span = 20, mergeM = 25): Turn[] {
  const { points, cumulative, total } = track
  const raw: Turn[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const c = cumulative[i]!
    if (c < span || c > total - span) continue
    const before = pointAlong(points, cumulative, c - span)
    const after = pointAlong(points, cumulative, c + span)
    const here = points[i]!
    if (haversine(before, here) < span * 0.5 || haversine(here, after) < span * 0.5) continue
    const angle = headingChange(bearingBetween(before, here), bearingBetween(here, after))
    if (Math.abs(angle) >= TURN_MIN_DEG) raw.push({ alongM: c, side: angle < 0 ? 'left' : 'right', angle })
  }
  const merged: Turn[] = []
  for (const t of raw) {
    const last = merged[merged.length - 1]
    if (last && t.alongM - last.alongM < mergeM) {
      if (Math.abs(t.angle) > Math.abs(last.angle)) merged[merged.length - 1] = t
    } else merged.push(t)
  }
  return merged
}

function dirFrom(state: QuestState, to: LatLon): CompassPoint {
  const from = state.player ?? state.route.points[0] ?? to
  return directionTo(from, to).point
}

/** Tracks what has been said so a phrase is not repeated when GPS jitters. */
export class CalloutPlanner {
  readonly track: RouteTrack
  readonly turns: Turn[]
  private spokenMarks = new Set<string>()
  private spokenTurns = new Set<number>()
  private halfwaySaid = false

  constructor(state: QuestState) {
    this.track = trackFor(state.route)
    this.turns = findTurns(this.track)
    // On resume, do not announce what is already behind.
    this.halfwaySaid = state.alongM >= state.route.distanceM / 2
    this.turns.forEach((t, i) => {
      if (t.alongM <= state.alongM + 5) this.spokenTurns.add(i)
    })
  }

  /** The opening line when a quest starts. */
  start(state: QuestState): Callout {
    const cps = state.route.checkpoints
    const first = cps[state.collected]
    if (!first) return { key: 'voice.startFlag', vars: { m: 0, dir: 'N' }, priority: PRIORITY['voice.startFlag'] }
    const m = spokenMetres(first.distanceM - state.alongM)
    const key = first.isFinish ? 'voice.startFlag' : 'voice.start'
    return { key, vars: { m, dir: dirFrom(state, first.point) }, priority: PRIORITY[key] }
  }

  update(prev: QuestState, next: QuestState, events: readonly QuestEvent[]): Callout[] {
    const out: Callout[] = []
    const say = (key: VoiceKey, vars: Callout['vars']) => out.push({ key, vars, priority: PRIORITY[key] })
    const cps = next.route.checkpoints
    const steps = Math.round(next.odometer.totalM / next.strideM)

    if (events.some((e) => e.type === 'finished')) {
      say('voice.finish', { steps })
      return out
    }
    const collected = events.filter((e): e is Extract<QuestEvent, { type: 'collected' }> => e.type === 'collected' && !e.isFinish)
    if (collected.length) {
      const upcoming = cps[next.collected]
      const last = collected[collected.length - 1]!
      if (upcoming) {
        const m = spokenMetres(upcoming.distanceM - next.alongM)
        const key = upcoming.isFinish ? 'voice.gemLast' : 'voice.gem'
        say(key, { n: last.index, total: gemTotal(next.route), m, dir: dirFrom(next, upcoming.point) })
      }
    }
    if (events.some((e) => e.type === 'offRoute') && next.player) {
      const snap = snapToRoute(this.track, next.player, next.alongM)
      say('voice.offRoute', { dir: directionTo(next.player, snap.point).point, m: spokenMetres(snap.offsetM) })
    } else if (events.some((e) => e.type === 'backOnRoute')) say('voice.backOnRoute', {})

    if (next.offRoute) return out

    // Turns coming up.
    this.turns.forEach((turn, i) => {
      if (this.spokenTurns.has(i)) return
      const before = turn.alongM - prev.alongM
      const now = turn.alongM - next.alongM
      if (now <= 3) {
        this.spokenTurns.add(i)
        return
      }
      if (now <= TURN_WARN_M && before > now) {
        this.spokenTurns.add(i)
        // Only the nearest turn; the next one gets its own call.
        if (!out.some((c) => c.key === 'voice.turnLeft' || c.key === 'voice.turnRight'))
          say(turn.side === 'left' ? 'voice.turnLeft' : 'voice.turnRight', { m: spokenMetres(now) })
      }
    })

    // Distance marks to the next checkpoint (not right after a pickup).
    const target = cps[next.collected]
    if (target && !collected.length && prev.collected === next.collected) {
      const before = target.distanceM - prev.alongM
      const now = target.distanceM - next.alongM
      const crossed = DISTANCE_MARKS.filter((mark) => now <= mark && before > mark)
      const mark = crossed[crossed.length - 1]
      const id = `${next.collected}:${mark}`
      if (mark !== undefined && !this.spokenMarks.has(id)) {
        this.spokenMarks.add(id)
        say(target.isFinish ? 'voice.distanceFlag' : 'voice.distance', { m: mark })
      }
    }

    // Halfway along the route (only for walks long enough to care).
    const half = next.route.distanceM / 2
    if (!this.halfwaySaid && next.route.distanceM >= 600 && prev.alongM < half && next.alongM >= half) {
      this.halfwaySaid = true
      say('voice.halfway', { steps })
    }
    return out.sort((a, b) => b.priority - a.priority)
  }
}

/**
 * Callouts whose words are known before they are due (distance marks, the turn
 * warning, back on route), so the engine can render them while it is idle.
 */
export function predictableCallouts(): Callout[] {
  const out: Callout[] = []
  for (const m of DISTANCE_MARKS) {
    for (const key of ['voice.distance', 'voice.distanceFlag'] as const) out.push({ key, vars: { m }, priority: PRIORITY[key] })
  }
  for (const key of ['voice.turnLeft', 'voice.turnRight'] as const) out.push({ key, vars: { m: TURN_WARN_M }, priority: PRIORITY[key] })
  out.push({ key: 'voice.backOnRoute', vars: {}, priority: PRIORITY['voice.backOnRoute'] })
  return out
}

/** Sound effects for quest events. */
export function sfxFor(events: readonly QuestEvent[], next: QuestState): SfxName[] {
  const out: SfxName[] = []
  if (events.some((e) => e.type === 'finished')) return ['finish']
  for (const e of events) {
    if (e.type === 'collected' && !e.isFinish) out.push(next.route.checkpoints[next.collected]?.isFinish ? 'gemLast' : 'gem')
    if (e.type === 'offRoute') out.push('offRoute')
  }
  return out
}

/** The words for a callout in the current language (directions translated too). */
export function calloutText(c: Callout, t: Translate): string {
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(c.vars)) {
    if (v === undefined) continue
    vars[k] = k === 'dir' ? t(`dir.${v as CompassPoint}`) : v
  }
  // Each voice key takes a different subset of `vars`; callouts.test.ts checks that none is left unfilled.
  return (t as (key: VoiceKey, vars: Record<string, string | number>) => string)(c.key, vars)
}
