import type { ReactNode } from 'react'
import { ghostSprite, type GhostPose } from '../ghost/art.ts'
import { PixelSvg } from './PixelIcons.tsx'

type Props = {
  /** `bad` for something that went wrong, `good` for a friendly note. */
  tone?: 'bad' | 'good'
  pose?: GhostPose
  role?: 'alert' | 'status'
  testId?: string
  children: ReactNode
}

/**
 * A message box with Wisp's face stuck on its top-left corner (error-copy spec, E2). The face is
 * decoration, drawn over the border so the text keeps the full width of the box; the words carry
 * the meaning and the action to tap.
 */
export function GhostNote({ tone = 'bad', pose = 'boo', role, testId, children }: Props) {
  return (
    <div className={`msg ${tone} ghost-note`} role={role} data-testid={testId}>
      <span className="ghost-note-face" aria-hidden="true">
        <PixelSvg art={ghostSprite(pose)} size={16} />
      </span>
      {children}
    </div>
  )
}
