import { APP_NAME } from '../config/brand.ts'
import { PixelSvg } from './PixelIcons.tsx'
import { LOGO } from './logoArt.ts'

/** The pixel gem mark (decorative; the name beside it carries the meaning). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return <PixelSvg art={LOGO} size={size} className={className ?? 'logo-mark'} />
}

/** Mark plus the product name in the pixel font. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo-lockup">
      <LogoMark size={size} />
      <span className="logo-name">{APP_NAME}</span>
    </span>
  )
}
