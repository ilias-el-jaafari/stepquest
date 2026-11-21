import { useEffect, useId, useRef, useState } from 'react'
import { VOLUME_CHANNELS, type VolumeChannel } from '../audio/settings.ts'
import { useAudio } from '../audio/useAudio.ts'
import { useI18n } from '../i18n/index.ts'
import type { MessageKey } from '../i18n/en.ts'

const LABELS: Record<VolumeChannel, MessageKey> = { master: 'sound.master', music: 'sound.music', voice: 'sound.voice', sfx: 'sound.sfx' }

/** Pixel speaker icon (original, drawn with rectangles). Waves hidden when muted. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="speaker" viewBox="0 0 12 10" width="18" height="15" aria-hidden="true" shapeRendering="crispEdges">
      <rect x="0" y="3" width="3" height="4" fill="currentColor" />
      <rect x="3" y="2" width="1" height="6" fill="currentColor" />
      <rect x="4" y="1" width="1" height="8" fill="currentColor" />
      <rect x="5" y="0" width="1" height="10" fill="currentColor" />
      {muted ? (
        <>
          <rect x="7" y="3" width="1" height="1" fill="currentColor" />
          <rect x="8" y="4" width="1" height="1" fill="currentColor" />
          <rect x="9" y="5" width="1" height="1" fill="currentColor" />
          <rect x="10" y="6" width="1" height="1" fill="currentColor" />
          <rect x="10" y="3" width="1" height="1" fill="currentColor" />
          <rect x="9" y="4" width="1" height="1" fill="currentColor" />
          <rect x="8" y="5" width="1" height="1" fill="currentColor" />
          <rect x="7" y="6" width="1" height="1" fill="currentColor" />
        </>
      ) : (
        <>
          <rect x="7" y="4" width="1" height="2" fill="currentColor" />
          <rect x="8" y="2" width="1" height="1" fill="currentColor" />
          <rect x="9" y="3" width="1" height="4" fill="currentColor" />
          <rect x="8" y="7" width="1" height="1" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

type Props = {
  /** Open the panel above the button (bottom bars) or below it (top bars). */
  placement?: 'up' | 'down'
  /** Show the button text next to the icon. */
  showLabel?: boolean
}

/**
 * Compact sound control: one button that opens a small panel with mute,
 * voice-only, four volume sliders and a voice test. Self-contained, so it can
 * move into an options menu later.
 */
export function SoundMenu({ placement = 'down', showLabel = true }: Props) {
  const { t, locale } = useI18n()
  const { settings, engine } = useAudio()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const off = settings.muted
  return (
    <div className={`sound-menu ${placement}`} ref={root}>
      <button
        type="button"
        className={`pix-btn small-text sound-toggle ${off ? 'is-off' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={off ? `${t('sound.button')}: ${t('sound.off')}` : t('sound.button')}
        data-testid="sound-button"
        onClick={() => {
          engine.unlock()
          setOpen((o) => !o)
        }}
      >
        <SpeakerIcon muted={off} />
        {showLabel && <span>{t('sound.button')}</span>}
      </button>
      {open && (
        <div className="sound-panel" id={panelId} role="group" aria-label={t('sound.title')} data-testid="sound-panel">
          <div className="sound-toggles">
            <label className="check">
              <input type="checkbox" checked={settings.muted} onChange={(e) => engine.updateSettings({ muted: e.target.checked })} />
              <span>{t('sound.mute')}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.voiceOnly} disabled={settings.muted} onChange={(e) => engine.updateSettings({ voiceOnly: e.target.checked })} />
              <span>{t('sound.voiceOnly')}</span>
            </label>
          </div>
          {VOLUME_CHANNELS.map((ch) => {
            const disabled = settings.muted || (settings.voiceOnly && (ch === 'music' || ch === 'sfx'))
            const value = Math.round(settings[ch] * 100)
            return (
              <label key={ch} className={`sound-slider ${disabled ? 'disabled' : ''}`}>
                <span className="sound-label">{t(LABELS[ch])}</span>
                <input
                  type="range"
                  className="pix-range"
                  min={0}
                  max={100}
                  step={5}
                  value={value}
                  disabled={disabled}
                  aria-valuetext={`${value} %`}
                  data-testid={`volume-${ch}`}
                  onChange={(e) => engine.updateSettings({ [ch]: Number(e.target.value) / 100 })}
                />
                <span className="sound-value">{value}</span>
              </label>
            )
          })}
          <div className="sound-actions">
            <button
              type="button"
              className="pix-btn small-text"
              disabled={settings.muted}
              onClick={() => {
                engine.unlock()
                engine.playSfx('gem')
                engine.say(t('voice.test', { n: 3, total: 10 }), locale, 9)
              }}
            >
              {t('sound.test')}
            </button>
            <button type="button" className="pix-btn small-text" onClick={() => setOpen(false)}>
              {t('sound.close')}
            </button>
          </div>
          <p className="sound-hint">{t('sound.hint')}</p>
        </div>
      )}
    </div>
  )
}
