import { useSyncExternalStore } from 'react'
import { audioEngine, type EngineSnapshot } from './engine.ts'

/** The shared audio engine plus its live state (settings, context status, music). */
export function useAudio(): EngineSnapshot & { engine: ReturnType<typeof audioEngine> } {
  const engine = audioEngine()
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
  return { ...snap, engine }
}
