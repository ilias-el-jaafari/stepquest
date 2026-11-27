import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CalloutPlanner } from '../audio/callouts.ts'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { interpolate } from '../i18n/locale.ts'
import { startLines } from '../ui/questCopy.ts'
import { gemTotal } from './gems.ts'
import { createQuest, type QuestEvent } from './quest.ts'
import { questStats } from './stats.ts'
import { summarize } from './summary.ts'
import type { QuestRoute } from './types.ts'

function route(n: number): QuestRoute {
  const points = Array.from({ length: n * 2 + 2 }, (_, i) => ({ lat: 39.47 + i * 0.0005, lon: -0.377 }))
  const checkpoints = Array.from({ length: n }, (_, k) => ({ index: k + 1, point: points[(k + 1) * 2]!, distanceM: (k + 1) * 100, isFinish: k === n - 1 }))
  return { mode: 'oneway', points, distanceM: n * 100, steps: n * 133, targetSteps: n * 133, checkpoints }
}
const tEn = (key: string, vars?: Record<string, string | number>) => interpolate((en as Record<string, string>)[key]!, vars ?? {}, 'en')
const tEs = (key: string, vars?: Record<string, string | number>) => interpolate((es as Record<string, string>)[key]!, vars ?? {}, 'es')

describe('one gem count (the flag is the last gem)', () => {
  it('is the number of checkpoints', () => {
    expect(gemTotal(route(5))).toBe(5)
  })

  it('has the start line, HUD, voice and summary say the same number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 14 }), (n) => {
        const r = route(n)
        const state = createQuest(r, { strideM: 0.75, area: { kind: 'demo' }, simulated: true, now: 1000 })
        const total = gemTotal(r)
        // HUD counter and summary read the quest stats.
        expect(questStats(state, 2000).total).toBe(total)
        expect(summarize(questStats(state, 2000), 'paused').total).toBe(total)
        // The start bubble names the same number in both languages.
        for (const [t, locale] of [[tEn, 'en'], [tEs, 'es']] as const) {
          const first = startLines(r, t as never)[0]!
          expect(first.match(/\d+/g), `${locale}: ${first}`).toEqual([String(total)])
        }
        // Wisp and the voice: "gem k of total" uses the same total.
        const events: QuestEvent[] = [{ type: 'collected', index: 1, isFinish: false, point: r.checkpoints[0]!.point }]
        const planner = new CalloutPlanner(state)
        const next = { ...state, collected: 1 }
        const say = planner.update(state, next, events)
        for (const c of say) if (c.vars && 'total' in c.vars) expect(c.vars.total).toBe(total)
      }),
    )
  })

  it('goes straight to the flag when the flag is the only gem', () => {
    expect(startLines(route(1), tEn as never)).toEqual([tEn('dlg.startFlag')])
  })
})
