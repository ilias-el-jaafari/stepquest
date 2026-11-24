import { Terrain, type TileGrid } from '../tiles/grid.ts'
import type { TownLayout } from '../town/layout.ts'
import { makeCanvas } from './env.ts'
import { P } from './palette.ts'

const hex = (h: string): number[] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/** The far-zoom town map: one pixel per tile (also the stand-in for chunks that are not painted yet). */
export function buildOverview(grid: TileGrid, town: TownLayout): HTMLCanvasElement {
  const { cols, rows } = grid
  const canvas = makeCanvas(cols, rows)
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(cols, rows)
  const colours: Record<number, number[]> = {
    [Terrain.ground]: hex(P.overview.ground),
    [Terrain.park]: hex(P.overview.park),
    [Terrain.water]: hex(P.overview.water),
    [Terrain.road]: hex(P.overview.road),
    [Terrain.path]: hex(P.overview.path),
    [Terrain.crossing]: hex(P.overview.crossing),
    [Terrain.plaza]: hex(P.overview.plaza),
    [Terrain.building]: hex(P.overview.lot),
  }
  const roofRgb = P.roofs.map((r) => hex(r[0]))
  const landmarkRgb = town.landmarks.map((l) => hex(l.kind === 'parkGate' ? P.stone : P.landmarks[l.kind].roof[0]))
  for (let i = 0; i < grid.terrain.length; i++) {
    const t = grid.terrain[i] ?? 0
    const house = town.houseAt[i] ?? -1
    const landmark = town.landmarkAt[i] ?? -1
    const rgb =
      landmark >= 0 && t !== Terrain.path
        ? landmarkRgb[landmark]!
        : house >= 0
          ? roofRgb[(town.houses[house]?.roof ?? 0) % roofRgb.length]!
          : colours[t]!
    image.data[i * 4] = rgb[0]!
    image.data[i * 4 + 1] = rgb[1]!
    image.data[i * 4 + 2] = rgb[2]!
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
