// The logo's confetti pieces (src/components/Piece.tsx), rendered to static HTML.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Piece, { type PieceKind } from '@/components/Piece'

const LOGO = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
const draw = (kind: PieceKind) => renderToStaticMarkup(createElement(Piece, { kind, className: 'size-6' }))

describe('Piece', () => {
  it("draws each piece with the logo's own path, in the current text colour", () => {
    for (const kind of ['curl', 'wave', 'star'] as const) {
      const d = draw(kind).match(/ d="([^"]+)"/)?.[1]
      expect(d, kind).toBeTruthy()
      expect(LOGO, kind).toContain(`d="${d}"`)
    }
    const dot = draw('dot').match(/<circle [^>]*>/)?.[0] ?? ''
    for (const attribute of ['cx="350"', 'cy="176"', 'r="22"']) expect(LOGO).toContain(attribute)
    expect(dot).toMatch(/cx="350" cy="176" r="22"/)
    for (const kind of ['dot', 'curl', 'wave', 'star'] as const) {
      expect(draw(kind), kind).toContain('currentColor')
      expect(draw(kind), kind).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it('lays the curl at 45 degrees, so it never reads as an S', () => {
    expect(draw('curl')).toMatch(/transform="rotate\(-45 262 165\)"/)
    expect(draw('wave')).not.toContain('rotate')
  })

  it("frames each piece in a square of its own, centred on it, with the logo's even strokes", () => {
    const square = (kind: PieceKind) => draw(kind).match(/viewBox="([\d. ]+)"/)?.[1].split(' ').map(Number) ?? []
    for (const kind of ['dot', 'curl', 'wave', 'star'] as const) {
      const [, , width, height] = square(kind)
      expect(width, kind).toBe(height)
    }
    // The curl and the wave share a square size, so their 22 unit strokes draw alike.
    expect(square('curl')[2]).toBe(square('wave')[2])
    // Centred: the curl turns about the middle of its square, the dot sits in the middle of its.
    const [x, y, side] = square('curl')
    expect([x + side / 2, y + side / 2]).toEqual([262, 165])
    const [dx, dy, dside] = square('dot')
    expect([dx + dside / 2, dy + dside / 2]).toEqual([350, 176])
    expect(draw('dot')).toMatch(/aria-hidden="true"/)
    expect(draw('wave')).toContain('class="size-6"')
  })
})
