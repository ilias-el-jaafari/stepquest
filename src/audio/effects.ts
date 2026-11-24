import { applyOps, sfxEnvelope } from './automation.ts'
import { release, type Graph } from './graph.ts'
import { SFX, type SfxName, type SfxNote } from './sfx.ts'

/** Play a sound effect (a list of short notes, see `sfx.ts`) on the effects bus. */
export function playEffect(g: Graph, name: SfxName): void {
  const t0 = g.ctx.currentTime + 0.01
  for (const note of SFX[name]) playNote(g, note, t0)
}

function playNote(g: Graph, n: SfxNote, t0: number): void {
  const ctx = g.ctx
  const gain = ctx.createGain()
  const start = t0 + n.at
  const end = start + n.len
  applyOps(gain.gain, sfxEnvelope(0.22 * (n.gain ?? 1), start, end))
  gain.connect(g.sfx)
  if (n.wave === 'noise') {
    const src = ctx.createBufferSource()
    src.buffer = g.noise
    src.connect(gain)
    src.start(start)
    src.stop(end + 0.02)
    src.onended = () => release(src, gain)
    return
  }
  const osc = ctx.createOscillator()
  if (n.wave === 'triangle') osc.type = 'triangle'
  else osc.setPeriodicWave(g.waves.get(n.wave === 'pulse25' ? 'pulse250' : 'pulse500')!)
  osc.frequency.setValueAtTime(n.hz, start)
  if (n.slideTo) osc.frequency.linearRampToValueAtTime(n.slideTo, end)
  osc.connect(gain)
  osc.start(start)
  osc.stop(end + 0.02)
  osc.onended = () => release(osc, gain)
}
