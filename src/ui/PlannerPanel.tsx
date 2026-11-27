import type { KeyboardEvent } from 'react'
import { STEP_PRESETS } from '../app/constants.ts'
import type { LocateStatus, PlanError, PlanPhase } from '../app/appState.ts'
import type { useNumberFields } from '../app/useNumberFields.ts'
import { MAX_STEPS, MIN_STEPS } from '../geo/steps.ts'
import { paceFor } from '../ghost/pacer.ts'
import { formatDecimal, formatKm, formatNumber } from '../i18n/format.ts'
import { useI18n } from '../i18n/index.ts'
import type { PlanResult, RouteMode } from '../routing/planner.ts'
import { FieldNote } from './FieldNote.tsx'
import { feasibility } from './feasibility.ts'
import { GhostNote } from './GhostNote.tsx'
import { LocateMessage } from './LocateMessage.tsx'
import { SLIDER_MAX, SLIDER_MIN, SLIDER_STEP, liveSteps, sliderValue } from './numberInput.ts'
import type { Settings } from './settings.ts'

export type NumberFields = ReturnType<typeof useNumberFields>

type Props = {
  settings: Settings
  placing: 'start' | 'end'
  hasEnd: boolean
  result: PlanResult | undefined
  planning: boolean
  planFailed: boolean
  planError?: PlanError
  /** What a running plan is doing, and how many map pieces are in (requirement 12.2). */
  planPhase?: PlanPhase
  planProgress?: { done: number; total: number }
  onRetryArea: () => void
  onUseSteps: (steps: number) => void
  /** The planner is folded down to the route line (phones, once a route is ready). */
  folded: boolean
  locate: LocateStatus
  simulate: boolean
  mapReady: boolean
  fields: NumberFields
  onMode: (mode: RouteMode) => void
  onPlace: (which: 'start' | 'end') => void
  onToggle: () => void
  onPlan: (reroll: boolean) => void
  onStart: () => void
}

const onEnter = (commit: () => number) => (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    commit()
  }
}

