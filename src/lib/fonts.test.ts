import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FACES, FONT_WAIT_MS, holdLoaderForFonts } from './fonts'

/** A loader hold that remembers whether it was let go. */
function fakeHold() {
  const state = { held: false, released: false }
  const hold = () => {
    state.held = true
    return () => {
      state.released = true
    }
  }
  return { state, hold }
}

/** A font set whose loads finish when the test says so. */
function fakeFonts() {
  const loads: string[] = []
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => (finish = resolve))
  return {
    loads,
    finish,
    fonts: {
      load: (font: string) => {
        loads.push(font)
        return done.then(() => [])
      },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the first open waits for the fonts', () => {
  it('keeps the loader up until both faces have loaded', async () => {
    const { state, hold } = fakeHold()
    const font = fakeFonts()
    holdLoaderForFonts({ fonts: font.fonts, hold })
    expect(state).toEqual({ held: true, released: false })
    expect(font.loads).toEqual([...FACES])
    font.finish()
    await vi.waitFor(() => expect(state.released).toBe(true))
  })

  it('lets the loader go after the wait even if a face never arrives', () => {
    vi.useFakeTimers()
    const { state, hold } = fakeHold()
    holdLoaderForFonts({ fonts: fakeFonts().fonts, hold })
    vi.advanceTimersByTime(FONT_WAIT_MS - 1)
    expect(state.released).toBe(false)
    vi.advanceTimersByTime(1)
    expect(state.released).toBe(true)
  })

  it('lets the loader go when a face fails to load', async () => {
    const { state, hold } = fakeHold()
    holdLoaderForFonts({ fonts: { load: () => Promise.reject(new Error('offline')) }, hold })
    await vi.waitFor(() => expect(state.released).toBe(true))
  })

  it('holds nothing where there is no font set', () => {
    const { state, hold } = fakeHold()
    holdLoaderForFonts({ fonts: undefined, hold })
    expect(state.held).toBe(false)
  })

  it('names the families the stylesheet declares', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    for (const family of ['Archivo Variable', 'Schibsted Grotesk Variable']) {
      expect(FACES.some((face) => face.includes(`"${family}"`))).toBe(true)
      expect(css).toContain(`'${family}'`)
    }
  })

  it('preloads the Archivo file the stylesheet uses', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const fontCss = readFileSync(new URL('../../node_modules/@fontsource-variable/archivo/wdth.css', import.meta.url), 'utf8')
    const preload = html.match(/<link rel="preload" href="\/node_modules\/@fontsource-variable\/archivo\/(files\/[^"]+\.woff2)"/)?.[1]
    expect(preload).toBeDefined()
    expect(fontCss).toContain(`url(./${preload})`)
  })
})
