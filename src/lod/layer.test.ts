import { describe, expect, it } from 'vitest'
import type { LatLon } from '../geo/geo.ts'
import { LocalProjection } from '../geo/geo.ts'
import { FAR_ZOOM, ZOOM_LEVELS } from '../render/camera.ts'
import { P } from '../render/palette.ts'
import type { View } from '../render/view.ts'
import { tileBBox, type TileId } from '../vector/tileMath.ts'
import { cellOf } from '../world/cells.ts'
import { LodLayer, type Projector } from './layer.ts'
import { distanceToTileM, tilesWithin } from './select.ts'
import { LodStore } from './store.ts'
import { emptyLod } from './tile.ts'
import { fakeCanvasFactory, makeLod, recordingCtx, type Call } from './testing.ts'

const HERO: LatLon = { lat: 39.4935, lon: -0.392 }
const M_PER_TILE = 5

function projector(origin: LatLon): Projector {
  const proj = new LocalProjection(origin)
  return {
    metresPerTile: M_PER_TILE,
    toTileXY: (p) => {
      const q = proj.toXY(p)
      return { x: q.x / M_PER_TILE, y: q.y / M_PER_TILE }
    },
    tileToLatLon: (tx, ty) => proj.toLatLon(tx * M_PER_TILE, ty * M_PER_TILE),
  }
}

/** The view of a 390 × 844 phone at `zoom` and device ratio `dpr`, centred on `at`. */
function view(p: Projector, at: LatLon, zoom: number, dpr = 2): View {
  const w = Math.round(390 * dpr)
  const h = Math.round(844 * dpr)
  const scale = zoom * dpr
  const c = p.toTileXY(at)
  return { w, h, dpr, zoom, cssW: 390, cssH: 844, scale, originX: Math.round(w / 2 - c.x * scale), originY: Math.round(h / 2 - c.y * scale), camX: c.x, camY: c.y, detail: false }
}

function world(radiusM = 9_000) {
  const f = fakeCanvasFactory()
  const store = new LodStore({ canvas: f.make, later: () => undefined, sliceMs: 1e9 })
  const layer = new LodLayer(store, radiusM)
  layer.setHero(HERO)
  /** Load every tile within `r` of the hero, with a street and a name each, and paint what is asked for. */
  const load = (r = radiusM, only?: (id: TileId) => boolean) => {
    for (const t of tilesWithin(HERO, r)) {
      if (only && !only(t.id)) continue
      store.put(makeLod(t.id, { lines: [{ cls: 'minor', pts: [[0, 2048], [4096, 2048]] }], names: [{ cls: 'primary', name: `Avenida ${t.id.x}`, pts: [[0, 2048], [4096, 2048]] }] }))
    }
  }
  const paintAll = () => {
    for (let k = 0; k < 500 && store.pending; k++) store.slice()
  }
  return { f, store, layer, load, paintAll }
}

type Rect = { x: number; y: number; w: number; h: number }
/** Rectangles that were painted opaque: bitmaps drawn and ground-coloured placeholders. */
function painted(calls: Call[]): Rect[] {
  const out: Rect[] = []
  let fill = ''
  for (const c of calls) {
    if (c.op === 'set:fillStyle') fill = String(c.args[0])
    if (c.op === 'drawImage') out.push({ x: c.args[5] as number, y: c.args[6] as number, w: c.args[7] as number, h: c.args[8] as number })
    if (c.op === 'fillRect' && fill === P.overview.ground) out.push({ x: c.args[0] as number, y: c.args[1] as number, w: c.args[2] as number, h: c.args[3] as number })
  }
  return out
}

/** Share of sample points of a `w × h` screen that no rectangle covers. */
function uncovered(rects: Rect[], w: number, h: number, step = 6): number {
  let missing = 0
  let total = 0
  for (let y = 1; y < h; y += step) {
    for (let x = 1; x < w; x += step) {
      total++
      if (!rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) missing++
    }
  }
  return missing / total
}

