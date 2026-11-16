// A guest's colour, piece and name slate (src/lib/guest.ts, docs/identity.md).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GUEST_BG,
  GUEST_COLORS,
  GUEST_PIECES,
  guestLook,
  SLATE_LINE_HEIGHT,
  SLATE_TILT_DEG,
  slateLines,
  slateSize,
} from '@/lib/guest'

/** Common Danish first names, women's and men's, old and new, with æ, ø, å and hyphens. */
const DANISH = [
  'Anne', 'Kirsten', 'Mette', 'Hanne', 'Helle', 'Susanne', 'Lene', 'Maria', 'Marianne', 'Lone', 'Camilla', 'Pia',
  'Louise', 'Charlotte', 'Inge', 'Bente', 'Tina', 'Gitte', 'Karen', 'Sofie', 'Ida', 'Emma', 'Freja', 'Clara', 'Laura',
  'Anna', 'Ella', 'Isabella', 'Maja', 'Alma', 'Josefine', 'Olivia', 'Agnes', 'Karla', 'Frida', 'Luna', 'Ellen',
  'Mathilde', 'Asta', 'Esther', 'Nora', 'Signe', 'Julie', 'Caroline', 'Cecilie', 'Line', 'Sara', 'Rikke', 'Peter',
  'Michael', 'Lars', 'Jens', 'Thomas', 'Henrik', 'Søren', 'Christian', 'Martin', 'Jan', 'Morten', 'Jesper', 'Anders',
  'Niels', 'Mads', 'Rasmus', 'Per', 'Kim', 'Hans', 'Ole', 'Jørgen', 'William', 'Noah', 'Oscar', 'Lucas', 'Carl',
  'Victor', 'Malthe', 'Emil', 'Alfred', 'Frederik', 'Magnus', 'Valdemar', 'Aksel', 'August', 'Elias', 'Felix', 'Theo',
  'Anton', 'Arthur', 'Viggo', 'Otto', 'Bo', 'Christoffer', 'Mikkel', 'Simon', 'Jonas', 'Tobias', 'Kasper', 'Nicolai',
  'Bertram', 'Konrad', 'Gustav', 'Storm', 'Johan', 'Marie-Louise', 'Anne-Sofie', 'Ditte', 'Trine', 'Stine', 'Nanna',
  'Astrid', 'Liva', 'Vigga', 'Silje', 'Dagmar', 'Hannah', 'Ingrid', 'Mie', 'Sigrid', 'Thea', 'Vilma', 'Molly', 'Lærke',
  'Søs', 'Bjørn', 'Ib', 'Åse', 'Ægir', 'Ørjan',
]

const share = (list: readonly string[], of: (name: string) => string) => {
  const counts = new Map<string, number>()
  for (const name of list) counts.set(of(name), (counts.get(of(name)) ?? 0) + 1)
  return counts
}

describe('guestLook', () => {
  it('gives a name the same colour and piece every time, on every screen', () => {
    for (const name of ['Bo', 'Marie-Louise Christensen', 'Søren', '']) {
      expect(guestLook(name)).toEqual(guestLook(name))
      expect(guestLook(name)).toEqual(guestLook(`${name}`.slice(0)))
    }
    // Pinned, so a change that would recolour every guest between deploys fails here first.
    expect(guestLook('Bo')).toEqual({ color: 'lime', piece: 'curl' })
    expect(guestLook('Sofie')).toEqual({ color: 'paper', piece: 'wave' })
    expect(guestLook('Maja')).toEqual({ color: 'coral', piece: 'dot' })
    expect(guestLook('Christoffer Bjørnskov')).toEqual({ color: 'paper', piece: 'wave' })
  })

  it('reads the whole name as given, as the colour always has', () => {
    expect(new Set(['Ana', 'ana', 'Ana B.', 'Anna'].map((name) => JSON.stringify(guestLook(name)))).size).toBeGreaterThan(1)
  })

  it('reaches all 18 pairs of six colours and three pieces', () => {
    expect(GUEST_COLORS.length * GUEST_PIECES.length).toBe(18)
    const pairs = new Set(DANISH.map((name) => `${guestLook(name).color} ${guestLook(name).piece}`))
    expect(pairs.size).toBe(18)
  })

  it('spreads common Danish first names over every colour and piece', () => {
    expect(new Set(DANISH).size).toBe(DANISH.length)
    const colours = share(DANISH, (name) => guestLook(name).color)
    for (const color of GUEST_COLORS) {
      // A fair share is 1 in 6 (21 of 128): none may be rare or take over.
      expect(colours.get(color) ?? 0, color).toBeGreaterThanOrEqual(12)
      expect(colours.get(color) ?? 0, color).toBeLessThanOrEqual(32)
    }
    const pieces = share(DANISH, (name) => guestLook(name).piece)
    for (const piece of GUEST_PIECES) {
      // A fair share is 1 in 3 (43 of 128).
      expect(pieces.get(piece) ?? 0, piece).toBeGreaterThanOrEqual(32)
      expect(pieces.get(piece) ?? 0, piece).toBeLessThanOrEqual(54)
    }
  })

  it('uses only the guest colours, never gold or pink, and only the three guest pieces', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    for (const color of GUEST_COLORS) {
      expect(css, color).toMatch(new RegExp(`--color-guest-${color}:\\s*#`))
      expect(GUEST_BG[color]).toBe(`bg-guest-${color}`)
    }
    expect(GUEST_COLORS).not.toContain('gold')
    expect(GUEST_COLORS).not.toContain('pink')
    expect(GUEST_PIECES).not.toContain('star')
  })
})

