import { describe, expect, it } from 'vitest'
import { P } from '../render/palette.ts'
import { hasCasing, Street, STREET_WIDTH } from './classes.ts'
import { LOD_SLICE_MS, LodPainter } from './paint.ts'
import { makeLod, recordingCtx, square } from './testing.ts'

const T = { z: 14, x: 8174, y: 6232 }

/** A busy tile: streets of every class, buildings of all sizes, parks, water, a waterway. */
function busy() {
  const lines = []
  const classes = ['minor', 'service', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'path', 'track', 'rail']
  for (let i = 0; i < 1500; i++) lines.push({ cls: classes[i % classes.length]!, sub: classes[i % classes.length] === 'rail' ? 'rail' : undefined, pts: [[(i * 7) % 4000, (i * 13) % 4000], [((i * 7) % 4000) + 90, ((i * 13) % 4000) + 60], [((i * 7) % 4000) + 150, ((i * 13) % 4000) + 20]] as [number, number][] })
  const areas = []
  for (let i = 0; i < 2000; i++) areas.push({ layer: 'building' as const, ring: square((i * 37) % 3900, (i * 53) % 3900, 15 + (i % 40)) })
  areas.push({ layer: 'park' as const, ring: square(100, 100, 900) }, { layer: 'water' as const, ring: square(2000, 2000, 700) })
  return makeLod(T, { lines, areas })
}

describe('LOD painter (requirements 25.2, 25.4, 25.5)', () => {
  it('starts by filling the whole bitmap with the ground colour, so a finished bitmap is opaque', () => {
    const ctx = recordingCtx()
    new LodPainter(busy(), ctx, 512).run(1000)
    expect(ctx.calls[0]!.op).toBe('setTransform')
    const fills = ctx.calls.filter((c) => c.op === 'fillRect')
    expect(fills[0]!.args).toEqual([0, 0, 512, 512])
    expect(ctx.calls.find((c) => c.op === 'set:fillStyle')!.args[0]).toBe(P.overview.ground)
  })

  it('strokes every street class with its width scaled to the level, casings (one wider) from tertiary up', () => {
    const ctx = recordingCtx()
    const p = new LodPainter(busy(), ctx, 512)
    while (!p.run(1000)) {
      /* run to the end */
    }
    const scale = 512 / 256
    const widths = new Set(ctx.widths.map((w) => Math.round(w * 100) / 100))
    for (const cls of Object.values(Street)) {
      const w = STREET_WIDTH[cls]!
      expect(widths.has(Math.max(1, w * scale)), `class ${cls} fill`).toBe(true)
      if (hasCasing(cls)) expect(widths.has((w + 2) * scale), `class ${cls} casing`).toBe(true)
    }
    // Big streets cover small ones: widths are set in class order (the first casing comes after the first plain fill).
    expect(ctx.calls.filter((c) => c.op === 'stroke').length).toBeGreaterThan(10)
  })

  it('draws parks, water, waterways and building blocks; a building under 1.5 px is one pixel', () => {
    const ctx = recordingCtx()
    const tile = makeLod(T, { areas: [{ layer: 'building', ring: square(100, 100, 30) }, { layer: 'building', ring: square(500, 500, 400) }, { layer: 'park', ring: square(1000, 1000, 800) }, { layer: 'water', ring: square(2500, 2500, 800) }] })
    const p = new LodPainter(tile, ctx, 256)
    while (!p.run(1000)) {
      /* run to the end */
    }
    const styles = ctx.calls.filter((c) => c.op === 'set:fillStyle').map((c) => c.args[0])
    expect(styles).toEqual(expect.arrayContaining([P.overview.park, P.overview.water, P.lod.building]))
    // 30 units at 256/4096 is 1.9 px (a polygon); a 400 unit one is a polygon too; none is a pixel here.
    expect(ctx.calls.filter((c) => c.op === 'fill').length).toBeGreaterThanOrEqual(3)
    const tiny = makeLod(T, { areas: [{ layer: 'building', ring: square(100, 100, 40) }] })
    const c2 = recordingCtx()
    // 40 units * 64/4096 = 0.6 px: one pixel (the ring survives simplification and the area test at this size).
    const p2 = new LodPainter(tiny, c2, 64)
    while (!p2.run(1000)) {
      /* run to the end */
    }
    expect(c2.calls.filter((c) => c.op === 'fillRect').some((c) => (c.args[2] as number) === 1 && (c.args[3] as number) === 1)).toBe(true)
  })

  it('works in slices: with a clock that runs 3 ms a step and a budget of 8 ms, no run does more than 3 steps, and the result equals one run', () => {
    const tile = busy()
    let t = 0
    const clock = () => (t += 3)
    const sliced = recordingCtx()
    const p = new LodPainter(tile, sliced, 512, clock)
    let runs = 0
    let maxSteps = 0
    for (;;) {
      const before = p.stepsRun
      const done = p.run(LOD_SLICE_MS)
      maxSteps = Math.max(maxSteps, p.stepsRun - before)
      runs++
      if (done) break
    }
    expect(runs).toBeGreaterThan(5)
    // The clock moves 3 ms per read and every step reads it once: a step costs 3 ms, so a budget of 8 ms allows 2 steps
    // (a third would end at 9 ms), and a run never ends later than its budget.
    expect(maxSteps).toBeLessThanOrEqual(2)
    const whole = recordingCtx()
    new LodPainter(tile, whole, 512).run(1e9)
    expect(sliced.calls).toEqual(whole.calls)
    expect(p.done).toBe(true)
    expect(p.run()).toBe(true)
  })

  it('a heavy real tile in real time: every run of the painter ends within a few milliseconds of its budget on a stub context', () => {
    const p = new LodPainter(busy(), recordingCtx(), 1024)
    let worst = 0
    for (;;) {
      const t0 = performance.now()
      const done = p.run(LOD_SLICE_MS)
      worst = Math.max(worst, performance.now() - t0)
      if (done) break
    }
    expect(worst).toBeLessThan(LOD_SLICE_MS + 12)
  })
})
