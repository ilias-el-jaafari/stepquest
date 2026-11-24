import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n/index.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { useModal } from './useModal.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.setItem('stepquest.locale', 'en')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const key = (k: string, shiftKey = false) => act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })))

function Panel({ onEscape }: { onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModal(ref, { onEscape })
  return (
    <div ref={ref} tabIndex={-1} data-testid="panel">
      <button id="a">a</button>
      <button id="b">b</button>
    </div>
  )
}

describe('useModal', () => {
  it('focuses the panel, wraps Tab and Shift+Tab, calls Escape, and restores focus on close', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const esc = vi.fn()
    await act(async () => root.render(<div><Panel onEscape={esc} /></div>))
    expect(document.activeElement).toBe(host.querySelector('[data-testid="panel"]'))
    const a = host.querySelector<HTMLElement>('#a')!
    const b = host.querySelector<HTMLElement>('#b')!
    b.focus()
    await key('Tab')
    expect(document.activeElement).toBe(a)
    await key('Tab', true)
    expect(document.activeElement).toBe(b)
    // Focus that escaped (a click on the backdrop) is pulled back in.
    ;(document.activeElement as HTMLElement).blur()
    await key('Tab')
    expect(document.activeElement).toBe(a)
    await key('Escape')
    expect(esc).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<div />))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('ConfirmDialog', () => {
  it('is an alert dialog with the safe answer focused; Escape means no', async () => {
    const yes = vi.fn()
    const no = vi.fn()
    await act(async () => root.render(<I18nProvider><ConfirmDialog message="quest.endConfirm" yes="quest.endYes" no="quest.endNo" onYes={yes} onNo={no} /></I18nProvider>))
    const dialog = host.querySelector('[role="alertdialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector(`[id="${dialog.getAttribute('aria-labelledby')}"]`)?.textContent).toContain('Stop here?')
    expect(document.activeElement).toBe(host.querySelector('[data-testid="confirm-no"]'))
    await key('Escape')
    expect(no).toHaveBeenCalledTimes(1)
    await act(async () => (host.querySelector('[data-testid="confirm-yes"]') as HTMLButtonElement).click())
    expect(yes).toHaveBeenCalledTimes(1)
  })
})