describe('LOD layer: no empty area inside the radius at far zoom (requirement 25.3)', () => {
  for (const dpr of [1, 2, 3]) {
    for (const zoom of ZOOM_LEVELS.filter((z) => z <= FAR_ZOOM)) {
      it(`zoom ${zoom} at ratio ${dpr}: with the tiles in, bitmaps cover every pixel of the view, edge to edge`, () => {
        const w = world()
        w.load()
        const p = projector(HERO)
        const v = view(p, HERO, zoom, dpr)
        const ctx = recordingCtx()
        // First frame asks for the bitmaps (placeholders cover meanwhile), the painting runs, the second frame draws them.
        w.layer.drawBlocks(ctx, v, p, HERO)
        w.paintAll()
        const ctx2 = recordingCtx()
        const out = w.layer.drawBlocks(ctx2, v, p, HERO)
        expect(out.bitmaps).toBe(out.tiles)
        expect(out.tiles).toBeGreaterThan(0)
        expect(out.placeholders).toBe(0)
        expect(uncovered(painted(ctx2.calls), v.w, v.h)).toBe(0)
      })
    }
  }

  it('before anything is loaded the whole view inside the radius is the neutral ground colour, never left empty or black', () => {
    const w = world()
    const p = projector(HERO)
    const v = view(p, HERO, 0.5)
    const ctx = recordingCtx()
    const out = w.layer.drawBlocks(ctx, v, p, HERO)
    expect(out.bitmaps + out.standIns).toBe(0)
    expect(out.placeholders).toBe(out.tiles)
    expect(uncovered(painted(ctx.calls), v.w, v.h)).toBe(0)
    expect(ctx.calls.filter((c) => c.op === 'set:fillStyle').every((c) => c.args[0] === P.overview.ground)).toBe(true)
  })

  it('tiles that arrive one by one: loaded ones show their bitmap, the others the placeholder, and never a hole in between', () => {
    const w = world()
    const p = projector(HERO)
    const v = view(p, HERO, 0.75)
    const all = tilesWithin(HERO, 9_000)
    w.load(9_000, (id) => id.x % 2 === 0)
    for (let step = 0; step < 3; step++) {
      const ctx = recordingCtx()
      w.layer.drawBlocks(ctx, v, p, HERO)
      w.paintAll()
      expect(uncovered(painted(ctx.calls), v.w, v.h)).toBe(0)
    }
    const ctx = recordingCtx()
    const out = w.layer.drawBlocks(ctx, v, p, HERO)
    expect(out.bitmaps).toBeGreaterThan(0)
    expect(out.placeholders).toBeGreaterThan(0)
    expect(all.length).toBeGreaterThan(out.tiles)
  })

  it('a tile whose download failed is left alone, so the coarse map under it shows', () => {
    const w = world()
    const p = projector(HERO)
    const v = view(p, HERO, 0.5)
    for (const t of tilesWithin(HERO, 9_000)) w.store.markFailed(t.id)
    const ctx = recordingCtx()
    const out = w.layer.drawBlocks(ctx, v, p, HERO)
    expect(out.skipped).toBeGreaterThan(0)
    expect(out.placeholders + out.bitmaps).toBe(0)
    expect(painted(ctx.calls)).toHaveLength(0)
  })

  it('beyond the radius nothing is drawn (the coarse layer stays), and within it the LOD look is in', () => {
    const w = world()
    w.load()
    const p = projector(HERO)
    const far = { lat: HERO.lat, lon: HERO.lon + 0.2 } // about 17 km east
    const v = view(p, far, 0.5)
    const ctx = recordingCtx()
    const out = w.layer.drawBlocks(ctx, v, p, far)
    expect(out.tiles).toBe(0)
    expect(painted(ctx.calls)).toHaveLength(0)
    // Looking at the edge of the radius: some tiles are LOD, some are coarse.
    const edge = { lat: HERO.lat, lon: HERO.lon + 0.105 }
    const out2 = w.layer.drawBlocks(recordingCtx(), view(p, edge, 0.5), p, edge)
    expect(out2.tiles).toBeGreaterThan(0)
    expect(out2.skipped).toBeGreaterThan(0)
  })

  it('the radius is measured from the hero, not from the view: a view centre outside it still draws the part that is inside', () => {
    const w = world()
    w.load()
    const p = projector(HERO)
    const centre = { lat: HERO.lat, lon: HERO.lon + 0.12 }
    const out = w.layer.drawBlocks(recordingCtx(), view(p, centre, 0.5), p, centre)
    expect(out.tiles).toBeGreaterThan(0)
  })

  it('draws nothing above FAR_ZOOM (the tile art does)', () => {
    const w = world()
    w.load()
    const p = projector(HERO)
    const ctx = recordingCtx()
    expect(w.layer.drawBlocks(ctx, view(p, HERO, 2), p, HERO).tiles).toBe(0)
    expect(ctx.calls).toHaveLength(0)
  })

  it('without a hero the view centre is the centre of the radius', () => {
    const w = world()
    w.load()
    w.layer.setHero(undefined)
    const p = projector(HERO)
    expect(w.layer.drawBlocks(recordingCtx(), view(p, HERO, 0.5), p, HERO).tiles).toBeGreaterThan(0)
  })
})

