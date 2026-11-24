import { useCallback, useState } from 'react'
import { MAX_STEPS, MAX_STRIDE_M, MIN_STEPS, MIN_STRIDE_M } from '../geo/steps.ts'
import { commitSteps, commitStride, formatStride, liveSteps, liveStride, parseStepsText, parseStrideText, type Committed } from '../ui/numberInput.ts'
import type { Settings } from '../ui/settings.ts'
import type { AppAction } from './appState.ts'

type Args = {
  settings: Settings
  /** Newest settings, for handlers that run before the next render. */
  latest: () => Settings
  dispatch: (action: AppAction) => void
}

/**
 * The raw text of the step and stride fields: typed freely, validated on blur, Enter or Plan.
 * Values that are already usable flow into the settings while typing.
 */
export function useNumberFields({ settings, latest, dispatch }: Args) {
  const [stepsText, setStepsText] = useState(() => String(settings.targetSteps))
  const [strideText, setStrideText] = useState(() => formatStride(settings.strideM))
  const [stepsNote, setStepsNote] = useState<Committed>()
  const [strideNote, setStrideNote] = useState<Committed>()

  const setSteps = useCallback(
    (value: number) => {
      setStepsText(String(value))
      setStepsNote(undefined)
      dispatch({ type: 'settings', patch: { targetSteps: value } })
    },
    [dispatch],
  )

  const typeSteps = useCallback(
    (text: string) => {
      setStepsText(text)
      setStepsNote(undefined)
      const v = liveSteps(text)
      if (v !== undefined) dispatch({ type: 'settings', patch: { targetSteps: v } })
    },
    [dispatch],
  )

  const typeStride = useCallback(
    (text: string) => {
      setStrideText(text)
      setStrideNote(undefined)
      const v = liveStride(text)
      if (v !== undefined) dispatch({ type: 'settings', patch: { strideM: v } })
    },
    [dispatch],
  )

  /** Validate and clamp the typed step goal; returns the value to use. */
  const commitStepsField = useCallback((): number => {
    const c = commitSteps(stepsText, latest().targetSteps)
    setStepsText(String(c.value))
    setStepsNote(c.note ? c : undefined)
    dispatch({ type: 'settings', patch: { targetSteps: c.value } })
    return c.value
  }, [stepsText, latest, dispatch])

  const commitStrideField = useCallback((): number => {
    const c = commitStride(strideText, latest().strideM)
    setStrideText(formatStride(c.value))
    setStrideNote(c.note ? c : undefined)
    dispatch({ type: 'settings', patch: { strideM: c.value } })
    return c.value
  }, [strideText, latest, dispatch])

  const stepsTyped = parseStepsText(stepsText)
  const strideTyped = parseStrideText(strideText)
  return {
    stepsText,
    strideText,
    stepsNote,
    strideNote,
    setSteps,
    typeSteps,
    typeStride,
    commitStepsField,
    commitStrideField,
    stepsOutOfRange: stepsTyped.kind === 'number' && (stepsTyped.value < MIN_STEPS || stepsTyped.value > MAX_STEPS),
    stepsInvalid: stepsTyped.kind === 'invalid',
    strideOutOfRange: strideTyped.kind === 'number' && (strideTyped.value < MIN_STRIDE_M || strideTyped.value > MAX_STRIDE_M),
    strideInvalid: strideTyped.kind === 'invalid',
  }
}
