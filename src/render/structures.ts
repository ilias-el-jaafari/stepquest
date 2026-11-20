import type { House, Landmark } from '../town/layout.ts'
import { P } from './palette.ts'

/**
 * Painters for multi-tile structures (houses, landmark buildings, park gates)
 * and small lot decorations. All pixel art is original and drawn with plain
 * fillRect calls, so it also works on an OffscreenCanvas and in tests.
 */

type Ctx = Pick<CanvasRenderingContext2D, 'fillRect'> & { fillStyle: string | CanvasGradient | CanvasPattern }

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  if (w <= 0 || h <= 0) return
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

/** Draw a character-grid icon; '.' is transparent. */
function icon(ctx: Ctx, x: number, y: number, rows: readonly string[], colors: Record<string, string>) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = colors[row[dx] ?? '.']
      if (c) rect(ctx, x + dx, y + dy, 1, 1, c)
    }
  })
}

type RoofColours = readonly [string, string, string]

/** Gabled roof seen from the south: ridge highlight, staggered shingles, dark eave. */
function gabledRoof(ctx: Ctx, x: number, y: number, w: number, h: number, [base, dark, light]: RoofColours) {
  rect(ctx, x, y, w, h, base)
  for (let yy = y + 5; yy < y + h - 2; yy += 4) {
    rect(ctx, x + 1, yy, w - 2, 1, dark)
    const offset = ((yy - y) / 4) % 2 ? 2 : 6
    for (let xx = x + offset; xx < x + w - 1; xx += 8) rect(ctx, xx, yy - 3, 1, 3, dark)
  }
  rect(ctx, x + 1, y + 1, w - 2, 2, light)
  rect(ctx, x + 1, y + h - 2, w - 2, 1, dark)
  // Outline.
  rect(ctx, x, y, w, 1, P.ink)
  rect(ctx, x, y, 1, h, P.ink)
  rect(ctx, x + w - 1, y, 1, h, P.ink)
  rect(ctx, x, y + h - 1, w, 1, P.ink)
}

/** Flat roof with a parapet and a few rooftop boxes (apartment blocks). */
function flatRoof(ctx: Ctx, x: number, y: number, w: number, h: number, [base, dark, light]: RoofColours, seed: number) {
  rect(ctx, x, y, w, h, light)
  rect(ctx, x + 3, y + 3, w - 6, h - 6, base)
  // Tiled terrace pattern.
  for (let yy = y + 3; yy < y + h - 3; yy += 4) rect(ctx, x + 3, yy, w - 6, 1, dark)
  // Rooftop details: an AC unit and a hatch.
  const ax = x + 6 + (seed % Math.max(1, w - 20))
  rect(ctx, ax, y + 6, 8, 6, P.ink)
  rect(ctx, ax + 1, y + 7, 6, 4, P.curb)
  rect(ctx, ax + 2, y + 8, 4, 1, P.curbShadow)
  if (w > 40) {
    const hx = x + w - 14
    rect(ctx, hx, y + h - 13, 7, 6, P.ink)
    rect(ctx, hx + 1, y + h - 12, 5, 4, P.stoneDark)
  }
  rect(ctx, x, y, w, 1, P.ink)
  rect(ctx, x, y, 1, h, P.ink)
  rect(ctx, x + w - 1, y, 1, h, P.ink)
  rect(ctx, x, y + h - 1, w, 1, P.ink)
  rect(ctx, x + 1, y + h - 2, w - 2, 1, dark)
}

/** Corrugated metal roof (warehouses). */
function metalRoof(ctx: Ctx, x: number, y: number, w: number, h: number, [base, dark, light]: RoofColours) {
  rect(ctx, x, y, w, h, P.curb)
  for (let xx = x + 1; xx < x + w - 1; xx += 3) rect(ctx, xx, y + 1, 1, h - 2, P.asphaltA)
  rect(ctx, x + 1, y + 1, w - 2, 2, light)
  rect(ctx, x + 1, y + h - 3, w - 2, 2, base)
  rect(ctx, x + 1, y + h - 2, w - 2, 1, dark)
  rect(ctx, x, y, w, 1, P.ink)
  rect(ctx, x, y, 1, h, P.ink)
  rect(ctx, x + w - 1, y, 1, h, P.ink)
  rect(ctx, x, y + h - 1, w, 1, P.ink)
}

