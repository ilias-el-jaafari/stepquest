import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cellBBox, cellOf } from './cells.ts'
import { sliceToCells, isComplete } from './slice.ts'
import { compact, isRunOf, joinRuns, WorldData } from './worldData.ts'
import { liveShapes, makeData, makeRecord, type SketchWay } from './testing.ts'

// Cells (3949,-40) west and (3949,-39) east; the border is lon -0.39.
const A = { i: 3949, j: -40 }
const B = { i: 3949, j: -39 }
const LAT = 39.495
const pt = (lon: number): [number, number] => [LAT, lon]

const shapes = (wd: WorldData) => liveShapes(wd, (k) => !wd.retired.has(k))

describe('run helpers', () => {
  it('finds a run in either direction and joins end to end', () => {
    expect(isRunOf([2, 3], [1, 2, 3, 4])).toBe(true)
    expect(isRunOf([3, 2], [1, 2, 3, 4])).toBe(true)
    expect(isRunOf([2, 4], [1, 2, 3, 4])).toBe(false)
    expect(joinRuns([1, 2], [2, 3])).toEqual([1, 2, 3])
    expect(joinRuns([1, 2], [3, 2])).toEqual([1, 2, 3])
    expect(joinRuns([2, 1], [2, 3])).toEqual([3, 2, 1])
    expect(joinRuns([1, 2], [3, 4])).toBeUndefined()
  })
})

describe('stitching cells into one world', () => {
  it('turns a way cut at the border into one continuous way, with no duplicate nodes', () => {
    const left = makeRecord(A, [{ id: 7, pts: [pt(-0.398), pt(-0.394), pt(-0.39)] }])
    const right = makeRecord(B, [{ id: 7, pts: [pt(-0.39), pt(-0.386), pt(-0.382)] }])
    const wd = new WorldData()
    wd.addRecord(left)
    wd.addRecord(right)
    expect(wd.liveWays()).toHaveLength(1)
    expect(wd.liveWays()[0]!.nodes).toHaveLength(5)
    expect(wd.lat).toHaveLength(5)
    expect(new Set(wd.liveWays()[0]!.nodes).size).toBe(5)
    expect(wd.retired.size).toBe(1)
    expect(wd.ways).toHaveLength(2)
  })

  it('keeps one copy of a whole way that both cells return', () => {
    const full: SketchWay = { id: 9, pts: [pt(-0.395), pt(-0.39), pt(-0.385)] }
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [full]))
    wd.addRecord(makeRecord(B, [full]))
    expect(wd.liveWays()).toHaveLength(1)
    expect(wd.ways).toHaveLength(1)
    expect(wd.lat).toHaveLength(3)
  })

  it('replaces a clipped copy (a bundled extract) by the whole way from a cell', () => {
    const clipped = makeRecord(A, [{ id: 5, pts: [pt(-0.398), pt(-0.394)] }])
    const whole = makeRecord(B, [{ id: 5, pts: [pt(-0.398), pt(-0.394), pt(-0.39), pt(-0.386)] }])
    const wd = new WorldData()
    wd.addRecord(clipped)
    wd.addRecord(whole)
    expect(wd.liveWays()).toHaveLength(1)
    expect(wd.liveWays()[0]!.nodes).toHaveLength(4)
    expect(wd.retired.size).toBe(1)
  })

  it('drops a clipped copy that arrives after the whole way', () => {
    const wd = new WorldData()
    wd.addRecord(makeRecord(B, [{ id: 5, pts: [pt(-0.398), pt(-0.394), pt(-0.39), pt(-0.386)] }]))
    wd.addRecord(makeRecord(A, [{ id: 5, pts: [pt(-0.394), pt(-0.398)] }]))
    expect(wd.ways).toHaveLength(1)
  })

  it('joins nodes that two different ways share across cells', () => {
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [{ id: 1, pts: [pt(-0.395), pt(-0.39)] }]))
    wd.addRecord(makeRecord(B, [{ id: 2, pts: [pt(-0.39), pt(-0.385)] }]))
    const [a, b] = wd.liveWays()
    expect(a!.nodes[1]).toBe(b!.nodes[0])
    expect(wd.lat).toHaveLength(3)
  })

  it('does not merge two different ways, or ways of different kinds with the same id', () => {
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [{ id: 1, pts: [pt(-0.395), pt(-0.39)] }, { id: 1, kind: 'waterway', pts: [pt(-0.395), pt(-0.39)] }]))
    expect(wd.liveWays()).toHaveLength(2)
  })

  it('does not join a closed ring or stitch areas', () => {
    const ring: [number, number][] = [pt(-0.395), [LAT + 0.001, -0.395], [LAT + 0.001, -0.394], pt(-0.395)]
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [{ id: 3, kind: 'building', area: true, pts: ring }]))
    wd.addRecord(makeRecord(B, [{ id: 3, kind: 'building', area: true, pts: ring }]))
    expect(wd.liveWays()).toHaveLength(1)
  })

  it('does not repeat points of interest or lively places seen by two records', () => {
    const poi = { kind: 'school' as const, lat: LAT, lon: -0.39 }
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [], { pois: [poi], activity: [LAT, -0.39] }))
    wd.addRecord(makeRecord(B, [], { pois: [poi], activity: [LAT, -0.39, LAT, -0.385] }))
    expect(wd.pois).toHaveLength(1)
    expect(wd.activity).toEqual([LAT, -0.39, LAT, -0.385])
  })

  it('reports the loaded cells as coverage and the box around them', () => {
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, []))
    wd.addRecord(makeRecord(B, []))
    const snap = wd.snapshot()
    expect(snap.coverage).toHaveLength(2)
    expect(snap.bbox).toEqual({ south: 39.49, west: -0.4, north: 39.5, east: -0.38 })
    expect(snap.lat).toBeInstanceOf(Float64Array)
  })

  it('keeps the larger coverage of a cell seen partly first', () => {
    const part = { ...cellBBox(A), west: -0.395 }
    const wd = new WorldData()
    wd.addRecord(makeRecord(A, [], {}, part))
    wd.addRecord(makeRecord(A, []))
    expect(wd.snapshot().coverage).toEqual([cellBBox(A)])
  })

  it('P-W1 a street cut into pieces by cells is one way whatever the order the cells arrive in', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), fc.integer({ min: 0, max: 1000 }), (pieces, seed) => {
        // One street with 3 * pieces + 1 points, cut into `pieces` runs that share their end points.
        const pts: [number, number][] = Array.from({ length: 3 * pieces + 1 }, (_, k) => [LAT + 0.0005 * Math.sin(k), -0.409 + 0.0021 * k])
        const records = Array.from({ length: pieces }, (_, p) => makeRecord({ i: 3949, j: -41 + p }, [{ id: 42, pts: pts.slice(3 * p, 3 * p + 4) }]))
        const order = [...records].sort(((a: number) => () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) % 3) - 1)(seed + 1))
        const wd = new WorldData()
        order.forEach((r) => wd.addRecord(r))
        expect(wd.liveWays()).toHaveLength(1)
        expect(new Set(wd.liveWays()[0]!.nodes).size).toBe(pts.length)
        expect(wd.lat).toHaveLength(pts.length)
        expect(shapes(wd)).toEqual(shapes(compact(records)))
      }),
    )
  })

  it('P-W2 the live ways do not depend on the order of arrival', () => {
    const records = [
      makeRecord(A, [{ id: 1, pts: [pt(-0.399), pt(-0.39)] }, { id: 2, pts: [pt(-0.395), pt(-0.392)] }]),
      makeRecord(B, [{ id: 1, pts: [pt(-0.39), pt(-0.381)] }, { id: 3, pts: [pt(-0.385), pt(-0.382)] }]),
      makeRecord({ i: 3950, j: -40 }, [{ id: 2, pts: [pt(-0.395), pt(-0.392), pt(-0.391)] }]),
    ]
    const expected = shapes(compact(records))
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]]) {
      const wd = new WorldData()
      order.forEach((k) => wd.addRecord(records[k]!))
      expect(shapes(wd)).toEqual(expected)
    }
  })
})

