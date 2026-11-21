import { describe, expect, it } from 'vitest'
import { haversine, type LatLon } from '../geo/geo.ts'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { interpolate } from '../i18n/locale.ts'
import { createQuest, type QuestEvent, type QuestState } from '../quest/quest.ts'
import type { QuestRoute } from '../quest/types.ts'
import { cumulativeDistances, pointAlong } from '../routing/checkpoints.ts'
import { CalloutPlanner, calloutText, findTurns, headingChange, sfxFor, spokenMetres, type Callout } from './callouts.ts'

const O = { lat: 39.49, lon: -0.39 }
const M_LAT = 1 / 111_320
const M_LON = 1 / (111_320 * Math.cos((O.lat * Math.PI) / 180))
const at = (east: number, north: number): LatLon => ({ lat: O.lat + north * M_LAT, lon: O.lon + east * M_LON })

/** 400 m east, then 400 m north (a left turn at 400 m), with gems at 300, 600 and the flag at 800. */
function lRoute(): QuestRoute {
  const points: LatLon[] = []
  for (let e = 0; e <= 400; e += 20) points.push(at(e, 0))
  for (let n = 20; n <= 400; n += 20) points.push(at(400, n))
  const cum = cumulativeDistances(points)
  const total = cum[cum.length - 1]!
  const cp = (d: number, index: number, isFinish = false) => ({ index, point: pointAlong(points, cum, d), distanceM: d, isFinish })
  return { mode: 'oneway', points, distanceM: total, steps: Math.round(total / 0.75), targetSteps: 1000, checkpoints: [cp(300, 1), cp(600, 2), cp(total, 3, true)] }
}

function stateAt(base: QuestState, alongM: number, patch: Partial<QuestState> = {}): QuestState {
  const route = base.route
  const cum = cumulativeDistances(route.points)
  return { ...base, alongM, player: pointAlong(route.points, cum, alongM), odometer: { anchor: undefined, totalM: alongM }, ...patch }
}

const t = (key: keyof typeof en, vars?: Record<string, string | number>) => interpolate(en[key], vars ?? {}, 'en')
const tEs = (key: keyof typeof es, vars?: Record<string, string | number>) => interpolate(es[key], vars ?? {}, 'es')

describe('spoken distances', () => {
  it('rounds like a person would', () => {
    expect(spokenMetres(3)).toBe(10)
    expect(spokenMetres(34)).toBe(30)
    expect(spokenMetres(96)).toBe(100)
    expect(spokenMetres(237)).toBe(250)
    expect(spokenMetres(1234)).toBe(1200)
  })

  it('measures heading changes with left negative', () => {
    expect(headingChange(90, 0)).toBe(-90)
    expect(headingChange(350, 20)).toBe(30)
    expect(headingChange(10, 200)).toBe(-170)
  })
})

describe('turn detection', () => {
  it('finds the corner of an L-shaped route and its side', () => {
    const q = createQuest(lRoute(), { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0 })
    const turns = new CalloutPlanner(q).turns
    expect(turns).toHaveLength(1)
    expect(turns[0]!.side).toBe('left')
    expect(turns[0]!.alongM).toBeCloseTo(400, -1)
  })

  it('ignores gentle bends and merges a corner drawn with several points', () => {
    const points = [at(0, 0), at(100, 0), at(200, 10), at(300, 20), at(310, 30), at(310, 40), at(310, 140)]
    const cum = cumulativeDistances(points)
    const track = { points, cumulative: cum, total: cum[cum.length - 1]!, projection: undefined as never, xy: [] }
    const turns = findTurns(track)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.side).toBe('left')
  })
})