/** The framed planner of the Map tab: mode, goal, presets, and the plan and start buttons. */
export function PlannerPanel(p: Props) {
  const { t, locale } = useI18n()
  const { settings, fields, result } = p
  const stepRange = { min: formatNumber(MIN_STEPS, locale), max: formatNumber(MAX_STEPS, locale) }
  const ghostPace = paceFor(settings.strideM)
  const shownRoute = result?.ok ? result.route : result?.closest
  const format = (v: number) => formatNumber(v, locale)
  const note = feasibility(result, t, locale)
  const hint = !p.mapReady ? t('plan.hintMap') : settings.mode === 'oneway' && !p.hasEnd ? t('plan.hintEnd') : undefined
  return (
    <div className={`box planner-box ${p.folded ? 'folded' : ''}`} data-testid="planner">
      {result?.ok && (
        <button type="button" className="pix-btn small-text planner-toggle" aria-expanded={!p.folded} aria-controls="planner-edit" onClick={p.onToggle} data-testid="planner-toggle">
          <span className={`chev ${p.folded ? 'up' : 'down'}`} aria-hidden="true" /> {p.folded ? t('planner.edit') : t('planner.hide')}
        </button>
      )}
      <div className="planner-edit" id="planner-edit">
        <div className="planner-row">
          <div className="segmented small" role="radiogroup" aria-label={t('mode.label')}>
            {(['loop', 'oneway'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={settings.mode === m} className={`pix-btn ${settings.mode === m ? 'on' : ''}`} onClick={() => p.onMode(m)}>
                {t(m === 'loop' ? 'mode.loop' : 'mode.oneway')}
              </button>
            ))}
          </div>
          {settings.mode === 'oneway' && (
            <div className="segmented small" role="group" aria-label={t('place.label')}>
              {(['start', 'end'] as const).map((which) => (
                <button key={which} type="button" aria-pressed={p.placing === which} className={`pix-btn ${p.placing === which ? 'on' : ''}`} onClick={() => p.onPlace(which)}>
                  {t(which === 'start' ? 'place.start' : 'place.end')}
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          <span className="box-title">{t('target.label')}</span>
          <span className="input-row">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              name="steps"
              aria-invalid={fields.stepsOutOfRange || fields.stepsInvalid}
              aria-describedby="steps-note"
              value={fields.stepsText}
              onChange={(e) => fields.typeSteps(e.target.value)}
              onBlur={fields.commitStepsField}
              onKeyDown={onEnter(fields.commitStepsField)}
            />
            <span className="unit">{t('target.unit')}</span>
          </span>
        </label>
        <input
          type="range"
          className="pix-range"
          aria-label={t('target.slider')}
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          step={SLIDER_STEP}
          value={sliderValue(liveSteps(fields.stepsText) ?? settings.targetSteps)}
          onChange={(e) => fields.setSteps(Number(e.target.value))}
        />
        <FieldNote id="steps-note" note={fields.stepsNote} outOfRange={fields.stepsOutOfRange} invalid={fields.stepsInvalid} prefix="target" range={stepRange} format={format} />
        <div className="presets">
          {STEP_PRESETS.map((s) => (
            <button key={s} type="button" className={`pix-btn preset ${settings.targetSteps === s ? 'on' : ''}`} aria-pressed={settings.targetSteps === s} onClick={() => fields.setSteps(s)}>
              {s / 1000}k
            </button>
          ))}
        </div>
      </div>
      <LocateMessage status={p.locate} onRetry={p.onRetryArea} />
      {shownRoute && (
        <p className={`route-line ${result?.ok ? 'ok' : 'bad'}`} data-testid="route-line">
          {t('result.short', { km: formatKm(shownRoute.distanceM, locale), steps: formatNumber(shownRoute.steps, locale), n: shownRoute.steps })}
          {!result?.ok && <> · {t('result.title')} ▸</>}
          {result?.ok && p.simulate && <> · {t('bag.demo')}</>}
        </p>
      )}
      {result?.ok && (
        <p className="route-line ok" data-testid="ghost-pace">
          {t('result.ghostPace')}: {t('result.ghostPaceValue', { kmh: formatDecimal(ghostPace.kmh, locale, 1), spm: formatNumber(Math.round(ghostPace.stepsPerMin / 5) * 5, locale) })}
        </p>
      )}
      {p.planning && p.planPhase === 'streets' && (
        <p className="hint" role="status" data-testid="plan-progress">
          {p.planProgress && p.planProgress.total > 0 ? t('plan.streets', { done: p.planProgress.done, total: p.planProgress.total }) : t('plan.streetsStart')}
        </p>
      )}
      {p.planFailed && (
        <GhostNote role="alert" testId="plan-error">
          <p>{t(p.planError === 'streets' ? 'error.planStreets' : p.planError === 'timeout' ? 'error.planTimeout' : 'error.planFailed')}</p>
          <button type="button" className="pix-btn small-text" data-testid="plan-retry" onClick={() => p.onPlan(false)}>
            {t('action.retry')}
          </button>
        </GhostNote>
      )}
      {note && !note.ok && (
        <GhostNote role="status" testId="plan-note">
          <p>{note.text}</p>
          {note.suggest ? (
            <button type="button" className="pix-btn small-text" onClick={() => p.onUseSteps(note.suggest!)}>
              {t('action.useSteps', { steps: format(note.suggest) })}
            </button>
          ) : null}
        </GhostNote>
      )}
      {result?.ok && (
        <button type="button" className="pix-btn primary big start-btn" onClick={p.onStart}>
          ▶ {t('quest.start')}
        </button>
      )}
      {hint && !p.planning && (
        <p className="hint" role="status" data-testid="plan-hint">
          {hint}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className={`pix-btn ${result?.ok ? 'small-text' : 'primary big'}`}
          disabled={!p.mapReady || p.planning || (settings.mode === 'oneway' && !p.hasEnd)}
          aria-busy={p.planning}
          onClick={() => p.onPlan(false)}
        >
          {p.planning ? t('action.planning') : t('action.generate')}
        </button>
        {settings.mode === 'loop' && result && (
          <button type="button" className={`pix-btn ${result?.ok ? 'small-text' : ''}`} disabled={p.planning} onClick={() => p.onPlan(true)}>
            {t('action.reroll')}
          </button>
        )}
      </div>
    </div>
  )
}
