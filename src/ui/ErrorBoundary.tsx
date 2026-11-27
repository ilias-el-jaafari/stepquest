import { Component, type ErrorInfo, type ReactNode } from 'react'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { ghostSprite } from '../ghost/art.ts'
import { detectLocale } from '../i18n/locale.ts'

import { PixelSvg } from './PixelIcons.tsx'

const MESSAGES = { en, es }

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * The last line of defence: a render error anywhere below shows a friendly retro message
 * instead of a white screen. It reads the language itself (not from the i18n provider), so it
 * still works when the provider is the thing that broke. Nothing is cleared: the saved quest,
 * the settings and the walker's look stay on the device, so "Reload" picks the quest back up.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // The console is the only place for details; the screen never shows raw error text.
    console.error('StepQuest: a screen failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    const m = MESSAGES[detectLocale()]
    return (
      <div className="crash" role="alert" data-testid="crash">
        <div className="crash-box">
          <PixelSvg art={ghostSprite('boo')} size={32} className="crash-ghost" />
          <h1 className="crash-title">{m['crash.title']}</h1>
          <p>{m['crash.body']}</p>
          <div className="crash-actions">
            <button type="button" className="pix-btn" data-testid="crash-retry" onClick={() => this.setState({ failed: false })}>
              {m['crash.retry']}
            </button>
            <button type="button" className="pix-btn primary" data-testid="crash-reload" onClick={() => location.reload()}>
              {m['crash.reload']}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