describe('slateLines', () => {
  it('shows the whole first name, never initials and never cut short', () => {
    expect(slateLines('Christoffer Bjørnskov')).toEqual(['Christoffer'])
    expect(slateLines('  Bo  ')).toEqual(['Bo'])
    expect(slateLines('Ida')).toEqual(['Ida'])
    expect(slateLines('Valdemar')).toEqual(['Valdemar'])
    expect(slateLines('Josefine')).toEqual(['Josefine'])
  })

  it('breaks a hyphenated name after each hyphen', () => {
    expect(slateLines('Marie-Louise Christensen')).toEqual(['Marie-', 'Louise'])
    expect(slateLines('Anne-Marie-Louise')).toEqual(['Anne-', 'Marie-', 'Louise'])
    expect(slateLines('Anne‐Sofie')).toEqual(['Anne‐', 'Sofie'])
    expect(slateLines('Bo-')).toEqual(['Bo-'])
  })

  it('has no lines for a name with no word', () => {
    expect(slateLines('')).toEqual([])
    expect(slateLines('   ')).toEqual([])
  })
})

describe('slateSize', () => {
  // Real widths in em at the slate's instance (Archivo 62 percent wide, weight
  // 900), measured in Chrome with kerning on: what the browser draws.
  const MEASURED: Record<string, number> = {
    Bo: 0.931,
    Ida: 1.146,
    Sofie: 1.845,
    Christoffer: 3.877,
    'Marie-': 2.34,
    Louise: 2.358,
    Josefine: 3.094,
    Valdemar: 3.387,
    Wilhelmine: 4.02,
    AVATAR: 2.884,
    Ølstykke: 3.205,
  }
  const tilt = (SLATE_TILT_DEG * Math.PI) / 180

  it('fits every line, tilted, inside the token both ways, as the browser draws it', () => {
    const names = [['Bo'], ['Ida'], ['Sofie'], ['Christoffer'], ['Marie-', 'Louise'], ['Josefine'], ['Valdemar'], ['Wilhelmine'], ['AVATAR'], ['Ølstykke']]
    for (const lines of names) {
      const size = slateSize(lines)
      const width = Math.max(...lines.map((line) => MEASURED[line])) * size
      const height = lines.length * SLATE_LINE_HEIGHT * size
      const across = width * Math.cos(tilt) + height * Math.sin(tilt)
      const down = width * Math.sin(tilt) + height * Math.cos(tilt)
      // In shares of the token's side, clear of its rounded corners (and of float rounding).
      expect(across, lines.join('')).toBeLessThanOrEqual(0.78 + 1e-9)
      expect(down, lines.join('')).toBeLessThanOrEqual(0.78 + 1e-9)
    }
  })

  it('fills the width with a long name and stops a short one from shouting', () => {
    expect(slateSize(['Bo'])).toBe(0.58)
    expect(slateSize(['Ida'])).toBe(0.58)
    const christoffer = slateSize(['Christoffer'])
    // The fit is tight: within a few percent of the room (kerning is the slack).
    expect(MEASURED.Christoffer * christoffer).toBeGreaterThan(0.74)
    expect(christoffer).toBeLessThan(slateSize(['Josefine']))
    expect(slateSize(['Josefine'])).toBeLessThan(slateSize(['Sofie']))
  })

  it('counts a character Archivo lacks as wider than any of its own', () => {
    expect(slateSize(['Bo\u{1F389}'])).toBeLessThan(slateSize(['Boo']))
    expect(slateSize(['Émile'])).toBe(slateSize(['Emile']))
  })

  it('gives three short lines room to stack', () => {
    const size = slateSize(['Anne-', 'Marie-', 'Lou'])
    expect(3 * SLATE_LINE_HEIGHT * size).toBeLessThanOrEqual(0.78 + 1e-9)
    expect(slateSize([])).toBe(0)
  })
})
