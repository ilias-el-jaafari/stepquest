import { APP_SLUG } from '../config/brand.ts'
import { buildWalker, DEFAULT_WALKER_COLORS, type Body, type Facing, type WalkerColors } from '../render/sprites.ts'
import type { Sprite } from '../render/sprites.ts'

/** How the walker is dressed: a body and one swatch per part. Saved on the device. */
export type Look = { body: Body; skin: number; hair: number; cap: number; shirt: number; pants: number }
export type LookPart = Exclude<keyof Look, 'body'>

export const LOOK_STORAGE_KEY = `${APP_SLUG}.look`
export const BODIES: readonly Body[] = ['boy', 'girl']
export const LOOK_PARTS: readonly LookPart[] = ['skin', 'hair', 'cap', 'shirt', 'pants']

/** Short retro palettes (our own picks), 6–8 swatches each. The first is the default walker. */
export const PALETTES: Record<LookPart, readonly string[]> = {
  skin: ['#f6c79a', '#ffe0c2', '#e8b07c', '#c98b58', '#9a6238', '#6b4126'],
  hair: ['#5a3a2a', '#2a2230', '#8c5a2c', '#e0b850', '#c8482c', '#8a8a9a', '#e8e4dc'],
  cap: ['#2fb3a6', '#e04848', '#3c6ee0', '#f0c030', '#48a850', '#e870a8', '#40404e', '#f08c28'],
  shirt: ['#7b4fc4', '#e04848', '#3c6ee0', '#48a850', '#f0a028', '#30a0b8', '#e870a8', '#e8e4dc'],
  pants: ['#3b4a8a', '#2a2a38', '#6b4a2c', '#4a7a3c', '#8a3c3c', '#5c6878'],
}

export const DEFAULT_LOOK: Look = { body: 'boy', skin: 0, hair: 0, cap: 0, shirt: 0, pants: 0 }

/** Mix a hex colour towards white (0…1), for the light shade of a part. */
export function lighten(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const c = (n >> shift) & 255
    return Math.round(c + (255 - c) * amount)
  }
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

export function lookColors(value: Look): WalkerColors {
  const look = normalizeLook(value)
  const pick = (part: LookPart) => PALETTES[part][look[part]] ?? PALETTES[part][0]!
  return {
    ...DEFAULT_WALKER_COLORS,
    t: pick('cap'),
    T: lighten(pick('cap'), 0.5),
    h: pick('hair'),
    s: pick('skin'),
    p: pick('shirt'),
    P: lighten(pick('shirt'), 0.4),
    b: pick('pants'),
  }
}

const cache = new Map<string, Record<Facing, Sprite[]>>()

/** The walker's sprites for a look (the same object for the same look). */
export function walkerFor(value: Look): Record<Facing, Sprite[]> {
  // Always build from the repaired look, so the cache key and the sprites cannot disagree.
  const look = normalizeLook(value)
  const key = JSON.stringify(look)
  let w = cache.get(key)
  if (!w) {
    w = buildWalker(look.body, lookColors(look))
    cache.set(key, w)
  }
  return w
}

/** Turn whatever was stored into a valid look. */
export function normalizeLook(value: unknown): Look {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out: Look = { ...DEFAULT_LOOK, body: BODIES.includes(v.body as Body) ? (v.body as Body) : DEFAULT_LOOK.body }
  for (const part of LOOK_PARTS) {
    const i = v[part]
    // `+ 0` turns -0 (which JSON can hold) into 0.
    out[part] = typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < PALETTES[part].length ? i + 0 : 0
  }
  return out
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function loadLook(store: StorageLike | undefined = storage()): Look {
  try {
    return normalizeLook(JSON.parse(store?.getItem(LOOK_STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

export function saveLook(look: Look, store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(LOOK_STORAGE_KEY, JSON.stringify(normalizeLook(look)))
  } catch {
    // quota or privacy mode: the look just will not persist
  }
}
