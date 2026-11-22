import { filledSegments, METER_SEGMENTS } from './meterSegments.ts'

/** Today's steps as a segmented 8-bit meter. */
export function StepMeter({ pct, label }: { pct: number; label: string }) {
  const filled = filledSegments(pct)
  const value = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div className="step-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label} data-testid="step-meter">
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span key={i} className={i < filled ? 'seg on' : 'seg'} style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  )
}