describe('callout planner', () => {
  const base = () => createQuest(lRoute(), { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 0 })

  it('announces the start with the distance and direction to the first gem', () => {
    const q = base()
    const c = new CalloutPlanner(q).start(q)
    expect(c.key).toBe('voice.start')
    expect(c.vars).toMatchObject({ m: 300, dir: 'E' })
    expect(calloutText(c, t)).toBe('Quest started! First gem in 300 meters, east.')
    expect(calloutText(c, tEs)).toBe('¡Misión iniciada! Primera gema a 300 metros, al este.')
  })

  it('speaks distance marks once, even when GPS jitters back and forth', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const said: Callout[] = []
    const walk = [50, 99, 101, 102, 99, 103, 150, 201, 205, 251]
    let prev = q
    for (const a of walk) {
      const next = stateAt(q, a)
      said.push(...p.update(prev, next, []))
      prev = next
    }
    // 300 m gem: crossing 200 m left (at 100 m along) and 100 m left (at 200 m along).
    expect(said.map((c) => [c.key, c.vars.m])).toEqual([
      ['voice.distance', 200],
      ['voice.distance', 100],
      ['voice.distance', 50],
    ])
  })

  it('warns about a turn 30 m ahead, once', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const a = stateAt(q, 320, { collected: 1 })
    const b = stateAt(q, 372, { collected: 1 })
    const c = stateAt(q, 380, { collected: 1 })
    expect(p.update(a, b, []).map((x) => x.key)).toEqual(['voice.turnLeft'])
    expect(p.update(b, c, [])).toEqual([])
    const turn = new CalloutPlanner(q).update(a, b, [])[0]!
    expect(calloutText(turn, t)).toBe('In 30 meters, turn left.')
    expect(calloutText(turn, tEs)).toBe('En 30 metros, gira a la izquierda.')
  })

  it('names the gem, the total and what comes next on a pickup', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const prev = stateAt(q, 295)
    const next = stateAt(q, 301, { collected: 1 })
    const events: QuestEvent[] = [{ type: 'collected', index: 1, isFinish: false, point: q.route.checkpoints[0]!.point }]
    const out = p.update(prev, next, events)
    expect(out[0]).toMatchObject({ key: 'voice.gem', vars: { n: 1, total: 3, m: 300 } })
    expect(calloutText(out[0]!, t)).toMatch(/^Gem 1 of 3! Next gem in 300 meters, (east|north-east)\.$/)
    // No distance mark right after a pickup.
    expect(out.some((c) => c.key === 'voice.distance')).toBe(false)
    expect(sfxFor(events, next)).toEqual(['gem'])
  })

  it('points to the flag after the last gem', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const events: QuestEvent[] = [{ type: 'collected', index: 2, isFinish: false, point: q.route.checkpoints[1]!.point }]
    const next = stateAt(q, 601, { collected: 2 })
    const out = p.update(stateAt(q, 598, { collected: 1 }), next, events)
    expect(out[0]!.key).toBe('voice.gemLast')
    expect(sfxFor(events, next)).toEqual(['gemLast'])
  })

  it('says halfway once, and only the finish at the end', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const half = q.route.distanceM / 2
    expect(p.update(stateAt(q, half - 5, { collected: 1 }), stateAt(q, half + 5, { collected: 1 }), []).map((c) => c.key)).toContain('voice.halfway')
    expect(p.update(stateAt(q, half - 5, { collected: 1 }), stateAt(q, half + 5, { collected: 1 }), []).map((c) => c.key)).not.toContain('voice.halfway')
    const fin = p.update(stateAt(q, 790, { collected: 2 }), stateAt(q, 800, { collected: 3, finishedAt: 1 }), [
      { type: 'collected', index: 3, isFinish: true, point: q.route.checkpoints[2]!.point },
      { type: 'finished' },
    ])
    expect(fin.map((c) => c.key)).toEqual(['voice.finish'])
    expect(calloutText(fin[0]!, t)).toBe('Quest complete! 1067 steps. Well done!')
    expect(sfxFor([{ type: 'finished' }], q)).toEqual(['finish'])
  })

  it('guides back when off the route, and stays quiet about turns meanwhile', () => {
    const q = base()
    const p = new CalloutPlanner(q)
    const prev = stateAt(q, 360)
    const off = { ...stateAt(q, 371), offRoute: true, player: at(380, -60) }
    const out = p.update(prev, off, [{ type: 'offRoute' }])
    expect(out.map((c) => c.key)).toEqual(['voice.offRoute'])
    expect(out[0]!.vars.dir).toBe('N')
    expect(out[0]!.vars.m).toBe(60)
    expect(sfxFor([{ type: 'offRoute' }], off)).toEqual(['offRoute'])
    expect(p.update(off, stateAt(q, 372), [{ type: 'backOnRoute' }]).map((c) => c.key)).toContain('voice.backOnRoute')
  })

  it('does not repeat what is already behind after a resume', () => {
    const q = stateAt(base(), 500, { collected: 1 })
    const p = new CalloutPlanner(q)
    expect(p.update(q, stateAt(q, 505, { collected: 1 }), [])).toEqual([])
  })

  it('uses singular and plural in both languages', () => {
    const one: Callout = { key: 'voice.distance', vars: { m: 1 }, priority: 1 }
    expect(calloutText(one, t)).toBe('1 meter to the next gem.')
    expect(calloutText(one, tEs)).toBe('Falta 1 metro para la siguiente gema.')
    const many: Callout = { key: 'voice.distance', vars: { m: 50 }, priority: 1 }
    expect(calloutText(many, tEs)).toBe('Faltan 50 metros para la siguiente gema.')
    expect(calloutText({ key: 'voice.finish', vars: { steps: 1 }, priority: 5 }, tEs)).toBe('¡Misión completada! 1 paso. ¡Muy bien!')
  })

  it('keeps the test route geometry honest', () => {
    const r = lRoute()
    expect(haversine(r.points[0]!, r.points[r.points.length - 1]!)).toBeCloseTo(Math.hypot(400, 400), -1)
  })
})