describe('slicing an extract into cells', () => {
  const data = makeData(
    [
      { id: 1, pts: [pt(-0.398), pt(-0.39), pt(-0.382)] },
      { id: 2, pts: [pt(-0.396), pt(-0.394)] },
    ],
    { south: 39.49, west: -0.4, north: 39.5, east: -0.38 },
    { pois: [{ kind: 'school', lat: LAT, lon: -0.385 }], activity: [LAT, -0.397, LAT, -0.385] },
  )

  it('gives a crossing street whole to both cells and a local one to one', () => {
    const recs = sliceToCells(data)
    expect(recs.map((r) => r.cell)).toEqual([A, B])
    expect(recs[0]!.data.ways.map((w) => w.id)).toEqual([1, 2])
    expect(recs[1]!.data.ways.map((w) => w.id)).toEqual([1])
    expect(recs[0]!.data.ways[0]!.nodes).toHaveLength(3)
    expect(recs[0]!.data.pois).toHaveLength(0)
    expect(recs[1]!.data.pois).toHaveLength(1)
    expect(recs[0]!.data.activity).toEqual([LAT, -0.397])
    expect(recs.every(isComplete)).toBe(true)
  })

  it('merging the slices gives back the extract', () => {
    const wd = compact(sliceToCells(data))
    expect(shapes(wd)).toEqual(liveShapes(data))
    expect(wd.pois).toHaveLength(1)
  })

  it('marks the cells at the edge of a smaller extract as partial', () => {
    const small = makeData([{ id: 1, pts: [pt(-0.398), pt(-0.392)] }], { south: 39.491, west: -0.399, north: 39.499, east: -0.391 })
    const [rec] = sliceToCells(small)
    expect(rec!.coverage).toEqual(small.bbox)
    expect(isComplete(rec!)).toBe(false)
    expect(cellOf({ lat: 39.495, lon: -0.395 })).toEqual(A)
  })
})
