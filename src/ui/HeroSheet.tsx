import type { KeyboardEvent } from 'react'
import type { Sprite } from '../render/sprites.ts'
import { formatKm, formatNumber } from '../i18n/format.ts'
import { useI18n } from '../i18n/index.ts'
import { MAX_STRIDE_M, MIN_STRIDE_M, stepsToMetres } from '../geo/steps.ts'
import { FieldNote } from './FieldNote.tsx'
import { HeroEditor } from './HeroEditor.tsx'
import { PixelSvg } from './PixelIcons.tsx'
import type { NumberFields } from './PlannerPanel.tsx'
import { StepMeter } from './StepMeter.tsx'

type Props = {
  /** The walker's standing frame. */
  art: Sprite
  todaySteps: number
  targetSteps: number
  strideM: number
  fields: NumberFields
}

const onEnter = (commit: () => number) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    commit()
  }
}

/** Hero tab: the walker, today's steps against the goal, the look editor and the stride. */
export function HeroContent({ art, todaySteps, targetSteps, strideM, fields }: Props) {
  const { t, locale } = useI18n()
  const todayPct = Math.min(100, Math.round((todaySteps / Math.max(1, targetSteps)) * 100))
  const n = (v: number) => formatNumber(v, locale)
  const strideRange = { min: n(MIN_STRIDE_M), max: n(MAX_STRIDE_M) }
  const km = formatKm(stepsToMetres(targetSteps, strideM), locale)
  return (
    <>
      <div className="box hero-box">
        <div className="hero-head">
          <span className="avatar big" aria-hidden="true">
            <PixelSvg art={art} size={64} />
          </span>
          <div>
            <h2 className="box-title">{t('hero.title')}</h2>
            <p className="hero-today">
              {t('hero.today')}: <strong>{n(todaySteps)}</strong>
            </p>
            <p className="hint">{t('hero.goal', { goal: n(targetSteps) })}</p>
          </div>
        </div>
        <StepMeter pct={todayPct} label={t('hero.progress', { pct: todayPct })} />
        <p className="hint">{t('hero.progress', { pct: todayPct })}</p>
        <p className="hint">{t('hero.note')}</p>
      </div>
      <HeroEditor />
      <div className="box">
        <label className="field">
          <span className="box-title">{t('stride.label')}</span>
          <span className="input-row">
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              name="stride"
              aria-invalid={fields.strideOutOfRange || fields.strideInvalid}
              aria-describedby="stride-note"
              value={fields.strideText}
              onChange={(e) => fields.typeStride(e.target.value)}
              onBlur={fields.commitStrideField}
              onKeyDown={onEnter(fields.commitStrideField)}
            />
            <span className="unit">{t('stride.unit')}</span>
          </span>
        </label>
        <FieldNote id="stride-note" note={fields.strideNote} outOfRange={fields.strideOutOfRange} invalid={fields.strideInvalid} prefix="stride" range={strideRange} format={n} />
        <p className="hint" data-testid="km-hint">
          {t('stride.hint', { steps: n(targetSteps), km })}
        </p>
      </div>
    </>
  )
}
