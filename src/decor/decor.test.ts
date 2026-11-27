import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { Terrain, TileGrid } from '../tiles/grid.ts'
import { buildTileGrid } from '../tiles/rasterize.ts'
import { ATLAS_WIDTH, atlasLayout, DECOR_FRAMES, graveRows, pumpkinRows, spriteSize, SPRITE_IDS, webCorner } from './art.ts'
import { batFrame, batX, batY, flickerLevel, fogX, skeletonFrame, tickOf } from './anim.ts'
import { ANIM_FRAME_MS, decorBudget, MAX_ANIMATED, MAX_STATIC_PER_SCREEN, MIN_DECOR_ZOOM } from './budget.ts'
import { clearOfStreets, decorInChunk, forgetDecor, HALF_WIDTH, LAT_STEP, LON_STEP, LOW_KINDS, PLAZA_BLOCK, PLAZA_CAP, PLAZA_GAP_M, tileClear, type DecorItem, type YardTest } from './place.ts'

const grid = buildTileGrid(loadDemoOsm())
const CHUNK = 32
const chunksX = Math.ceil(grid.cols / CHUNK)
const chunksY = Math.ceil(grid.rows / CHUNK)
const all = (g = grid): DecorItem[] => {
  const out: DecorItem[] = []
  for (let cy = 0; cy < chunksY; cy++) for (let cx = 0; cx < chunksX; cx++) out.push(...decorInChunk(g, cx, cy, CHUNK).statics, ...decorInChunk(g, cx, cy, CHUNK).animated)
  return out
}
const key = (i: DecorItem) => `${i.kind}:${i.x.toFixed(4)}:${i.y.toFixed(4)}:${i.variant}:${i.n}:${i.rank.toFixed(6)}`

describe('atlas', () => {
  it('has a fixed size (golden: change it on purpose, with the art)', () => {
    const l = atlasLayout()
    expect({ width: l.width, height: l.height, frames: l.frames }).toEqual({ width: 128, height: 52, frames: 29 })
  })
  it('fits every frame inside the page without overlap', () => {
    const l = atlasLayout()
    const slots = Object.values(l.slots)
    for (const s of slots) {
      expect(s.x + s.w).toBeLessThanOrEqual(ATLAS_WIDTH)
      expect(s.y + s.h).toBeLessThanOrEqual(l.height)
    }
    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const p = slots[a]!
        const q = slots[b]!
        expect(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y).toBe(true)
      }
    }
  })
  it('draws every sprite from its own colours on a rectangular grid', () => {
    for (const id of SPRITE_IDS) {
      const [first] = DECOR_FRAMES[id]
      for (const f of DECOR_FRAMES[id]) {
        expect(f.rows.length).toBe(first!.rows.length)
        for (const r of f.rows) {
          expect(r.length).toBe(first!.rows[0]!.length)
          for (const ch of r) expect(ch === '.' || ch in f.colors).toBe(true)
        }
      }
    }
  })
  it('mirrors the web into four different corners', () => {
    expect(new Set([0, 1, 2, 3].map((c) => webCorner(c).join('/'))).size).toBe(4)
  })
})

