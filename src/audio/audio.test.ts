import { describe, expect, it } from 'vitest'
import { BARS_PER_SONG, calmEvents, eventsAt, nextBarStep, MAJOR, makeSong, midiToHz, scaleNote, STEPS_PER_BAR, STEPS_PER_SONG, triad } from './chiptune.ts'
import { lookaheadFor, scheduleWindow, stepSeconds } from './scheduler.ts'
import { AUDIO_STORAGE_KEY, busGains, clampVolume, DEFAULT_AUDIO, LEGACY_MUTE_KEY, loadAudioSettings, sanitizeAudio, saveAudioSettings, sliderToGain } from './settings.ts'
import { FINISH, GEM, GEM_LAST, sfxDuration, SFX } from './sfx.ts'
import { cadence, glideTempo, isStale, MAX_BPM, MENU_BPM, MIN_BPM, PaceTracker, sanitizeBpm, tempoForSpeed } from './tempo.ts'
import { monotonicNow, VoiceQueue } from './voiceQueue.ts'

class MemStore {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

describe('audio settings', () => {
  it('starts from sensible defaults', () => {
    expect(loadAudioSettings(new MemStore())).toEqual(DEFAULT_AUDIO)
    expect(loadAudioSettings(undefined)).toEqual(DEFAULT_AUDIO)
  })

  it('persists and reloads every field', () => {
    const store = new MemStore()
    const s = { master: 0.55, music: 0.2, voice: 1, sfx: 0, muted: true, voiceOnly: true }
    expect(saveAudioSettings(s, store)).toBe(true)
    expect(JSON.parse(store.getItem(AUDIO_STORAGE_KEY)!)).toEqual(s)
    expect(loadAudioSettings(store)).toEqual(s)
  })

  it('repairs bad stored values instead of failing', () => {
    const store = new MemStore()
    store.setItem(AUDIO_STORAGE_KEY, '{not json')
    expect(loadAudioSettings(store)).toEqual(DEFAULT_AUDIO)
    expect(sanitizeAudio({ master: 7, music: -1, voice: 'x', sfx: '0.333', muted: 'yes' })).toEqual({ ...DEFAULT_AUDIO, master: 1, music: 0, sfx: 0.33 })
    expect(sanitizeAudio(null)).toEqual(DEFAULT_AUDIO)
    expect(clampVolume(NaN, 0.4)).toBe(0.4)
  })

  it('migrates the old "sound off" flag once', () => {
    const store = new MemStore()
    store.setItem(LEGACY_MUTE_KEY, '1')
    expect(loadAudioSettings(store).muted).toBe(true)
    saveAudioSettings(loadAudioSettings(store), store)
    expect(store.getItem(LEGACY_MUTE_KEY)).toBeNull()
  })

  it('maps settings to bus gains: mute silences all, voice-only keeps the voice', () => {
    expect(busGains({ ...DEFAULT_AUDIO, muted: true })).toEqual({ master: 0, music: 0, voice: 0, sfx: 0 })
    expect(busGains({ ...DEFAULT_AUDIO, voiceOnly: true })).toEqual({ master: DEFAULT_AUDIO.master, music: 0, voice: DEFAULT_AUDIO.voice, sfx: 0 })
    expect(busGains(DEFAULT_AUDIO).music).toBe(DEFAULT_AUDIO.music)
    expect(sliderToGain(0)).toBe(0)
    expect(sliderToGain(1)).toBe(1)
    expect(sliderToGain(0.5)).toBeLessThan(0.5)
    expect(sliderToGain(0.6)).toBeGreaterThan(sliderToGain(0.5))
  })
})

describe('tempo from walking pace', () => {
  it('uses one beat per step', () => {
    expect(cadence(1.3, 0.75)).toBeCloseTo(104, 0)
    expect(tempoForSpeed(1.3, 0.75)).toBe(104)
    expect(tempoForSpeed(1.6, 0.75)).toBe(128)
  })

  it('pauses when standing still and clamps very slow or very fast paces', () => {
    expect(tempoForSpeed(0, 0.75)).toBeUndefined()
    expect(tempoForSpeed(0.2, 0.75)).toBeUndefined()
    expect(tempoForSpeed(NaN, 0.75)).toBeUndefined()
    expect(tempoForSpeed(0.5, 0.75)).toBe(MIN_BPM)
    expect(tempoForSpeed(4, 0.75)).toBe(MAX_BPM)
  })

  it('glides smoothly towards the target without overshooting', () => {
    let bpm = 90
    const seen: number[] = []
    for (let i = 0; i < 400; i++) {
      const next = glideTempo(bpm, 130, 0.05)
      expect(next - bpm).toBeLessThanOrEqual(12 * 0.05 + 1e-9) // at most 12 BPM per second
      expect(next).toBeGreaterThanOrEqual(bpm)
      bpm = next
      seen.push(bpm)
    }
    expect(bpm).toBe(130)
    expect(Math.max(...seen)).toBeLessThanOrEqual(130)
    expect(glideTempo(120, 100, 0)).toBe(120)
    expect(glideTempo(120, 100, 1)).toBeLessThan(120)
  })

  it('measures speed over a window of fix times', () => {
    const p = new PaceTracker(10_000)
    expect(p.speed()).toBe(0)
    for (let i = 0; i <= 20; i++) p.push(i * 1.5, 1_000_000 + i * 1000)
    expect(p.speed()).toBeCloseTo(1.5, 5)
    // Standing still: the odometer stops, the window slides, speed drops to 0.
    for (let i = 21; i <= 40; i++) p.push(30, 1_000_000 + i * 1000)
    expect(p.speed()).toBe(0)
    // Out-of-order fixes are ignored.
    p.push(999, 1_000_000)
    expect(p.speed()).toBe(0)
    p.reset()
    expect(p.speed()).toBe(0)
  })

  it('treats a long gap between fixes as stopped', () => {
    expect(isStale(undefined, 0)).toBe(true)
    expect(isStale(1000, 5000)).toBe(false)
    expect(isStale(1000, 12_000)).toBe(true)
  })
})

describe('music scheduler', () => {
  it('schedules contiguous sixteenth notes inside the look-ahead window', () => {
    expect(stepSeconds(120)).toBeCloseTo(0.125)
    const { steps, state } = scheduleWindow({ nextTime: 1, step: 0 }, 1, 0.3, 120)
    expect(steps.map((s) => s.step)).toEqual([0, 1, 2])
    steps.forEach((s, i) => expect(s.time).toBeCloseTo(1 + i * 0.125))
    expect(state).toEqual({ nextTime: 1.375, step: 3 })
    // Nothing new until time moves on.
    expect(scheduleWindow(state, 1, 0.3, 120).steps).toHaveLength(0)
  })

  it('jumps forward after a stall instead of playing every missed note', () => {
    const { steps } = scheduleWindow({ nextTime: 1, step: 10 }, 50, 0.1, 120)
    expect(steps.length).toBeLessThanOrEqual(1)
    expect(steps[0]!.step).toBe(10)
    expect(steps[0]!.time).toBeGreaterThanOrEqual(50)
  })

  it('lets the tempo change from step to step', () => {
    const { steps } = scheduleWindow({ nextTime: 0, step: 0 }, 0, 1, (step) => (step < 2 ? 60 : 120))
    expect(steps[1]!.time - steps[0]!.time).toBeCloseTo(0.25)
    expect(steps[3]!.time - steps[2]!.time).toBeCloseTo(0.125)
    expect(scheduleWindow({ nextTime: 0, step: 0 }, 0, 1000, 120).steps.length).toBe(64)
  })
})

describe('procedural chiptune', () => {
  const inScale = (root: number, midi: number) => MAJOR.includes(((((midi - root) % 12) + 12) % 12) as (typeof MAJOR)[number])

  it('is deterministic per seed and varies between seeds', () => {
    expect(makeSong(7)).toEqual(makeSong(7))
    expect(JSON.stringify(makeSong(7).steps)).not.toBe(JSON.stringify(makeSong(8).steps))
  })

  it('keeps every note in the key and in a playable range', () => {
    for (let seed = 0; seed < 20; seed++) {
      const song = makeSong(seed)
      expect(song.chords).toHaveLength(BARS_PER_SONG)
      expect(song.steps).toHaveLength(STEPS_PER_SONG)
      for (const ev of song.steps) {
        for (const n of [ev.lead, ev.arp, ev.bass]) {
          if (!n) continue
          expect(inScale(song.root, n.midi), `seed ${seed} midi ${n.midi}`).toBe(true)
          expect(n.midi).toBeGreaterThanOrEqual(28)
          expect(n.midi).toBeLessThanOrEqual(96)
          expect(n.steps).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  it('puts chord tones on the strong beats and the chord root in the bass', () => {
    for (let seed = 0; seed < 10; seed++) {
      const song = makeSong(seed)
      song.chords.forEach((degree, bar) => {
        const tones = triad(degree).map((d) => scaleNote(song.root, d) % 12)
        const base = bar * STEPS_PER_BAR
        const downbeat = song.steps[base]!
        expect(downbeat.drum).toBe('kick')
        expect(downbeat.bass!.midi % 12).toBe(scaleNote(song.root, degree) % 12)
        const lead = song.steps[base]!.lead
        if (lead && bar !== BARS_PER_SONG - 1) expect(tones).toContain(lead.midi % 12)
        expect(song.steps[base + 4]!.drum).toBe('snare')
      })
      // The last bar resolves on the tonic.
      const lastLead = song.steps.slice(-8).find((s) => s.lead)?.lead
      if (lastLead) expect(lastLead.midi % 12).toBe(song.root % 12)
    }
  })

  it('plays one song after another with a new seed each time', () => {
    expect(eventsAt(3, 5)).toEqual(makeSong(3).steps[5])
    expect(eventsAt(3, STEPS_PER_SONG + 5)).toEqual(makeSong(4).steps[5])
    expect(midiToHz(69)).toBe(440)
    expect(midiToHz(81)).toBeCloseTo(880)
  })
})

describe('sound effects', () => {
  it('are short, and the finish jingle is the longest', () => {
    for (const [name, notes] of Object.entries(SFX)) {
      // The button click is a tick, everything else a little tune.
      if (name === 'click') expect(sfxDuration(notes)).toBeLessThan(0.05)
      else expect(sfxDuration(notes)).toBeGreaterThan(0.1)
      expect(sfxDuration(notes)).toBeLessThan(2)
      for (const n of notes) expect(n.len).toBeGreaterThan(0)
    }
    expect(sfxDuration(FINISH)).toBeGreaterThan(sfxDuration(GEM))
    expect(sfxDuration(GEM_LAST)).toBeGreaterThan(sfxDuration(GEM))
  })
})

describe('voice queue', () => {
  it('plays one phrase at a time and queues the rest by priority', () => {
    const q = new VoiceQueue(2, 5000)
    expect(q.push({ text: 'a', locale: 'en', priority: 1, at: 0 })).toBe('play')
    expect(q.push({ text: 'a', locale: 'en', priority: 1, at: 1 })).toBe('dropped') // same text while it plays
    expect(q.push({ text: 'b', locale: 'en', priority: 1, at: 2 })).toBe('queued')
    expect(q.push({ text: 'c', locale: 'en', priority: 2, at: 3 })).toBe('queued')
    expect(q.push({ text: 'd', locale: 'en', priority: 1, at: 4 })).toBe('dropped') // queue full, least important
    expect(q.next(100)?.text).toBe('c')
    expect(q.next(200)?.text).toBe('b')
    expect(q.next(300)).toBeUndefined()
  })

  it('lets urgent phrases cut in and drops stale ones', () => {
    const q = new VoiceQueue(3, 5000)
    q.push({ text: 'turn', locale: 'en', priority: 2, at: 0 })
    q.push({ text: 'halfway', locale: 'en', priority: 1, at: 0 })
    expect(q.push({ text: 'finish', locale: 'en', priority: 5, at: 10 })).toBe('interrupt')
    expect(q.playing?.text).toBe('finish')
    expect(q.size).toBe(0)
    q.push({ text: 'old', locale: 'en', priority: 1, at: 0 })
    expect(q.next(60_000)).toBeUndefined()
  })
})

describe('planning-screen music', () => {
  it('switches tunes only on a bar line', () => {
    expect(nextBarStep(0)).toBe(0)
    expect(nextBarStep(1)).toBe(STEPS_PER_BAR)
    expect(nextBarStep(STEPS_PER_BAR)).toBe(STEPS_PER_BAR)
    expect(nextBarStep(STEPS_PER_BAR * 3 + 5)).toBe(STEPS_PER_BAR * 4)
  })

  it('keeps only melody, bass and a soft kick in the calm arrangement', () => {
    let kicks = 0
    let leads = 0
    for (let step = 0; step < STEPS_PER_SONG; step++) {
      const raw = eventsAt(7, step)
      const calm = calmEvents(raw)
      expect(calm.arp).toBeUndefined()
      expect(calm.drum === undefined || calm.drum === 'kick').toBe(true)
      expect(calm.lead).toEqual(raw.lead)
      expect(calm.bass).toEqual(raw.bass)
      if (calm.drum) kicks++
      if (calm.lead) leads++
    }
    expect(kicks).toBeGreaterThan(0)
    expect(leads).toBeGreaterThan(0)
  })

  it('uses a calm tempo at the slow end of the walking range', () => {
    expect(MENU_BPM).toBeLessThanOrEqual(MIN_BPM)
    expect(MENU_BPM).toBeGreaterThanOrEqual(60)
  })
})

describe('review Nov 2026: regressions', () => {
  it('B17: a non-finite tempo never reaches the scheduler or kills the clock', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0, -5]) {
      expect(Number.isFinite(stepSeconds(bad)), String(bad)).toBe(true)
      const { steps, state } = scheduleWindow({ nextTime: 0, step: 0 }, 0, 0.5, bad)
      expect(steps.length).toBeGreaterThan(0)
      expect(Number.isFinite(state.nextTime)).toBe(true)
    }
    // A poisoned clock recovers instead of staying NaN for ever.
    const { steps, state } = scheduleWindow({ nextTime: NaN, step: 4 }, 2, 0.3, 120)
    expect(steps.length).toBeGreaterThan(0)
    expect(Number.isFinite(state.nextTime)).toBe(true)
    expect(sanitizeBpm(NaN)).toBeUndefined()
    expect(sanitizeBpm('120')).toBeUndefined()
    expect(sanitizeBpm(1e9)).toBe(300)
    expect(sanitizeBpm(-4)).toBe(1)
    expect(glideTempo(NaN, 120, 0.1)).toBe(120)
    expect(glideTempo(100, NaN, 0.1)).toBe(100)
    expect(glideTempo(NaN, NaN, 0.1)).toBe(MENU_BPM)
    expect(glideTempo(100, 140, Infinity)).toBeLessThanOrEqual(140)
    expect(tempoForSpeed(Infinity, 0.75)).toBe(MAX_BPM)
    expect(tempoForSpeed(1.3, 0)).toBe(MIN_BPM)
  })

  it('B21: a hidden tab schedules at least a second and a half ahead', () => {
    expect(lookaheadFor(true)).toBeGreaterThanOrEqual(1.5)
    expect(lookaheadFor(false)).toBeLessThan(0.5)
    // At the fastest tempo that window holds a sensible number of steps.
    const { steps } = scheduleWindow({ nextTime: 0, step: 0 }, 0, lookaheadFor(true), MAX_BPM)
    expect(steps.length).toBeGreaterThan(10)
    expect(steps.length).toBeLessThan(64)
  })

  it('B18: the last bar holds one tonic, not several overlapping copies', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const song = makeSong(seed)
      const lastBar = song.steps.slice(song.steps.length - STEPS_PER_BAR)
      const held = lastBar.map((e, i) => ({ i, lead: e.lead })).filter((x) => x.lead && x.i >= 8)
      expect(held.length, `seed ${seed}`).toBeLessThanOrEqual(1)
      for (const h of held) {
        expect(h.lead!.midi).toBe(scaleNote(song.root, 7))
        expect(h.i + h.lead!.steps).toBe(STEPS_PER_BAR) // holds to the end of the song
      }
    }
  })

  it('B9, B19, B20: phrases carry their language, use a monotonic clock and may not be blank', () => {
    const q = new VoiceQueue(3, 1000)
    expect(q.push({ text: '', locale: 'en', priority: 1, at: 0 })).toBe('dropped')
    expect(q.push({ text: '  \n', locale: 'es', priority: 1, at: 0 })).toBe('dropped')
    expect(q.playing).toBeUndefined()
    expect(q.push({ text: 'Sí', locale: 'es', priority: 1, at: 0 })).toBe('play')
    expect(q.push({ text: 'wait', locale: 'en', priority: 1, at: 0 })).toBe('queued')
    expect(q.waiting[0]!.locale).toBe('en')
    expect(q.next(10)?.locale).toBe('en')
    // The same words in another language are another phrase.
    expect(q.push({ text: 'wait', locale: 'es', priority: 1, at: 0 })).toBe('queued')
    const a = monotonicNow()
    const b = monotonicNow()
    expect(b).toBeGreaterThanOrEqual(a)
    expect(a).toBeLessThan(Date.now()) // not the wall clock (performance.now counts from page start)
  })

  it('B24: an urgent repeat of a phrase that waits at low priority is not lost', () => {
    const q = new VoiceQueue(3, 10_000)
    q.push({ text: 'playing', locale: 'en', priority: 1, at: 0 })
    q.push({ text: 'turn', locale: 'en', priority: 1, at: 1 })
    expect(q.push({ text: 'turn', locale: 'en', priority: 3, at: 2 })).toBe('interrupt')
    expect(q.playing?.text).toBe('turn')
    expect(q.waiting).toHaveLength(0)
    // Waiting twins: the more important one stays, once.
    const r = new VoiceQueue(3, 10_000)
    r.push({ text: 'playing', locale: 'en', priority: 2, at: 0 })
    r.push({ text: 'x', locale: 'en', priority: 1, at: 1 })
    expect(r.push({ text: 'x', locale: 'en', priority: 2, at: 2 })).toBe('queued')
    expect(r.push({ text: 'x', locale: 'en', priority: 1, at: 3 })).toBe('dropped')
    expect(r.waiting.map((p) => p.priority)).toEqual([2])
  })

  it('keeps the oldest of equal priority first and never starves a phrase in the queue', () => {
    const q = new VoiceQueue(3, 10_000)
    q.push({ text: 'playing', locale: 'en', priority: 1, at: 0 })
    q.push({ text: 'low', locale: 'en', priority: 1, at: 1 })
    q.push({ text: 'turn a', locale: 'en', priority: 2, at: 2 })
    q.push({ text: 'turn b', locale: 'en', priority: 2, at: 3 })
    expect(q.next(10)?.text).toBe('turn a')
    expect(q.next(11)?.text).toBe('turn b')
    expect(q.next(12)?.text).toBe('low')
  })
})
