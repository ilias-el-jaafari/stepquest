import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { checkpointLine, finishLine, NIGHT_LINES, shouldScare } from './director.ts'

describe('ghost director', () => {
  it('property: every checkpoint comment exists in English and Spanish and consecutive gems differ', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e6 }), fc.integer({ min: 3, max: 30 }), (seed, total) => {
        let prev = ''
        for (let i = 1; i <= total; i++) {
          const line = checkpointLine(i, total, seed)
          expect(en[line.key]).toBeTruthy()
          expect(es[line.key]).toBeTruthy()
          if (i < total - 1 && prev) expect(line.key).not.toBe(prev)
          prev = line.key
        }
      }),
    )
  })

  it('uses the last-gem and finish lines at the end', () => {
    expect(checkpointLine(4, 5, 1).key).toBe('ghost.cpLast')
    expect(checkpointLine(5, 5, 1)).toEqual(finishLine())
    expect(finishLine().pose).toBe('happy')
  })

  it('scares once, only from dusk on', () => {
    expect(shouldScare('day', false)).toBe(false)
    expect(shouldScare('golden', false)).toBe(false)
    expect(shouldScare('dusk', false)).toBe(true)
    expect(shouldScare('night', false)).toBe(true)
    expect(shouldScare('night', true)).toBe(false)
  })

  it('says boo, then points to the lit way', () => {
    expect(NIGHT_LINES.map((l) => l.key)).toEqual(['ghost.boo', 'ghost.lit'])
    expect(NIGHT_LINES[0]!.pose).toBe('boo')
    expect(es['ghost.boo']).toBe('¡Bu!')
    expect(es['ghost.lit']).toContain('farolas')
  })
})