describe('sizes at quest zoom', () => {
  // A garden tree is about 14 art pixels wide; the main pieces must read at that size (1.5 to 2 times the first set: 8 × 7).
  it('draws the pumpkins and jack-o\'-lanterns about as big as a tree', () => {
    for (const id of ['pumpkin', 'jack', 'jackLit'] as const) {
      const { w, h } = spriteSize(id)
      expect(w).toBeGreaterThanOrEqual(12)
      expect(h).toBeGreaterThanOrEqual(11)
    }
  })
  it('makes gravestones, skeletons, bats and fog larger than before', () => {
    expect(spriteSize('grave').h).toBeGreaterThanOrEqual(12)
    expect(spriteSize('skeleton').h).toBeGreaterThanOrEqual(15)
    expect(spriteSize('bat').w).toBeGreaterThanOrEqual(13)
    expect(spriteSize('fog').w).toBeGreaterThanOrEqual(20)
  })
  it('has the new pieces: scarecrow, cauldron (lit at night), haunted signpost, picket fence with a pumpkin, hanging spider', () => {
    for (const id of ['scarecrow', 'cauldron', 'cauldronLit', 'sign', 'fence', 'spider'] as const) expect(SPRITE_IDS).toContain(id)
    expect(spriteSize('scarecrow').h).toBeGreaterThanOrEqual(18)
    expect(spriteSize('fence').w).toBe(16)
  })
  it('draws the generated shapes on a rectangular grid of one character per pixel', () => {
    for (const rows of [pumpkinRows(13, 12), pumpkinRows(8, 7), graveRows(0), graveRows(1), graveRows(2)]) {
      for (const r of rows) expect(r.length).toBe(rows[0]!.length)
    }
    expect(DECOR_FRAMES.bat).toHaveLength(2)
    expect(DECOR_FRAMES.bat[0]!.rows).not.toEqual(DECOR_FRAMES.bat[1]!.rows)
  })
  it('lights the jack-o\'-lantern face at night and not by day', () => {
    expect(DECOR_FRAMES.jack[0]!.colors.f).not.toBe(DECOR_FRAMES.jackLit[0]!.colors.f)
  })
  it('shows 10 to 20 items on the visible map of a quest-zoom screen: caps give the room, and day shows most of them', () => {
    const night = decorBudget(24, 0.8)
    const day = decorBudget(24, 0)
    // A phone screen is about 0.55 chunk at zoom 24, and about 40 % of it is under the HUD cards.
    expect(night.staticPerChunk * 0.55 * 0.6).toBeGreaterThanOrEqual(20)
    expect(day.density).toBeGreaterThanOrEqual(0.8)
    expect(night.animPerChunk).toBeGreaterThanOrEqual(4)
  })
})

describe('forgetting', () => {
  it('drops only the chunks a changed rectangle reaches (with the reach of a site), all without one', () => {
    const g = buildTileGrid(loadDemoOsm())
    const far = decorInChunk(g, 0, 0, CHUNK)
    const hit = decorInChunk(g, 8, 8, CHUNK)
    const edge = decorInChunk(g, 7, 8, CHUNK)
    forgetDecor(g, { x: 8 * CHUNK + 1, y: 8 * CHUNK + 1, w: 4, h: 4 })
    expect(decorInChunk(g, 0, 0, CHUNK)).toBe(far)
    expect(decorInChunk(g, 8, 8, CHUNK)).not.toBe(hit)
    // Chunk (7, 8) lies within 6 tiles of the rectangle's west edge.
    expect(decorInChunk(g, 7, 8, CHUNK)).not.toBe(edge)
    forgetDecor(g)
    expect(decorInChunk(g, 0, 0, CHUNK)).not.toBe(far)
  })
})

describe('spacing', () => {
  it('keeps items apart: no two candidates closer than a pumpkin is wide', () => {
    const items = all().filter((i) => i.kind !== 'web')
    const buckets = new Map<number, DecorItem[]>()
    for (const it of items) {
      const k = Math.floor(it.y) * 100_000 + Math.floor(it.x)
      const list = buckets.get(k)
      if (list) list.push(it)
      else buckets.set(k, [it])
    }
    let worst = Infinity
    for (const it of items) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const o of buckets.get((Math.floor(it.y) + dy) * 100_000 + Math.floor(it.x) + dx) ?? []) {
            if (o !== it) worst = Math.min(worst, Math.hypot(it.x - o.x, it.y - o.y))
          }
        }
      }
    }
    // MIN_GAP_M is 3.8 m (0.76 tile); jitter inside a tile and the grid's own scale allow a little less.
    expect(worst).toBeGreaterThan(0.45)
  })
})

