import { APP_SLUG } from '../config/brand.ts'

/** Sound settings, persisted on the device. Volumes are 0…1. */
export type AudioSettings = {
  master: number
  music: number
  voice: number
  sfx: number
  muted: boolean
  /** Only the spoken callouts: no music and no sound effects. */
  voiceOnly: boolean
  /** "Chiptune music": the loop and the menu tune. It only matters while sound is on; the jingles are not affected. */
  chiptune: boolean
}

export const AUDIO_STORAGE_KEY = `${APP_SLUG}.audio`
/** The Phase 2 mute flag, migrated into the new settings once. */
export const LEGACY_MUTE_KEY = `${APP_SLUG}.muted`

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, music: 0.8, voice: 0.9, sfx: 0.7, muted: false, voiceOnly: false, chiptune: true }

export const VOLUME_CHANNELS = ['master', 'music', 'voice', 'sfx'] as const
export type VolumeChannel = (typeof VOLUME_CHANNELS)[number]

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Clamp to 0…1 and round to whole percent; anything that is not a number falls back. */
export function clampVolume(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
}

/** Turn whatever was stored (old versions, hand edits, garbage) into valid settings. */
export function sanitizeAudio(raw: unknown): AudioSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    master: clampVolume(o.master, DEFAULT_AUDIO.master),
    music: clampVolume(o.music, DEFAULT_AUDIO.music),
    voice: clampVolume(o.voice, DEFAULT_AUDIO.voice),
    sfx: clampVolume(o.sfx, DEFAULT_AUDIO.sfx),
    muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_AUDIO.muted,
    voiceOnly: typeof o.voiceOnly === 'boolean' ? o.voiceOnly : DEFAULT_AUDIO.voiceOnly,
    chiptune: typeof o.chiptune === 'boolean' ? o.chiptune : DEFAULT_AUDIO.chiptune,
  }
}

export function loadAudioSettings(store: StorageLike | undefined = storage()): AudioSettings {
  if (!store) return { ...DEFAULT_AUDIO }
  try {
    const raw = store.getItem(AUDIO_STORAGE_KEY)
    if (raw) return sanitizeAudio(JSON.parse(raw))
    // First run after the update: carry over the old "sound off" button.
    const legacy = store.getItem(LEGACY_MUTE_KEY)
    return { ...DEFAULT_AUDIO, muted: legacy === '1' }
  } catch {
    return { ...DEFAULT_AUDIO }
  }
}

export function saveAudioSettings(s: AudioSettings, store: StorageLike | undefined = storage()): boolean {
  if (!store) return false
  try {
    store.setItem(AUDIO_STORAGE_KEY, JSON.stringify(sanitizeAudio(s)))
    store.removeItem(LEGACY_MUTE_KEY)
    return true
  } catch {
    return false
  }
}

/** The gain each bus should have (master is applied separately). */
export function busGains(s: AudioSettings): { master: number; music: number; voice: number; sfx: number } {
  if (s.muted) return { master: 0, music: 0, voice: 0, sfx: 0 }
  return {
    master: s.master,
    music: s.voiceOnly || !s.chiptune ? 0 : s.music,
    voice: s.voice,
    sfx: s.voiceOnly ? 0 : s.sfx,
  }
}

/** Whether the music can be heard at all: sound on, not "voice only", "Chiptune music" on and a volume above zero. */
export function musicAudible(s: AudioSettings): boolean {
  return busGains(s).music > 0 && busGains(s).master > 0
}

/** Perceived loudness is roughly logarithmic: map a 0…1 slider to a gain with a gentle curve. */
export function sliderToGain(v: number): number {
  const c = Math.min(1, Math.max(0, v))
  return c * c
}
