import { useEffect, useState, type CSSProperties } from 'react'
import { BODIES, LOOK_PARTS, PALETTES, walkerFor, type LookPart } from '../hero/look.ts'
import { setLook, useLook } from '../hero/useLook.ts'
import { useI18n } from '../i18n/index.ts'
import type { Facing } from '../render/sprites.ts'
import { PixelSvg } from './PixelIcons.tsx'

const FRAME_MS = 180
/** Walk cycle per facing (stand, step, stand, other step), turning every two cycles. */
const TURNS: readonly Facing[] = ['down', 'left', 'up', 'right']
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The walker walking on the spot, turning now and then (still with reduced motion). */
export function WalkerPreview({ size }: { size: number }) {
  const { t } = useI18n()
  const look = useLook()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return
    const id = setInterval(() => setTick((n) => n + 1), FRAME_MS)
    return () => clearInterval(id)
  }, [])
  const facing = TURNS[Math.floor(tick / 8) % TURNS.length]!
  const frames = walkerFor(look)[facing]
  const frame = frames[[0, 1, 0, 2][tick % 4] ?? 0] ?? frames[0]!
  return (
    <span className="walker-preview" role="img" aria-label={t('look.preview')} data-testid="walker-preview" data-facing={facing}>
      <PixelSvg art={frame} size={size} />
    </span>
  )
}

const PART_KEY = {
  skin: 'look.skin',
  hair: 'look.hair',
  cap: 'look.cap',
  shirt: 'look.shirt',
  pants: 'look.pants',
} as const satisfies Record<LookPart, string>

/** Hero tab: dress the walker. Saved on the device; the map and header use it. */
export function HeroEditor() {
  const { t } = useI18n()
  const look = useLook()
  return (
    <div className="box look-box">
      <h2 className="box-title">{t('look.title')}</h2>
      <div className="look-stage">
        <WalkerPreview size={96} />
      </div>
      <div className="look-row">
        <span className="look-label" id="look-body">
          {t('look.body')}
        </span>
        <div className="segmented small" role="radiogroup" aria-labelledby="look-body">
          {BODIES.map((b) => (
            <button key={b} type="button" role="radio" aria-checked={look.body === b} className={`pix-btn ${look.body === b ? 'on' : ''}`} onClick={() => setLook({ ...look, body: b })}>
              {t(b === 'boy' ? 'look.boy' : 'look.girl')}
            </button>
          ))}
        </div>
      </div>
      {LOOK_PARTS.map((part) => (
        <div className="look-row" key={part}>
          <span className="look-label" id={`look-${part}`}>
            {t(PART_KEY[part])}
          </span>
          <div className="swatches" role="radiogroup" aria-labelledby={`look-${part}`} data-testid={`swatches-${part}`}>
            {PALETTES[part].map((color, i) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={look[part] === i}
                aria-label={t('look.swatch', { part: t(PART_KEY[part]), n: i + 1 })}
                className={`swatch ${look[part] === i ? 'on' : ''}`}
                style={{ '--swatch': color } as CSSProperties}
                onClick={() => setLook({ ...look, [part]: i })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