describe('placement', () => {
  it('finds decor in the demo area, of several kinds', () => {
    const kinds = new Set(all().map((i) => i.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(7)
  })

  it('is deterministic: a grid built again gets the same decor (property over chunks)', () => {
    const again = buildTileGrid(loadDemoOsm())
    fc.assert(
      fc.property(fc.integer({ min: 0, max: chunksX - 1 }), fc.integer({ min: 0, max: chunksY - 1 }), (cx, cy) => {
        const a = decorInChunk(grid, cx, cy, CHUNK)
        const b = decorInChunk(again, cx, cy, CHUNK)
        expect([...b.statics, ...b.animated].map(key)).toEqual([...a.statics, ...a.animated].map(key))
        expect(decorInChunk(grid, cx, cy, CHUNK)).toBe(a)
      }),
      { numRuns: 60 },
    )
  })

  it('lists items in rank order with a stable static order', () => {
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const { statics, animated } = decorInChunk(grid, cx, cy, CHUNK)
        statics.forEach((s, i) => {
          expect(s.order).toBe(i)
          if (i > 0) expect(s.rank).toBeGreaterThanOrEqual(statics[i - 1]!.rank)
        })
        for (const a of animated) expect(a.order).toBe(-1)
      }
    }
  })

  it('never stands on a street, path or crossing, nor on water or a building (roaming items and graves keep a street-free 3×3)', () => {
    for (const it of all()) {
      // Small still items stand beside streets (their tile and the one above are free); roaming ones and graves need the whole 3×3.
      expect(tileClear(grid, it.tx, it.ty, undefined, LOW_KINDS.has(it.kind))).toBe(true)
      if (it.animated || it.kind === 'graves' || it.kind === 'web') expect(clearOfStreets(grid, it.tx, it.ty)).toBe(true)
      const t = grid.terrain[it.ty * grid.cols + it.tx]
      expect([Terrain.park, Terrain.plaza, Terrain.ground]).toContain(t)
      // Foot and sprite stay within the tile's 3×3 neighbourhood (graves and fog reach about one tile).
      expect(Math.abs(it.x - (it.tx + 0.5))).toBeLessThanOrEqual(1.1)
      expect(Math.abs(it.y - (it.ty + 0.5))).toBeLessThanOrEqual(1.1)
    }
  })

  it('keeps every sprite pixel off street tiles', () => {
    const isStreet = (x: number, y: number) => {
      if (!grid.inBounds(x, y)) return false
      const t = grid.terrain[y * grid.cols + x]
      return t === Terrain.road || t === Terrain.path || t === Terrain.crossing
    }
    for (const it of all()) {
      if (it.kind === 'bat') continue // flies; its orbit is checked below
      const reach = it.kind === 'graves' ? 0.6 : it.kind === 'fog' ? 1.0 : (HALF_WIDTH[it.kind] ?? 0.4) - 1e-6
      // A pumpkin's small companion reaches 0.8 tile to one side.
      const left = it.kind === 'pumpkin' && it.variant === 2 ? 0.8 : reach
      const right = it.kind === 'pumpkin' && it.variant === 1 ? 0.8 : reach
      for (const [dx, dy] of [[-left, 0], [right, 0], [0, -reach], [0, 0.0]] as const) expect(isStreet(Math.floor(it.x + dx), Math.floor(it.y + dy)), `${it.kind} ${it.variant} ${it.x} ${it.y} ${dx} ${dy}`).toBe(false)
    }
  })

  it('keeps bat orbits and fog drift over streetless tiles', () => {
    const isStreet = (x: number, y: number) => {
      if (!grid.inBounds(x, y)) return false
      const t = grid.terrain[y * grid.cols + x]
      return t === Terrain.road || t === Terrain.path || t === Terrain.crossing
    }
    const moving = all().filter((i) => i.kind === 'bat' || i.kind === 'fog')
    expect(moving.length).toBeGreaterThan(0)
    for (const it of moving.slice(0, 200)) {
      for (let tick = 0; tick < 12 * 60; tick += 37) {
        const x = it.kind === 'bat' ? batX(it, tick) : fogX(it, tick)
        const y = it.kind === 'bat' ? batY(it, tick) : it.y
        // The whole sprite counts, not just its foot: half width (bat 13 art px, fog 20) and height (7 and 9 px).
        const hw = it.kind === 'bat' ? 0.41 : 0.63
        const h = it.kind === 'bat' ? 0.44 : 0.57
        for (const [dx, dy] of [[0, 0], [-hw, 0], [hw, 0], [-hw, -h], [hw, -h], [0, -h]] as const) expect(isStreet(Math.floor(x + dx), Math.floor(y + dy))).toBe(false)
      }
    }
  })

  it('night-only kinds are exactly bats and fog, and they are the animated ones with skeletons', () => {
    for (const it of all()) {
      expect(it.nightOnly).toBe(it.kind === 'bat' || it.kind === 'fog')
      expect(it.animated).toBe(it.kind === 'bat' || it.kind === 'fog' || it.kind === 'skeleton')
    }
  })

  it('leaves tiles without loaded data bare (streamed worlds)', () => {
    const g = buildTileGrid(loadDemoOsm())
    g.covered = new Uint8Array(g.cols * g.rows)
    expect(all(g).length).toBe(0)
  })
})