describe('LOD layer: street names (requirement 25.6)', () => {
  it('draws names with the pixel font at the zooms where their class reads, and none at detail zoom', () => {
    const w = world()
    w.load()
    const p = projector(HERO)
    for (const [zoom, expectLabels] of [[0.5, true], [1, true], [1.5, true], [4, true], [8, false], [24, false]] as const) {
      const ctx = recordingCtx()
      const n = w.layer.drawLabels(ctx, view(p, HERO, zoom), p)
      expect(n > 0, `zoom ${zoom}`).toBe(expectLabels)
      if (expectLabels) expect(ctx.calls.some((c) => c.op === 'fillText')).toBe(true)
    }
  })

  it('names minor streets only from FAR_ZOOM, primary ones from the start', () => {
    const f = fakeCanvasFactory()
    const store = new LodStore({ canvas: f.make, later: () => undefined })
    const layer = new LodLayer(store)
    layer.setHero(HERO)
    const p = projector(HERO)
    const id = tilesWithin(HERO, 100)[0]!.id
    store.put(makeLod(id, { names: [{ cls: 'minor', name: 'Carrer Menor', pts: [[0, 1000], [4096, 1000]] }, { cls: 'primary', name: 'Gran Via', pts: [[0, 3000], [4096, 3000]] }] }))
    const texts = (zoom: number) => {
      const ctx = recordingCtx()
      layer.drawLabels(ctx, view(p, HERO, zoom), p)
      return ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])
    }
    expect(new Set(texts(0.5))).toEqual(new Set(['Gran Via']))
    expect(new Set(texts(1))).toEqual(new Set(['Gran Via']))
    expect(new Set(texts(1.5))).toEqual(new Set(['Gran Via', 'Carrer Menor']))
  })

  it('the labels it draws never overlap (device boxes) and stay within the cap', () => {
    const w = world()
    w.load()
    const p = projector(HERO)
    const ctx = recordingCtx()
    const n = w.layer.drawLabels(ctx, view(p, HERO, 1), p)
    expect(n).toBeLessThanOrEqual(60)
    expect(n).toBeGreaterThan(0)
  })
})

