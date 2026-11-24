import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { LatLon } from '../geo/geo.ts'
import { stepsToMetres } from '../geo/steps.ts'
import { isNightWalk } from '../geo/sun.ts'
import { PlanClient } from '../routing/planClient.ts'
import { planWithSafety } from '../routing/safePlanner.ts'
import type { RouteRequest } from '../routing/planner.ts'
import type { World } from '../ui/useMapData.ts'
import { WALK_KMH } from './constants.ts'
import type { AppAction, AppState } from './appState.ts'

/** Whether the walk starts or ends after sunset (from the start point's sun), so lighting counts more. */
export function walkIsAtNight(start: LatLon, now: number, steps: number, strideM: number): boolean {
  const walkMs = (stepsToMetres(steps, strideM) / 1000 / WALK_KMH) * 3_600_000
  return isNightWalk(now, walkMs, start)
}

type Args = {
  world: World | undefined
  latest: RefObject<AppState>
  dispatch: (action: AppAction) => void
  /** Validates the number fields and returns what to plan with. */
  commitFields: () => { targetSteps: number; strideM: number }
  /** Called after a route was planned and is still wanted (for example to scroll the map into view). */
  onPlanned?: () => void
}

/**
 * Planning and rerouting run in a Web Worker (or on the main thread where there is none).
 * `plan` is safe to call twice in a row: the second call finds a request already out.
 */
export function usePlanner({ world, latest, dispatch, commitFields, onPlanned }: Args) {
  const client = useRef<PlanClient>(undefined)
  client.current ??= new PlanClient()
  useEffect(() => {
    const c = client.current
    return () => c?.dispose()
  }, [])
  const planned = useRef(onPlanned)
  useEffect(() => {
    planned.current = onPlanned
  })

  const plan = useCallback(
    (reroll = false) => {
      const planClient = client.current
      if (!world || !planClient || latest.current.plan.status === 'running') return
      if (latest.current.settings.mode === 'oneway' && !latest.current.end) return
      // Typed text is validated first; that may change the settings and so number the request again.
      const { targetSteps, strideM } = commitFields()
      const s = latest.current
      const seed = reroll ? s.plan.seed + 1 : s.plan.seed
      const token = s.plan.token + 1
      dispatch({ type: 'planStart', token, seed })
      // Safe routing is always on. From sunset to sunrise (at the start or by the estimated end
      // of the walk) lighting counts more, automatically.
      const night = walkIsAtNight(s.start, Date.now(), targetSteps, strideM)
      const req: RouteRequest = { mode: s.settings.mode, start: s.start, end: s.settings.mode === 'oneway' ? s.end : undefined, targetSteps, strideM, seed }
      const opts = { safe: true, night, avoid: [...s.avoid] }
      void (async () => {
        try {
          // The search runs in the worker, so the button repaints and the map keeps moving meanwhile.
          const outcome = await planClient.plan(world, req, world.data.bbox, opts)
          if (outcome.status === 'stale') {
            dispatch({ type: 'planCancelled', token })
            return
          }
          const sp = outcome.status === 'ok' ? outcome.value : planWithSafety(world.graph, world.safety, req, world.data.bbox, opts)
          dispatch({ type: 'planDone', token, plan: sp })
          // Only when the answer was still wanted (the reducer drops it otherwise).
          if (latest.current.plan.token === token && latest.current.result === sp.result) planned.current?.()
        } catch {
          dispatch({ type: 'planFailed', token })
        }
      })()
    },
    [world, latest, dispatch, commitFields],
  )

  const reroute = useCallback(
    async (q: Parameters<PlanClient['reroute']>[1]) => {
      if (!world || !client.current) return undefined
      const outcome = await client.current.reroute(world, q, latest.current.avoid, Date.now())
      return outcome.status === 'ok' ? outcome.value : undefined
    },
    [world, latest],
  )

  return { plan, reroute }
}