describe('budget', () => {
  it('hides decor below the detail zoom and when switched off', () => {
    expect(decorBudget(MIN_DECOR_ZOOM - 0.5, 1).visible).toBe(false)
    expect(decorBudget(16, 1, false).visible).toBe(false)
    expect(decorBudget(MIN_DECOR_ZOOM, 1).visible).toBe(true)
  })
  it('shows more per chunk as the zoom grows, never fewer', () => {
    let prev = 0
    for (const z of [8, 9, 12, 16, 24, 32, 48]) {
      const n = decorBudget(z, 0).staticPerChunk
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
    expect(decorBudget(8, 0).staticPerChunk).toBeLessThan(decorBudget(32, 0).staticPerChunk)
  })
  it('is subtler by day and fuller at night', () => {
    const day = decorBudget(16, 0)
    const night = decorBudget(16, 0.8)
    expect(day.night).toBe(false)
    expect(night.night).toBe(true)
    expect(day.density).toBeLessThan(night.density)
    expect(day.animPerChunk).toBeLessThanOrEqual(night.animPerChunk)
  })
  it('keeps a phone screen to a few static items at every zoom (cap per screen)', () => {
    // 390 × 844 CSS px phone, many positions across the demo area.
    for (const zoom of [8, 12, 16, 24, 32, 48]) {
      const b = decorBudget(zoom, 0.8)
      const wT = 390 / zoom
      const hT = 844 / zoom
      let worst = 0
      for (let x0 = 0; x0 + wT < grid.cols; x0 += 23) {
        for (let y0 = 0; y0 + hT < grid.rows; y0 += 29) {
          let n = 0
          for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y0 + hT) / CHUNK); cy++) {
            for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x0 + wT) / CHUNK); cx++) {
              for (const s of decorInChunk(grid, cx, cy, CHUNK).statics) {
                if (s.order < b.staticPerChunk && s.rank < b.density && s.x >= x0 && s.x < x0 + wT && s.y >= y0 && s.y < y0 + hT) n++
              }
            }
          }
          worst = Math.max(worst, n)
        }
      }
      expect(worst).toBeLessThanOrEqual(MAX_STATIC_PER_SCREEN)
    }
  })
})

describe('yards', () => {
  // Pretend every other building column is open yard: decor may stand there, still never on a street.
  const open: YardTest = (x, y) => grid.terrain[y * grid.cols + x] === Terrain.building && x % 2 === 0
  const statics = (g: typeof grid, yard?: YardTest): DecorItem[] => {
    const out: DecorItem[] = []
    for (let cy = 0; cy < chunksY; cy++) for (let cx = 0; cx < chunksX; cx++) out.push(...decorInChunk(g, cx, cy, CHUNK, yard).statics)
    return out
  }
  it('stands on building tiles only where the yard test says open, and finds more decor than without', () => {
    const without = statics(buildTileGrid(loadDemoOsm())).length
    const g = buildTileGrid(loadDemoOsm())
    const items = statics(g, open)
    const onBuilding = items.filter((i) => g.terrain[i.ty * g.cols + i.tx] === Terrain.building)
    expect(onBuilding.length).toBeGreaterThan(0)
    for (const i of onBuilding) expect(open(i.tx, i.ty)).toBe(true)
    expect(items.length).toBeGreaterThan(without)
  })
  it('never puts a yard item on a street', () => {
    const g = buildTileGrid(loadDemoOsm())
    for (const i of statics(g, open)) expect(tileClear(g, i.tx, i.ty, open, LOW_KINDS.has(i.kind))).toBe(true)
  })
})