function windowAt(ctx: Ctx, x: number, y: number, w = 8, h = 7) {
  rect(ctx, x, y, w, h, P.ink)
  rect(ctx, x + 1, y + 1, w - 2, h - 2, P.window)
  rect(ctx, x + 1, y + 1, 2, 1, P.windowHi)
  rect(ctx, x + 1, y + 2, 1, 1, P.windowHi)
  if (w >= 8) rect(ctx, x + Math.floor(w / 2), y + 1, 1, h - 2, P.ink)
}

function doorAt(ctx: Ctx, x: number, y: number, h: number, color: string = P.door) {
  rect(ctx, x, y, 8, h, P.ink)
  rect(ctx, x + 1, y + 1, 6, h - 1, color)
  rect(ctx, x + 2, y + 2, 4, 1, P.trunk)
  rect(ctx, x + 5, y + Math.floor(h / 2), 1, 1, P.flowerY)
}

/** Wall band with outline; returns nothing, the caller adds windows and doors. */
function wall(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, shade: string) {
  rect(ctx, x, y, w, h, color)
  rect(ctx, x, y, w, 1, shade) // shadow under the eave
  rect(ctx, x, y + h - 2, w, 1, shade)
  rect(ctx, x, y, 1, h, P.ink)
  rect(ctx, x + w - 1, y, 1, h, P.ink)
  rect(ctx, x, y + h - 1, w, 1, P.ink)
}

