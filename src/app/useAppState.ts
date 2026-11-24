import { useCallback, useReducer, useRef, type RefObject } from 'react'
import { appReducer, initialAppState, type AppAction, type AppState } from './appState.ts'

export type AppStore = {
  /** The state of the last render, for drawing. */
  state: AppState
  dispatch: (action: AppAction) => void
  /**
   * The state with every dispatch so far applied, even those of this very event handler.
   * Handlers read it so that two taps in one frame see each other, and async code reads it
   * after an `await` instead of a stale closure.
   */
  latest: RefObject<AppState>
}

/** `useReducer` plus a synchronous view of the newest state (the reducer is pure, so it is safe to run twice). */
export function useAppState(init: () => AppState = initialAppState): AppStore {
  const [state, rawDispatch] = useReducer(appReducer, undefined, init)
  const latest = useRef(state)
  const dispatch = useCallback((action: AppAction) => {
    latest.current = appReducer(latest.current, action)
    rawDispatch(action)
  }, [])
  return { state, dispatch, latest }
}
