import { SIM_SPEEDS } from '../app/constants.ts'
import type { LocateStatus } from '../app/appState.ts'
import type { LatLon } from '../geo/geo.ts'
import { formatCoord } from '../geo/coords.ts'
import { useI18n } from '../i18n/index.ts'
import type { PlanResult, RouteMode } from '../routing/planner.ts'
import type { SafePlan } from '../routing/safePlanner.ts'
import { AvoidStreetsBox } from './AvoidStreetsBox.tsx'
import { LocateMessage } from './LocateMessage.tsx'
import { ResultBox } from './ResultBox.tsx'
import { SafetyNotice } from './SafetyNotice.tsx'

export type SimOptions = { simulate: boolean; speed: number; noise: boolean }

type Props = {
  result: PlanResult | undefined
  safePlan: SafePlan | undefined
  usingNormal: boolean
  sim: SimOptions
  mode: RouteMode
  start: LatLon
  end: LatLon | undefined
  isDemo: boolean
  locate: LocateStatus
  avoid: readonly string[]
  streets: readonly string[]
  picking: boolean
  pickNote: { ok: boolean; name?: string } | undefined
  onUseSteps: (steps: number) => void
  onUseNormal: () => void
  onSim: (patch: Partial<SimOptions>) => void
  onLocate: () => void
  onResetPoints: () => void
  onAvoid: (name: string) => void
  onUnavoid: (name: string) => void
  onPick: (on: boolean) => void
}

/** Bag tab: the quest log, the demo (simulated walk) options, the start point and the streets to avoid. */
export function BagContent(p: Props) {
  const { t } = useI18n()
  const locating = p.locate.state === 'locating' || p.locate.state === 'loadingArea'
  return (
    <>
      <ResultBox result={p.result} onUseSteps={p.onUseSteps} />
      {p.safePlan && p.result && <SafetyNotice plan={p.safePlan} usingNormal={p.usingNormal} onUseNormal={p.onUseNormal} />}
      <div className="box quest-start">
        <h2 className="box-title">{t('bag.demo')}</h2>
        <p className="hint">{t('quest.simulateHint')}</p>
        <label className="check">
          <input type="checkbox" checked={p.sim.simulate} onChange={(e) => p.onSim({ simulate: e.target.checked })} />
          <span>{t('quest.simulate')}</span>
        </label>
        {p.sim.simulate && (
          <div className="sim-options">
            <label className="field inline">
              <span className="hint">{t('quest.simSpeed')}</span>
              <select value={p.sim.speed} onChange={(e) => p.onSim({ speed: Number(e.target.value) })} aria-label={t('quest.simSpeed')}>
                {SIM_SPEEDS.map((x) => (
                  <option key={x} value={x}>
                    {t('quest.simSpeedValue', { x })}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={p.sim.noise} onChange={(e) => p.onSim({ noise: e.target.checked })} />
              <span>{t('quest.simNoise')}</span>
            </label>
          </div>
        )}
      </div>
      <div className="box">
        <h2 className="box-title">{t('bag.start')}</h2>
        <p className="hint">{t(p.mode === 'loop' ? 'mode.loopHint' : 'mode.onewayHint')}</p>
        <p className="coords">
          ▶ {t('place.startAt', { lat: formatCoord(p.start.lat), lon: formatCoord(p.start.lon) })}
          {p.mode === 'oneway' && (
            <>
              <br />⚑ {p.end ? t('place.endAt', { lat: formatCoord(p.end.lat), lon: formatCoord(p.end.lon) }) : t('place.endMissing')}
            </>
          )}
        </p>
        <div className="actions">
          <button type="button" className="pix-btn" disabled={locating} onClick={p.onLocate}>
            ◉ {p.locate.state === 'locating' ? t('loc.locating') : t('loc.use')}
          </button>
        </div>
        <LocateMessage status={p.locate} />
        {p.isDemo && (
          <button type="button" className="link-btn" onClick={p.onResetPoints}>
            {t('place.reset')}
          </button>
        )}
      </div>
      <AvoidStreetsBox avoid={p.avoid} onAvoid={p.onAvoid} onUnavoid={p.onUnavoid} streets={p.streets} picking={p.picking} onPick={p.onPick} pickNote={p.pickNote} />
    </>
  )
}