/** One house on its lot. (x, y) is the top-left pixel; sizes come from the house in tiles. */
export function paintHouse(ctx: Ctx, x: number, y: number, house: House): void {
  const W = house.w * 16
  const H = house.h * 16
  const roof = P.roofs[house.roof % P.roofs.length]!
  const [wallC, shade] = P.walls[house.wall % P.walls.length]!
  const doorX = x + house.door * 16 + 4
  if (house.kind === 'apartments') {
    const floors = Math.max(2, Math.min(4, house.h - 2))
    const wallH = 8 + floors * 10
    flatRoof(ctx, x, y, W, H - wallH, roof, house.seed)
    wall(ctx, x + 1, y + H - wallH, W - 2, wallH, wallC, shade)
    for (let f = 0; f < floors; f++) {
      const wy = y + H - wallH + 3 + f * 10
      const ground = f === floors - 1
      for (let c = 0; c < house.w; c++) {
        if (ground && c === house.door) continue
        windowAt(ctx, x + c * 16 + 4, wy, 8, 6)
        // Balcony rails on upper floors, every other column.
        if (!ground && (c + house.seed) % 2 === 0) {
          rect(ctx, x + c * 16 + 2, wy + 6, 12, 1, P.ink)
          rect(ctx, x + c * 16 + 2, wy + 7, 12, 1, P.curb)
          for (let px = 3; px < 14; px += 3) rect(ctx, x + c * 16 + px, wy + 5, 1, 2, P.ink)
        }
      }
    }
    // Glass entrance.
    const ey = y + H - 13
    rect(ctx, doorX - 1, ey, 10, 12, P.ink)
    rect(ctx, doorX, ey + 1, 8, 11, P.glass)
    rect(ctx, doorX + 4, ey + 1, 1, 11, P.ink)
    rect(ctx, doorX, ey + 1, 2, 2, P.glassHi)
    return
  }
  if (house.kind === 'warehouse') {
    const wallH = 18
    metalRoof(ctx, x, y, W, H - wallH, roof)
    wall(ctx, x + 1, y + H - wallH, W - 2, wallH, P.curb, P.fenceShade)
    for (let c = 0; c < house.w; c++) if (c !== house.door) windowAt(ctx, x + c * 16 + 4, y + H - wallH + 3, 8, 4)
    // Roller shutter.
    const sy = y + H - 14
    rect(ctx, doorX - 2, sy, 12, 13, P.ink)
    for (let yy = sy + 1; yy < sy + 13; yy += 2) rect(ctx, doorX - 1, yy, 10, 1, P.asphaltA)
    return
  }
  // A small house with a gabled roof.
  const wallH = house.h <= 3 ? 19 : 24
  const roofH = H - wallH
  // Chimney behind the ridge on some houses.
  if (house.seed % 3 === 0) {
    const cx = x + W - 14
    rect(ctx, cx, y, 6, 8, P.ink)
    rect(ctx, cx + 1, y + 1, 4, 6, P.brick)
    rect(ctx, cx + 1, y + 3, 4, 1, P.brickDark)
  }
  gabledRoof(ctx, x, y + (house.seed % 3 === 0 ? 2 : 0), W, roofH - (house.seed % 3 === 0 ? 2 : 0), roof)
  const wy = y + roofH
  wall(ctx, x + 1, wy, W - 2, wallH, wallC, shade)
  for (let c = 0; c < house.w; c++) {
    if (c === house.door) continue
    windowAt(ctx, x + c * 16 + 4, wy + 4)
    // Flower box under some windows.
    if ((house.seed >>> (c + 3)) % 3 === 0) {
      rect(ctx, x + c * 16 + 3, wy + 11, 10, 2, P.trunk)
      rect(ctx, x + c * 16 + 4, wy + 10, 1, 1, P.flowerR)
      rect(ctx, x + c * 16 + 7, wy + 10, 1, 1, P.flowerY)
      rect(ctx, x + c * 16 + 10, wy + 10, 1, 1, P.flowerR)
    }
  }
  doorAt(ctx, doorX, wy + wallH - 13, 12)
  // Door step.
  rect(ctx, doorX - 1, wy + wallH - 1, 10, 1, P.stoneDark)
}

/** Shop sign board with an icon (all icons are our own 9×9 or smaller drawings). */
function sign(ctx: Ctx, cx: number, y: number, rows: readonly string[], colors: Record<string, string>, board: string, edge: string) {
  const w = rows[0]!.length + 6
  const h = rows.length + 6
  const x = Math.round(cx - w / 2)
  rect(ctx, x, y, w, h, P.ink)
  rect(ctx, x + 1, y + 1, w - 2, h - 2, edge)
  rect(ctx, x + 2, y + 2, w - 4, h - 4, board)
  icon(ctx, x + 3, y + 3, rows, colors)
}

// Icons (original drawings).
const ICON_CROSS = ['...www...', '...www...', '...www...', 'wwwwwwwww', 'wwwwwwwww', 'wwwwwwwww', '...www...', '...www...', '...www...']
const ICON_TRAIN = ['..kkkkk..', '.kwwwwwk.', '.kbbkbbk.', '.kbbkbbk.', '.kwwwwwk.', '.kywwwyk.', '.kkkkkkk.', '..k...k..', '.k.....k.']
const ICON_BOOK = ['.........', 'kkkk.kkkk', 'kwwwkwwwk', 'kwbwkwbwk', 'kwwwkwwwk', 'kwbwkwbwk', 'kwwwkwwwk', 'kkkkkkkkk', '.........']
const ICON_BASKET = ['...kkk...', '..k...k..', '.k.....k.', 'kkkkkkkkk', 'kwwwwwwwk', '.kwkwkwk.', '.kwwwwwk.', '..kkkkk..', '.........']
const ICON_CART = ['k........', '.kkkkkkkk', '.kwwwwwwk', '.kwkwkwk.', '..kwwwwk.', '..kkkkkk.', '..k....k.', '.kk...kk.', '.........']
const ICON_LEAF = ['......kk.', '....kkgk.', '...kgggk.', '..kgglgk.', '..kglggk.', '.kglggk..', '.kgggk...', 'k.kkk....', '.........']