describe('animation', () => {
  const bat = all().find((i) => i.kind === 'bat')!
  it('steps at 12 Hz', () => {
    expect(tickOf(0, false)).toBe(0)
    expect(tickOf(ANIM_FRAME_MS * 5 + 1, false)).toBe(5)
    expect(tickOf(ANIM_FRAME_MS * 5 - 1, false)).toBe(4)
  })
  it('rests with reduced motion', () => {
    const tick = tickOf(123_456, true)
    expect(tick).toBe(0)
    expect(batFrame(tick, bat)).toBe(0)
    expect(skeletonFrame(tick)).toBe(0)
    expect(flickerLevel(bat, tick)).toBe(1)
  })
  it('flaps the wings and flies slowly (under 1 tile a second)', () => {
    expect(new Set(Array.from({ length: 8 }, (_, t) => batFrame(t + 1, bat))).size).toBe(2)
    for (let t = 1; t < 400; t++) {
      const speed = Math.hypot(batX(bat, t + 1) - batX(bat, t), batY(bat, t + 1) - batY(bat, t)) * 12
      expect(speed).toBeLessThan(1)
    }
  })
  it('caps the animated items per frame', () => {
    expect(MAX_ANIMATED).toBeLessThanOrEqual(16)
  })
})

describe('open squares (task 91.1)', () => {
  /** Plaça-sized open paving: 450 m × 450 m of plaza tiles, nothing else. */
  const plazaGrid = (): TileGrid => {
    const g = new TileGrid({ south: 39.4690, west: -0.3790, north: 39.4730, east: -0.3730 })
    g.terrain.fill(Terrain.plaza)
    return g
  }
  const itemsOf = (g: TileGrid): DecorItem[] => {
    const out: DecorItem[] = []
    for (let cy = 0; cy * CHUNK < g.rows; cy++) for (let cx = 0; cx * CHUNK < g.cols; cx++) out.push(...decorInChunk(g, cx, cy, CHUNK).statics, ...decorInChunk(g, cx, cy, CHUNK).animated)
    return out.filter((i) => i.kind !== 'web')
  }
  const plaza = plazaGrid()
  const plazaItems = itemsOf(plaza)
  const blockOf = (g: TileGrid, it: DecorItem) => {
    const ll = g.tileToLatLon(it.x, it.y)
    return `${Math.floor(ll.lat / LAT_STEP / PLAZA_BLOCK)},${Math.floor(ll.lon / LON_STEP / PLAZA_BLOCK)}`
  }

  it('property: a plaza block never holds more than the cap, and the items stand apart', () => {
    expect(plazaItems.length).toBeGreaterThan(5)
    const perBlock = new Map<string, number>()
    for (const it of plazaItems) perBlock.set(blockOf(plaza, it), (perBlock.get(blockOf(plaza, it)) ?? 0) + 1)
    for (const n of perBlock.values()) expect(n).toBeLessThanOrEqual(PLAZA_CAP)
    fc.assert(
      fc.property(fc.integer({ min: 0, max: plazaItems.length - 1 }), fc.integer({ min: 0, max: plazaItems.length - 1 }), (a, b) => {
        fc.pre(a !== b)
        const p = plazaItems[a]!
        const q = plazaItems[b]!
        // Jitter inside a tile and the tile grid's own scale allow a little less than the gap, in tile units.
        expect(Math.hypot(p.x - q.x, p.y - q.y) * plaza.metresPerTile).toBeGreaterThan(PLAZA_GAP_M * 0.75 - 1)
      }),
      { numRuns: 300 },
    )
  })

  it('shows a handful on any phone screen of plaza (16 × 35 tiles), not dozens', () => {
    let worst = 0
    for (let y = 0; y + 35 <= plaza.rows; y += 7) {
      for (let x = 0; x + 16 <= plaza.cols; x += 7) worst = Math.max(worst, plazaItems.filter((i) => i.x >= x && i.x < x + 16 && i.y >= y && i.y < y + 35).length)
    }
    expect(worst).toBeLessThanOrEqual(5)
  })

  it('is the same whichever chunk size asks, and after a grid is built again', () => {
    const again = plazaGrid()
    const a = itemsOf(plaza).map(key).sort()
    const b: DecorItem[] = []
    for (let cy = 0; cy * 16 < again.rows; cy++) for (let cx = 0; cx * 16 < again.cols; cx++) b.push(...decorInChunk(again, cx, cy, 16).statics, ...decorInChunk(again, cx, cy, 16).animated)
    expect(b.filter((i) => i.kind !== 'web').map(key).sort()).toEqual(a)
  })

  it('leaves parks as full as before', () => {
    const g = plazaGrid()
    g.terrain.fill(Terrain.park)
    const park = itemsOf(g).length
    expect(park).toBeGreaterThan(plazaItems.length * 5)
  })
})
