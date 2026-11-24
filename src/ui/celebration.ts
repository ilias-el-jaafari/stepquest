/**
 * The pixel celebration of the summary screen: confetti and firework bursts (or, when calm,
 * a few slow twinkles) on a small pixel grid. Pure and seeded; the canvas drawing lives in SummaryScreen.
 */
import { rng } from '../town/random.ts'

export type Particle = { x: number; y: number; vx: number; vy: number; color: string; size: number; life: number; maxLife: number; gravity: number; kind: 'confetti' | 'spark' | 'star' }

export type Show = {
  w: number
  h: number
  calm: boolean
  t: number
  /** Time until the next firework, in ms. */
  nextBurst: number
  bursts: number
  particles: Particle[]
  random: () => number
}

export const MAX_PARTICLES = 220
/** Fireworks and new confetti stop after this long; the sky then empties. */
export const SHOW_MS = 6000
const MAX_BURSTS = 6

/** An original bright palette. */
export const COLORS = ['#ff4f6d', '#ffd84a', '#5eaf48', '#4fc3f7', '#c77dff', '#ff9f43', '#ffffff'] as const

const pick = <T,>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length]!

export function createShow(seed: number, w: number, h: number, calm: boolean): Show {
  const show: Show = { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)), calm, t: 0, nextBurst: 300, bursts: 0, particles: [], random: rng(seed) }
  if (calm) for (let i = 0; i < 14; i++) add(show, star(show, true))
  else for (let i = 0; i < 40; i++) add(show, confetti(show, true))
  return show
}

function add(show: Show, p: Particle): void {
  if (show.particles.length < MAX_PARTICLES) show.particles.push(p)
}

function confetti(show: Show, scatter: boolean): Particle {
  const r = show.random
  return {
    x: r() * show.w,
    y: scatter ? r() * show.h * 0.6 : -2,
    vx: (r() - 0.5) * 6,
    vy: 10 + r() * 14,
    color: pick(r, COLORS),
    size: r() < 0.3 ? 2 : 1,
    life: 0,
    maxLife: 5000,
    gravity: 0,
    kind: 'confetti',
  }
}

function star(show: Show, scatter: boolean): Particle {
  const r = show.random
  return { x: r() * show.w, y: scatter ? r() * show.h : -2, vx: 0, vy: 2 + r() * 3, color: r() < 0.5 ? '#ffd84a' : '#ffffff', size: 1, life: r() * 1200, maxLife: 4000 + r() * 2000, gravity: 0, kind: 'star' }
}

function burst(show: Show): void {
  const r = show.random
  const cx = show.w * (0.15 + r() * 0.7)
  const cy = show.h * (0.1 + r() * 0.35)
  const colors = [pick(r, COLORS), pick(r, COLORS)]
  const n = 26
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.2
    const speed = 14 + r() * 12
    add(show, { x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, color: colors[i % 2]!, size: 1, life: 0, maxLife: 900 + r() * 500, gravity: 22, kind: 'spark' })
  }
}

/** Move the show on by `dtMs` (at most 100 ms per call; longer steps are split). */
export function stepShow(show: Show, dtMs: number): void {
  let left = Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0
  while (left > 0) {
    const d = Math.min(100, left)
    left -= d
    tick(show, d)
  }
}

function tick(show: Show, d: number): void {
  const s = d / 1000
  show.t += d
  const active = show.t < SHOW_MS
  if (active) {
    if (show.calm) {
      if (show.random() < d / 500) add(show, star(show, false))
    } else {
      show.nextBurst -= d
      if (show.nextBurst <= 0 && show.bursts < MAX_BURSTS) {
        burst(show)
        show.bursts++
        show.nextBurst = 700 + show.random() * 500
      }
      // About 18 new confetti pieces a second.
      if (show.random() < d / 55) add(show, confetti(show, false))
    }
  }
  for (const p of show.particles) {
    p.life += d
    p.vy += p.gravity * s
    p.x += p.vx * s
    p.y += p.vy * s
    // Confetti sways as it falls.
    if (p.kind === 'confetti') p.x += Math.sin((p.life + p.y * 40) / 260) * 0.25
  }
  show.particles = show.particles.filter((p) => p.life < p.maxLife && p.y < show.h + 3 && p.x > -4 && p.x < show.w + 4)
}

/** Whether anything is left to draw or still to appear. */
export function showIsOver(show: Show): boolean {
  return show.t >= SHOW_MS && show.particles.length === 0
}

/** The pixels to paint now (integer cells, colour, fade 0 to 1). */
export function showPixels(show: Show): { x: number; y: number; size: number; color: string; alpha: number }[] {
  const out: { x: number; y: number; size: number; color: string; alpha: number }[] = []
  for (const p of show.particles) {
    const left = 1 - p.life / p.maxLife
    let alpha = p.kind === 'spark' ? Math.min(1, left * 2) : 1
    // Twinkle: stars blink in steps.
    if (p.kind === 'star') alpha = Math.floor(p.life / 300) % 2 === 0 ? 1 : 0.35
    out.push({ x: Math.round(p.x), y: Math.round(p.y), size: p.size, color: p.color, alpha })
  }
  return out
}