/** A big special building: roof band, wall, glass doors and a sign with an icon. */
function bigBuilding(
  ctx: Ctx,
  x: number,
  y: number,
  W: number,
  H: number,
  scheme: { roof: readonly [string, string, string]; wall: string; shade: string; accent: string },
  wallH: number,
) {
  gabledRoof(ctx, x, y, W, H - wallH, scheme.roof)
  wall(ctx, x + 1, y + H - wallH, W - 2, wallH, scheme.wall, scheme.shade)
  // Accent stripe along the facade.
  rect(ctx, x + 2, y + H - wallH + 3, W - 4, 2, scheme.accent)
}

function glassDoors(ctx: Ctx, cx: number, bottom: number, w = 16, h = 14) {
  const x = Math.round(cx - w / 2)
  const y = bottom - h
  rect(ctx, x, y, w, h, P.ink)
  rect(ctx, x + 1, y + 1, w - 2, h - 1, P.glass)
  rect(ctx, x + Math.floor(w / 2), y + 1, 1, h - 1, P.ink)
  rect(ctx, x + 2, y + 2, 2, 3, P.glassHi)
  rect(ctx, x + Math.floor(w / 2) + 2, y + 2, 2, 3, P.glassHi)
  rect(ctx, x - 2, bottom, w + 4, 1, P.stoneDark)
}

function windowRow(ctx: Ctx, x: number, y: number, W: number, skipFrom: number, skipTo: number, w = 8, h = 7) {
  for (let wx = x + 6; wx + w <= x + W - 5; wx += 14) {
    if (wx + w > skipFrom && wx < skipTo) continue
    windowAt(ctx, wx, y, w, h)
  }
}

/** Striped awning over a shop front. */
function awning(ctx: Ctx, x: number, y: number, w: number, a: string, b: string) {
  rect(ctx, x, y, w, 6, P.ink)
  for (let xx = x + 1; xx < x + w - 1; xx += 1) rect(ctx, xx, y + 1, 1, 4, Math.floor((xx - x) / 4) % 2 ? b : a)
  for (let xx = x + 1; xx < x + w - 1; xx += 4) rect(ctx, xx, y + 5, 2, 1, Math.floor((xx - x) / 4) % 2 ? b : a)
}

