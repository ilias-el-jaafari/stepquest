import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en.ts'
import { es } from '../i18n/es.ts'
import { I18nProvider } from '../i18n/index.ts'
import { GhostHud } from './GhostHud.tsx'
import type { GhostSay } from './useGhost.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  localStorage.clear()
})

async function show(props: Parameters<typeof GhostHud>[0], locale: 'en' | 'es' = 'en') {
  localStorage.setItem('stepquest.locale', locale)
  await act(async () =>
    root.render(
      <I18nProvider key={locale}>
        <GhostHud {...props} />
      </I18nProvider>,
    ),
  )
}
const live = () => host.querySelector('[data-testid="ghost-live"]')!
const say = (key: GhostSay['key'], pose: GhostSay['pose'] = 'float'): GhostSay => ({ key, pose, ms: 1000, id: 1 })

describe('GhostHud', () => {
  it('announces the pace status politely, in both languages', async () => {
    await show({ say: undefined, status: 'behind' })
    expect(live().getAttribute('aria-live')).toBe('polite')
    expect(live().textContent).toBe(en['ghost.pace.behind'])
    await show({ say: undefined, status: 'ahead' }, 'es')
    expect(live().textContent).toBe('Vas por delante del fantasma')
    await show({ say: undefined, status: 'on' }, 'es')
    expect(live().textContent).toBe('Al ritmo del fantasma')
  })

  it('is quiet in the warm-up but keeps the live region', async () => {
    await show({ say: undefined, status: 'warmup' })
    expect(live().textContent).toBe('')
    expect(host.querySelector('.ghost-hud')!.className).toContain('quiet')
  })

  it('lets a line the ghost says win, and pops on a boo', async () => {
    await show({ say: say('ghost.boo', 'boo'), status: 'behind' }, 'es')
    expect(live().textContent).toBe(es['ghost.boo'])
    expect(host.querySelector('.ghost-face')!.className).toContain('pop')
    await show({ say: say('ghost.lit'), status: 'on' }, 'es')
    expect(live().textContent).toBe('Por aquí hay farolas.')
    expect(host.querySelector('.ghost-face')!.className).not.toContain('pop')
  })

  it('shows the gap to the ghost under the status once the warm-up is over', async () => {
    const gap = () => host.querySelector('[data-testid="ghost-gap"]')?.textContent
    await show({ say: undefined, status: 'behind', gapM: -25 }, 'es')
    expect(gap()).toBe('Wisp va 25 m por delante')
    await show({ say: undefined, status: 'ahead', gapM: 31 }, 'es')
    expect(gap()).toBe('Vas 31 m por delante de Wisp')
    await show({ say: undefined, status: 'on', gapM: 3 }, 'es')
    expect(gap()).toBeUndefined()
    await show({ say: undefined, status: 'warmup', gapM: -40 }, 'es')
    expect(gap()).toBeUndefined()
  })
})