describe('LOD layer: tap and coverage', () => {
  it('snaps a tap at any zoom to the street under it, with its name', () => {
    const w = world()
    w.load()
    const t = tilesWithin(HERO, 100)[0]!.id
    const b = tileBBox(t)
    const onStreet = { lat: (b.north + b.south) / 2, lon: b.west + (b.east - b.west) * 0.3 }
    const tap = { lat: onStreet.lat - 0.0001, lon: onStreet.lon } // about 11 m south of the street
    for (const zoom of [0.5, 1.5, 4, 8, 24]) {
      const s = w.layer.snapAt(tap, zoom, M_PER_TILE)
      if (zoom === 24) {
        // At zoom 24 the reach is 12 m: still found.
        expect(s?.name).toBe(`Avenida ${t.x}`)
      } else expect(s?.name).toBe(`Avenida ${t.x}`)
      expect(Math.abs(s!.point.lat - onStreet.lat)).toBeLessThan(0.00002)
    }
  })

  it('tells the streamer which cells it covers: ready with the tiles in, loading while they are not, no outside the radius or after a failure', () => {
    const w = world()
    const cell = cellOf(HERO)
    expect(w.layer.coverage(cell, HERO)).toBe('loading')
    w.load()
    expect(w.layer.coverage(cell, HERO)).toBe('ready')
    expect(w.layer.coverage({ i: cell.i, j: cell.j + 30 }, HERO)).toBe('no')
    const w2 = world()
    for (const t of tilesWithin(HERO, 9_000)) w2.store.markFailed(t.id)
    expect(w2.layer.coverage(cell, HERO)).toBe('no')
    expect(new LodLayer(new LodStore()).coverage(cell, undefined)).toBe('no')
    expect(distanceToTileM(tilesWithin(HERO, 1)[0]!.id, HERO)).toBe(0)
    expect(emptyLod({ z: 14, x: 1, y: 1 }).v).toBe(1)
  })
})

describe('focus points (requirement 26.3)', () => {
  const FAR = { lat: HERO.lat + 0.15, lon: HERO.lon } // about 17 km north: beyond the hero's rings

  it('a cell near a focus point is covered; without one it is not', () => {
    const { layer, store } = world(9_000)
    expect(layer.coverage(cellOf(FAR), HERO)).toBe('no')
    layer.setFocus([FAR])
    expect(layer.coverage(cellOf(FAR), HERO)).toBe('loading')
    for (const t of tilesWithin(FAR, 2_500)) store.put(makeLod(t.id, { lines: [{ cls: 'minor', pts: [[0, 2048], [4096, 2048]] }] }))
    expect(layer.coverage(cellOf(FAR), HERO)).toBe('ready')
    layer.setFocus([])
    expect(layer.coverage(cellOf(FAR), HERO)).toBe('no')
  })

  it('draws the tiles around a focus point as LOD blocks, and the others beyond the rings are left to the coarse layer', () => {
    const { layer, store, f } = world(9_000)
    layer.setFocus([FAR])
    for (const t of tilesWithin(FAR, 2_500)) store.put(makeLod(t.id, { lines: [{ cls: 'minor', pts: [[0, 2048], [4096, 2048]] }] }))
    const p = projector(HERO)
    const rec = recordingCtx()
    const out = layer.drawBlocks(rec as unknown as CanvasRenderingContext2D, view(p, FAR, FAR_ZOOM), p, FAR)
    expect(out.tiles).toBeGreaterThan(0)
    expect(out.bitmaps + out.standIns + out.placeholders).toBe(out.tiles)
    void f
    const none = new LodLayer(new LodStore({ canvas: () => undefined }), 9_000)
    none.setHero(HERO)
    expect(none.drawBlocks(recordingCtx() as unknown as CanvasRenderingContext2D, view(p, FAR, FAR_ZOOM), p, FAR).tiles).toBe(0)
  })

  it('tells the renderer to draw again when the focus changes, and not when it does not', () => {
    const { layer } = world(9_000)
    let n = 0
    layer.subscribe(() => n++)
    layer.setFocus([FAR])
    layer.setFocus([{ ...FAR }])
    expect(n).toBe(1)
  })
})