export function paintLandmark(ctx: Ctx, x: number, y: number, lm: Landmark): void {
  const W = lm.w * 16
  const H = lm.h * 16
  const cx = x + W / 2
  const bottom = y + H - 1
  switch (lm.kind) {
    case 'healing': {
      const s = P.landmarks.healing
      const wallH = 34
      bigBuilding(ctx, x, y, W, H, s, wallH)
      windowRow(ctx, x, y + H - wallH + 8, W, cx - 14, cx + 14)
      glassDoors(ctx, cx, bottom, 18, 15)
      // Sign: a white cross on a teal round badge.
      sign(ctx, cx, y + H - wallH - 10, ICON_CROSS, { w: P.white }, s.roof[0], s.roof[1])
      return
    }
    case 'station': {
      const s = P.landmarks.station
      const wallH = 30
      bigBuilding(ctx, x, y, W, H, s, wallH)
      windowRow(ctx, x, y + H - wallH + 8, W, cx - 16, cx + 16, 8, 9)
      // Stairs going down to the platforms.
      const sx = Math.round(cx - 10)
      rect(ctx, sx, bottom - 15, 20, 15, P.ink)
      for (let i = 0; i < 6; i++) rect(ctx, sx + 1, bottom - 14 + i * 2, 18, 1, i % 2 ? P.curbShadow : P.asphaltA)
      rect(ctx, sx + 1, bottom - 4, 18, 4, P.ink)
      // Clock above the entrance.
      rect(ctx, cx - 4, y + H - wallH - 2, 9, 9, P.ink)
      rect(ctx, cx - 3, y + H - wallH - 1, 7, 7, P.white)
      rect(ctx, cx, y + H - wallH, 1, 3, P.ink)
      rect(ctx, cx, y + H - wallH + 3, 2, 1, P.ink)
      sign(ctx, x + 20, y + H - wallH - 12, ICON_TRAIN, { k: P.ink, w: P.white, b: P.window, y: P.flowerY }, P.white, s.accent)
      return
    }
    case 'school': {
      const s = P.landmarks.school
      const wallH = 32
      bigBuilding(ctx, x, y + 6, W, H - 6, s, wallH)
      // Bell tower.
      const tx = Math.round(cx - 7)
      rect(ctx, tx, y, 14, 16, P.ink)
      rect(ctx, tx + 1, y + 1, 12, 14, s.roof[2])
      rect(ctx, tx + 4, y + 5, 6, 7, P.ink)
      rect(ctx, tx + 5, y + 7, 4, 4, P.flowerY)
      rect(ctx, tx + 1, y + 1, 12, 3, s.roof[1])
      windowRow(ctx, x, y + H - wallH + 8, W, cx - 12, cx + 12)
      windowRow(ctx, x, y + H - wallH + 18, W, cx - 12, cx + 12, 8, 6)
      doorAt(ctx, Math.round(cx - 8), bottom - 13, 13, P.trunk)
      doorAt(ctx, Math.round(cx), bottom - 13, 13, P.trunk)
      sign(ctx, x + 20, y + H - wallH - 10, ICON_BOOK, { k: P.ink, w: P.white, b: s.accent }, P.white, s.accent)
      return
    }
    case 'greenMarket': {
      const s = P.landmarks.greenMarket
      const wallH = 34
      bigBuilding(ctx, x, y, W, H, s, wallH)
      // Wide shop window with shelves of produce.
      const gy = y + H - wallH + 12
      rect(ctx, x + 6, gy, W - 12, 15, P.ink)
      rect(ctx, x + 7, gy + 1, W - 14, 13, P.glass)
      for (let yy = gy + 4; yy < gy + 13; yy += 4) {
        rect(ctx, x + 7, yy + 2, W - 14, 1, P.fenceShade)
        for (let xx = x + 9; xx < x + W - 9; xx += 3) rect(ctx, xx, yy, 2, 2, [P.flowerR, P.crop, P.flowerY, P.lawnDot][(xx + yy) % 4]!)
      }
      awning(ctx, x + 3, gy - 7, W - 6, s.roof[0], P.white)
      glassDoors(ctx, cx, bottom, 20, 15)
      sign(ctx, cx - 9, y + H - wallH - 11, ICON_BASKET, { k: P.ink, w: P.white }, s.roof[0], s.roof[1])
      sign(ctx, cx + 9, y + H - wallH - 11, ICON_LEAF, { k: P.ink, g: P.white, l: s.roof[2] }, s.roof[0], s.roof[1])
      return
    }
    case 'market': {
      const s = P.landmarks.market
      const wallH = 28
      bigBuilding(ctx, x, y, W, H, s, wallH)
      const gy = y + H - wallH + 10
      rect(ctx, x + 5, gy, W - 10, 11, P.ink)
      rect(ctx, x + 6, gy + 1, W - 12, 9, P.glass)
      for (let xx = x + 8; xx < x + W - 8; xx += 3) rect(ctx, xx, gy + 5, 2, 2, (xx % 2 ? P.flowerY : P.flowerR))
      awning(ctx, x + 3, gy - 7, W - 6, s.roof[0], P.white)
      glassDoors(ctx, cx, bottom, 16, 13)
      sign(ctx, cx, y + H - wallH - 11, ICON_CART, { k: P.ink, w: P.white }, P.white, s.accent)
      return
    }
    case 'parkGate': {
      const pillar = (px: number, py: number) => {
        rect(ctx, px, py, 8, 14, P.ink)
        rect(ctx, px + 1, py + 1, 6, 12, P.stone)
        rect(ctx, px + 1, py + 1, 6, 2, P.stoneLight)
        rect(ctx, px + 1, py + 11, 6, 2, P.stoneDark)
        rect(ctx, px, py - 2, 8, 3, P.ink)
        rect(ctx, px + 1, py - 1, 6, 1, P.treeMid)
      }
      if (lm.vertical) {
        // Path runs north–south through the middle column; arch above it.
        pillar(x + 6, y + 16)
        pillar(x + W - 14, y + 16)
        rect(ctx, x + 6, y + 8, W - 12, 7, P.ink)
        rect(ctx, x + 7, y + 9, W - 14, 5, P.trunk)
        rect(ctx, x + 7, y + 9, W - 14, 1, P.flowerY)
        icon(ctx, Math.round(cx - 4), y + 1, ICON_LEAF.slice(0, 8), { k: P.ink, g: P.treeMid, l: P.treeLight })
      } else {
        pillar(x + 4, y + 18)
        pillar(x + 4, y + H - 14)
      }
      return
    }
  }
}

