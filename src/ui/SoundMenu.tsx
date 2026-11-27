import { useCallback, useId, useRef, useState } from 'react'
import { VOLUME_CHANNELS, type VolumeChannel } from '../audio/settings.ts'
import { useAudio } from '../audio/useAudio.ts'
import { useI18n } from '../i18n/index.ts'
import type { PlainKey } from '../i18n/en.ts'
import { PixelIcon } from './PixelIcons.tsx'
import { useDismiss } from './useDismiss.ts'

const LABELS: Record<VolumeChannel, PlainKey> = { master: 'sound.master', music: 'sound.music', voice: 'sound.voice', sfx: 'sound.sfx' }

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
  const { t } = useI18n()
  const { settings, engine } = useAudio()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root, opener)

  const off = settings.muted
  return (
    <div className={`sound-menu ${placement}`} ref={root}>
      <button
        type="button"
        className={`pix-btn sound-toggle ${showLabel ? '' : 'round'} ${off ? 'is-off' : ''}`}
        aria-expanded={open}
        ref={opener}
        aria-controls={open ? panelId : undefined}
        aria-label={off ? `${t('sound.button')}: ${t('sound.off')}` : t('sound.button')}
        data-testid="sound-button"
        onClick={() => {
          engine.unlock()
          setOpen((o) => !o)
        }}
      >
        <PixelIcon name={off ? 'soundOff' : 'soundOn'} />
        {showLabel && <span>{t('sound.button')}</span>}
      </button>
      {open && (
        <div className="sound-panel" id={panelId} role="group" aria-label={t('sound.title')} data-testid="sound-panel">
          <SoundControls onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** The sound settings themselves (mute, voice only, volumes, test), shown in the pop-up or inline in Settings. */
export function SoundControls({ onClose }: { onClose?: () => void }) {
  const { t, locale } = useI18n()
  const { settings, engine } = useAudio()
  return (
    <>
      <div className="sound-toggles">
        <label className="check">
          <input type="checkbox" checked={settings.muted} onChange={(e) => engine.updateSettings({ muted: e.target.checked })} />
          <span>{t('sound.mute')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.voiceOnly} disabled={settings.muted} onChange={(e) => engine.updateSettings({ voiceOnly: e.target.checked })} />
          <span>{t('sound.voiceOnly')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.chiptune} disabled={settings.muted || settings.voiceOnly} data-testid="chiptune-toggle" onChange={(e) => engine.updateSettings({ chiptune: e.target.checked })} />
          <span>{t('sound.chiptune')}</span>
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
          className="pix-btn"
          disabled={settings.muted}
          onClick={() => {
            engine.unlock()
            engine.playSfx('gem')
            engine.say(t('voice.test', { n: 3, total: 10 }), locale, 9)
          }}
        >
          {t('sound.test')}
        </button>
        {onClose && (
          <button type="button" className="pix-btn" onClick={onClose}>
            {t('sound.close')}
          </button>
        )}
      </div>
      <p className="sound-hint">{t('sound.hint')}</p>
    </>
  )
}
