import { describe, expect, it } from 'vitest'
import { BLOB_MASKS, blobIndex, Dir4, Dir8, mask4At, mask8At, reduceMask8, shape4 } from './autotile.ts'
import { Terrain, type TerrainId } from './grid.ts'

/** Build a lookup from ASCII art: R road, P path, X crossing, B building, W water, G park, . ground. */
function grid(art: string) {
  const rows = art.trim().split('\n').map((r) => r.trim())
  const code: Record<string, TerrainId> = {
    '.': Terrain.ground, R: Terrain.road, P: Terrain.path, X: Terrain.crossing,
    B: Terrain.building, W: Terrain.water, G: Terrain.park,
  }
  const at = (x: number, y: number): TerrainId | undefined => {
    const ch = rows[y]?.[x]
    return ch === undefined ? undefined : code[ch]
  }
  return at
}

describe('4-bit masks (paths)', () => {
  it('detects a straight east-west path', () => {
    const at = grid(`
      .....
      PPPPP
      .....`)
    expect(mask4At(at, 2, 1)).toBe(Dir4.E | Dir4.W)
    expect(shape4(mask4At(at, 2, 1))).toBe('straight')
  })
  it('detects a corner, a tee and a cross', () => {
    const at = grid(`
      .P...P.
      .PPPPPP
      .P...P.`)
    expect(shape4(mask4At(at, 1, 1))).toBe('tee') // N, E, S
    expect(mask4At(at, 1, 1)).toBe(Dir4.N | Dir4.E | Dir4.S)
    expect(shape4(mask4At(at, 5, 1))).toBe('cross')
    const corner = grid(`
      ...
      .PP
      .P.`)
    expect(mask4At(corner, 1, 1)).toBe(Dir4.E | Dir4.S)
    expect(shape4(mask4At(corner, 1, 1))).toBe('corner')
  })
  it('marks dead ends and isolated tiles', () => {
    const at = grid(`
      .....
      .PP..
      .....
      ...P.
      .....`)
    expect(shape4(mask4At(at, 1, 1))).toBe('end')
    expect(mask4At(at, 3, 3)).toBe(0)
    expect(shape4(0)).toBe('isolated')
  })
  it('lets a zebra crossing join a footway and a road', () => {
    const at = grid(`
      .P.
      RXR
      .P.`)
    expect(mask4At(at, 1, 0)).toBe(Dir4.N | Dir4.S) // N is the map edge
    expect(mask4At(at, 1, 1)).toBe(15)
    expect(mask4At(at, 0, 1) & Dir4.E).toBe(Dir4.E)
  })
  it('lets a footway run up to the kerb without the road losing its kerb', () => {
    const at = grid(`
      ...
      .P.
      RRR`)
    expect(mask4At(at, 1, 1)).toBe(Dir4.S)
    expect(mask8At(at, 1, 2) & Dir8.N).toBe(0)
  })
  it('treats the map edge as connected so borders do not appear at the edge', () => {
    const at = grid('P')
    expect(mask4At(at, 0, 0)).toBe(15)
  })
})

describe('8-bit blob masks (areas)', () => {
  it('reduces 256 raw masks to the 47 classic blob tiles', () => {
    expect(BLOB_MASKS.length).toBe(47)
    expect(BLOB_MASKS[0]).toBe(0)
    expect(BLOB_MASKS[46]).toBe(255)
  })
  it('drops a diagonal when a neighbouring cardinal is missing', () => {
    expect(reduceMask8(Dir8.NE)).toBe(0)
    expect(reduceMask8(Dir8.N | Dir8.NE)).toBe(Dir8.N)
    expect(reduceMask8(Dir8.N | Dir8.NE | Dir8.E)).toBe(Dir8.N | Dir8.NE | Dir8.E)
  })
  it('finds an inner corner in an L-shaped building block', () => {
    const at = grid(`
      BBB
      BBB
      BB.`)
    // Centre tile: everything but SE.
    expect(mask8At(at, 1, 1)).toBe(255 & ~Dir8.SE)
    expect(blobIndex(mask8At(at, 1, 1))).not.toBe(blobIndex(255))
  })
  it('detects outer edges and corners of a park', () => {
    const at = grid(`
      .....
      .GGG.
      .GGG.
      .GGG.
      .....`)
    expect(mask8At(at, 2, 2)).toBe(255)
    expect(mask8At(at, 1, 1)).toBe(Dir8.E | Dir8.SE | Dir8.S) // top-left corner
    expect(mask8At(at, 2, 1)).toBe(Dir8.E | Dir8.SE | Dir8.S | Dir8.SW | Dir8.W) // top edge
    expect(mask8At(at, 3, 3)).toBe(Dir8.N | Dir8.W | Dir8.NW) // bottom-right corner
  })
  it('does not connect different terrains', () => {
    const at = grid(`
      WWW
      WBW
      WWW`)
    expect(mask8At(at, 1, 1)).toBe(0)
    expect(mask8At(at, 0, 1) & Dir8.E).toBe(0)
  })
  it('maps every raw mask to a valid index', () => {
    for (let m = 0; m < 256; m++) {
      const i = blobIndex(m)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(47)
      expect(BLOB_MASKS[i]).toBe(reduceMask8(m))
    }
  })
})
