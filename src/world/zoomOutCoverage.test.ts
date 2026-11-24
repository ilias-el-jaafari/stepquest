import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDemoOsm } from '../osm/demo.ts'
import { DEMO_AREA } from '../osm/demoArea.ts'
import { MapRenderer } from '../render/MapRenderer.ts'
import { P } from '../render/palette.ts'
import { installSoftCanvas, SoftCanvas } from '../render/testing/softCanvas.ts'
import { COARSE_Z } from '../vector/assemble.ts'
import type { TileSource } from '../vector/client.ts'
import { TileError } from '../vector/fetchTile.ts'
import { tileToOsm } from '../vector/omt.ts'
import { encodeMvt } from '../vector/testing.ts'
import { tileKey, type TileId } from '../vector/tileMath.ts'
import { cellKey, cellsInBBox } from './cells.ts'
import { isComplete, sliceToCells } from './slice.ts'
import { LiveWorld } from './liveWorld.ts'
import { Streamer } from './streamer.ts'

/**
 * Field check of f1632f2 (390 × 844, quest, fully zoomed out, no pan): readiness said `full` while
 * the bottom of the view and a strip at the top left were flat no-data ground. The flat parts were
 * the edge cells of the bundled extract, which it covers only in part; their partial record was
 * painted instead of the coarse tile and counted as covered (requirements 21.7, 21.14, 21.15).
 */
const W = 390
const H = 844
const FLAT = `${P.groundB}ff`
/** Cells the bundled extract covers only in part. */
const PARTIAL = sliceToCells(loadDemoOsm()).filter((r) => !isComplete(r)).map((r) => cellKey(r.cell))

/** A tile that covers itself with grass (into the buffer, as real tiles do) and has one street. */
function tileBytes(): Uint8Array {
  return encodeMvt([
    { name: 'landcover', features: [{ type: 3, props: { class: 'grass', subclass: 'park' }, geometry: [[[-64, -64], [4160, -64], [4160, 4160], [-64, 4160], [-64, -64]]] }] },
    { name: 'transportation', features: [{ type: 2, props: { class: 'primary' }, geometry: [[[0, 2048], [4096, 2048]]] }] },
  ])
}

let restore: () => void
beforeEach(() => {
  restore = installSoftCanvas()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00Z'))
  vi.stubGlobal('devicePixelRatio', 1)
})
afterEach(() => {
  restore()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function zoomedOut(fails: (t: TileId) => boolean = () => false) {
  const bytes = tileBytes()
  const asked: TileId[] = []
  const tiles: TileSource = {
    busy: false,
    cachedTile: async () => undefined,
    loadTile: async (t) => {
      asked.push(t)
      if (fails(t)) throw new TileError('network', 'timed out')
      return tileToOsm(bytes, t, { coarse: t.z === COARSE_Z })
    },
  }
  const world = LiveWorld.fromData(loadDemoOsm())
  const canvas = new SoftCanvas(10, 10)
  canvas.clientWidth = W
  canvas.clientHeight = H
  const r = new MapRenderer(canvas as unknown as HTMLCanvasElement, world)
  r.setClockOverride(12 * 60)
  const s = new Streamer({ tiles, world, online: () => true, reanchor: () => true, random: () => 0.5 })
  r.onViewChange((box, centre, zoom) => s.setView(box, centre, zoom))
  r.setQuest({ player: undefined, accuracyM: undefined, collected: 0, alongM: 0 })
  r.centerOn(DEMO_AREA.center, 16)
  r.render()
  for (let k = 0; k < 12; k++) r.zoomStep(-1)
  r.render()
  await vi.advanceTimersByTimeAsync(10_000)
  for (let k = 0; k < 4; k++) r.render()
  /** Flat no-data pixels per row and per column of the whole canvas (the HUD and panels are DOM over it). */
  const rows = Array.from({ length: H }, () => 0)
  const cols = Array.from({ length: W }, () => 0)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (canvas.pixel(x, y) === FLAT) {
        rows[y]!++
        cols[x]!++
      }
  return { world, s, r, asked, rows, cols, flat: rows.reduce((a, b) => a + b, 0) }
}

describe('fully zoomed out in a quest (requirements 21.7, 21.14, 21.15)', () => {
  it('reaches full with map data on every pixel row and column, the band under the HUD included', async () => {
    const { s, r, rows, cols, flat } = await zoomedOut()
    expect(r.zoom).toBe(0.5)
    expect(s.status()).toEqual({ ready: 'full', pending: 0 })
    // The view really reaches over the partly covered edge cells of the bundled extract (the field case).
    const inView = new Set(cellsInBBox(r.viewBBox()).map(cellKey))
    expect(PARTIAL.filter((k) => inView.has(k)).length).toBeGreaterThan(5)
    expect(flat).toBe(0)
    expect(rows.every((n) => n === 0)).toBe(true)
    expect(cols.every((n) => n === 0)).toBe(true)
    // The bottom 20 % (under the quest HUD) explicitly.
    expect(rows.slice(Math.floor(H * 0.8)).every((n) => n === 0)).toBe(true)
  })

  it('never says full while a visible tile is missing, and counts every cell that lacks one', async () => {
    const { asked } = await zoomedOut()
    const coarse = [...new Map(asked.filter((t) => t.z === COARSE_Z).map((t) => [tileKey(t), t])).values()]
    expect(coarse.length).toBeGreaterThan(1)
    for (const missing of coarse) {
      const run = await zoomedOut((t) => tileKey(t) === tileKey(missing))
      // Nothing for the cells of that tile: the map must say so.
      expect(run.s.status().ready, tileKey(missing)).not.toBe('full')
      expect(run.s.status().pending, tileKey(missing)).toBeGreaterThan(0)
      // And whenever flat ground shows, readiness is not full (the converse of the test above).
      if (run.flat > 0) expect(run.s.status().ready).not.toBe('full')
    }
  }, 60_000)
})
