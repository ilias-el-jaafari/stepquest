import { ONBOARDING_STORAGE_KEY } from '../config/brand.ts'

/** Whether the first-run intro was already completed or skipped on this device. */
export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Private mode or storage disabled: the intro simply shows again next visit.
  }
}
