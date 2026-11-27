import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, setAudioEngineForTests } from '../audio/engine.ts'
import { AUDIO_STORAGE_KEY, loadAudioSettings } from '../audio/settings.ts'
import { I18nProvider } from '../i18n/index.ts'
import { SoundMenu } from './SoundMenu.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let host: HTMLDivElement
let root: Root
let engine: AudioEngine

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('stepquest.locale', 'es')
  engine = new AudioEngine(loadAudioSettings())
  setAudioEngineForTests(engine)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  setAudioEngineForTests(undefined)
})

const stored = () => JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY) ?? '{}')
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)

function setRange(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, String(value))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SoundMenu', () => {
  it('opens a compact panel with mute, voice only and four volume sliders (Spanish)', async () => {
    const unlock = vi.spyOn(engine, 'unlock')
    await act(async () => root.render(<I18nProvider><SoundMenu /></I18nProvider>))
    expect(q('[data-testid="sound-panel"]')).toBeNull()
    await act(async () => q<HTMLButtonElement>('[data-testid="sound-button"]')!.click())
    expect(unlock).toHaveBeenCalled() // the tap doubles as the audio unlock gesture
    const panel = q('[data-testid="sound-panel"]')!
    expect(panel.textContent).toContain('Silenciar todo')
    expect(panel.textContent).toContain('Solo voz')
    for (const label of ['General', 'Música', 'Voz', 'Efectos']) expect(panel.textContent).toContain(label)
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(4)
    expect(q<HTMLButtonElement>('[data-testid="sound-button"]')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('saves volume, mute and voice-only changes', async () => {
    await act(async () => root.render(<I18nProvider><SoundMenu /></I18nProvider>))
    await act(async () => q<HTMLButtonElement>('[data-testid="sound-button"]')!.click())
    await act(async () => setRange(q<HTMLInputElement>('[data-testid="volume-music"]')!, 35))
    expect(stored().music).toBe(0.35)
    const [mute, voiceOnly] = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    await act(async () => voiceOnly!.click())
    expect(stored().voiceOnly).toBe(true)
    expect(q<HTMLInputElement>('[data-testid="volume-music"]')!.disabled).toBe(true)
    expect(q<HTMLInputElement>('[data-testid="volume-sfx"]')!.disabled).toBe(true)
    expect(q<HTMLInputElement>('[data-testid="volume-voice"]')!.disabled).toBe(false)
    await act(async () => mute!.click())
    expect(stored().muted).toBe(true)
    expect(q<HTMLInputElement>('[data-testid="volume-voice"]')!.disabled).toBe(true)
    expect(q('[data-testid="sound-button"]')!.className).toContain('is-off')
    // Settings survive a reload.
    expect(loadAudioSettings()).toMatchObject({ music: 0.35, voiceOnly: true, muted: true })
  })

  it('has its own Chiptune music checkbox (on by default), saved, and only usable while sound is on', async () => {
    await act(async () => root.render(<I18nProvider><SoundMenu /></I18nProvider>))
    await act(async () => q<HTMLButtonElement>('[data-testid="sound-button"]')!.click())
    const box = q<HTMLInputElement>('[data-testid="chiptune-toggle"]')!
    expect(box.closest('label')!.textContent).toBe('Música chiptune')
    expect(box.checked).toBe(true)
    await act(async () => box.click())
    expect(stored().chiptune).toBe(false)
    expect(box.checked).toBe(false)
    await act(async () => box.click())
    expect(stored().chiptune).toBe(true)
    await act(async () => engine.updateSettings({ muted: true }))
    expect(box.disabled).toBe(true)
  })

  it('speaks a test phrase in the current language and closes with Escape', async () => {
    const say = vi.spyOn(engine, 'say')
    await act(async () => root.render(<I18nProvider><SoundMenu placement="up" /></I18nProvider>))
    await act(async () => q<HTMLButtonElement>('[data-testid="sound-button"]')!.click())
    const test = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Probar voz')!
    await act(async () => test.click())
    expect(say).toHaveBeenCalledWith('Prueba de sonido. ¡Gema 3 de 10!', 'es', 9)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('[data-testid="sound-panel"]')).toBeNull()
  })
})