/** Garden tree on a lot tile (round crown, 16×16). */
export function paintGardenTree(ctx: Ctx, x: number, y: number, variant: number): void {
  const crown = [
    '....dddddd....',
    '..ddmmmmmmdd..',
    '.dmmmllmmmmmd.',
    '.dmmllllmmmmd.',
    'dmmmllmmmmmmmd',
    'dmmmmmmmmmmmmd',
    'dmmmmmmmmmmmmd',
    '.dmmmmmmmmmmd.',
    '.ddmmmmmmmmdd.',
    '..dddmmmmddd..',
    '....dddddd....',
  ]
  const fruit = variant % 4 === 0
  crown.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]
      const c = ch === 'd' ? P.treeDark : ch === 'm' ? P.treeMid : ch === 'l' ? P.treeLight : undefined
      if (c) rect(ctx, x + 1 + dx, y + dy, 1, 1, c)
    }
  })
  if (fruit) for (const [fx, fy] of [[4, 4], [9, 6], [6, 8]] as const) rect(ctx, x + fx, y + fy, 1, 1, P.flowerR)
  rect(ctx, x + 6, y + 11, 4, 3, P.trunk)
  rect(ctx, x + 4, y + 14, 8, 1, P.lawnDot)
}

/** White picket fence (or a hedge) along the bottom edge of a front-garden tile. */
export function paintFrontFence(ctx: Ctx, x: number, y: number, hedge: boolean): void {
  if (hedge) {
    rect(ctx, x, y + 10, 16, 6, P.hedge)
    rect(ctx, x, y + 10, 16, 1, P.treeDark)
    for (let xx = x + 1; xx < x + 16; xx += 4) rect(ctx, xx, y + 11, 2, 1, P.treeMid)
    rect(ctx, x, y + 15, 16, 1, P.treeDark)
    return
  }
  rect(ctx, x, y + 11, 16, 1, P.fenceShade)
  rect(ctx, x, y + 13, 16, 1, P.fenceShade)
  for (let xx = x + 1; xx < x + 16; xx += 4) {
    rect(ctx, xx, y + 8, 2, 7, P.fenceShade)
    rect(ctx, xx, y + 8, 1, 6, P.fence)
  }
  rect(ctx, x, y + 11, 16, 1, P.fence)
}

/** Stepping stones from a door to the street. */
export function paintGardenPath(ctx: Ctx, x: number, y: number): void {
  for (const [sx, sy] of [[5, 1], [8, 5], [5, 9], [8, 13]] as const) {
    rect(ctx, x + sx, y + sy, 4, 3, P.stoneDark)
    rect(ctx, x + sx, y + sy, 3, 2, P.stoneLight)
  }
}
