import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

/** Every name src/index.css declares in a scale: --text-tv-question gives tv-question under text. */
function declared(scale: 'text' | 'radius' | 'ease' | 'animate'): string[] {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const names = Array.from(css.matchAll(new RegExp(`--${scale}-([a-z0-9-]+):`, 'g')), (match) => match[1])
  // Leave out a size's line height (--text-tv-count--line-height).
  return [...new Set(names.filter((name) => !name.includes('--')))]
}

describe("cn knows Hurra's scales", () => {
  it('finds the scales in index.css', () => {
    expect(declared('text')).toContain('tv-question')
    expect(declared('radius')).toContain('token')
    expect(declared('ease')).toContain('tab')
    expect(declared('animate')).toContain('strap-in')
  })

  it('keeps a text colour beside every font size, and lets a size replace a size', () => {
    for (const size of declared('text')) {
      expect(cn('text-paper', `text-${size}`)).toBe(`text-paper text-${size}`)
      expect(cn(`text-${size}`, 'text-ink/80')).toBe(`text-${size} text-ink/80`)
      expect(cn('text-sm', `text-${size}`)).toBe(`text-${size}`)
      expect(cn(`text-${size}`, 'text-lg')).toBe('text-lg')
    }
  })

  it('lets a radius replace a radius', () => {
    for (const radius of declared('radius')) {
      expect(cn('rounded-lg', `rounded-${radius}`)).toBe(`rounded-${radius}`)
      expect(cn(`rounded-${radius}`, 'rounded-full')).toBe('rounded-full')
    }
  })

  it('lets an easing and an animation replace their own kind', () => {
    for (const ease of declared('ease')) expect(cn('ease-in', `ease-${ease}`)).toBe(`ease-${ease}`)
    for (const animation of declared('animate')) expect(cn('animate-spin', `animate-${animation}`)).toBe(`animate-${animation}`)
  })

  it('merges the colour tokens and leaves the type utilities alone', () => {
    expect(cn('bg-overlay', 'bg-gold')).toBe('bg-gold')
    expect(cn('text-paper', 'text-paper-2')).toBe('text-paper-2')
    expect(cn('ring-rule', 'ring-gold/50')).toBe('ring-gold/50')
    expect(cn('tv-num text-tv-score text-gold', 'on-air wide stripes')).toBe('tv-num text-tv-score text-gold on-air wide stripes')
  })
})
