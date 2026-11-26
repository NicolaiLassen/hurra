// The palette guard (docs/identity.md). src/index.css resets Tailwind's stock
// palette (--color-*: initial), and Tailwind drops a class whose colour no
// longer exists without a word: bg-amber-600 would simply draw nothing. So this
// fails on a stock hue class anywhere in src, and on a raw colour (a hex, or
// numbers in rgb() and the like) outside src/index.css, where Hurra's colours live.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PICTURE_ATTRIBUTE } from '@/components/tv/picture'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const THIS_FILE = 'lib/tokens.test.ts'

/** Tailwind's stock hues (node_modules/tailwindcss/theme.css), all gone since the reset. */
const STOCK_HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose', 'slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe',
]
const SHADE = '(?:50|[1-9]00|950)'

/**
 * A stock hue with a shade: after a utility's dash, with any variants and an
 * opacity (bg-amber-600, hover:ring-slate-300/80, from-sky-500/30), in a CSS
 * variable (var(--color-amber-600)) or theme(colors.amber.600), and a hue
 * spliced into a class name (bg-${hue}-500). Hurra's own names never match:
 * bg-pink, text-key-c, bg-guest-teal, bg-paper-2.
 */
const STOCK_CLASS = new RegExp(`(?<=[-.])(?:${STOCK_HUES.join('|')})[-.]${SHADE}(?!\\w)|-\\$\\{[^}]*\\}-${SHADE}(?!\\w)`, 'g')

/**
 * A CSS hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa), not an anchor like
 * #add-a-game or an entity like &#123;. Letters and digits bound it, not \w:
 * Tailwind writes a space in an arbitrary value as an underscore, so a glow
 * like shadow-[0_0_24px_#f5c542] has one right before the #.
 */
const HEX = /(?<![0-9A-Za-z&#])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9A-Za-z-])/gi

/**
 * A colour written as numbers in a CSS colour function, rgb(245_197_66/0.6) or
 * hsl(${hue} 42% 30%): it bypasses the tokens as a hex does. A function of a
 * token passes: color-mix(in_oklab,var(--color-gold)_60%,transparent).
 */
const COLOR_FN = /(?<![0-9A-Za-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?=\s*[\d.$-])/gi

/** Files that may hold raw hex colours, each with its reason. Keep it short. */
const HEX_ALLOWED: Record<string, string> = {
  'index.css': "Hurra's colours are defined here",
  'lib/media.ts': 'a canvas fill for the transparent parts of uploaded pictures: a canvas cannot read CSS variables',
  'components/host/recapView.ts': "the recap race chart's validated categorical palette, one line per guest, not identity colours",
  [THIS_FILE]: "this guard's own examples",
}

/** Files that may write colours as numbers in a colour function, each with its reason. */
const COLOR_FN_ALLOWED: Record<string, string> = {
  'index.css': "Hurra's colours are defined here",
  'lib/photos.tsx': 'the drawn sample faces of dev builds, a hue per name',
  'lib/sampleMedia.ts': "the drawn sample pictures of dev builds' fixtures, two hues per picture number",
  [THIS_FILE]: "this guard's own examples",
}

/** Every text file under src, by its path from src with forward slashes. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|css|html|svg|json)$/.test(entry.name) ? [relative(SRC, path).split(sep).join('/')] : []
  })
}

/** Each match of `pattern` in `file`, as "file:line: match". */
function findings(file: string, pattern: RegExp): string[] {
  return readFileSync(join(SRC, file), 'utf8')
    .split('\n')
    .flatMap((line, i) => Array.from(line.matchAll(pattern), (match) => `src/${file}:${i + 1}: ${match[0]}`))
}

const matches = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), (match) => match[0])

describe('the palette guard', () => {
  it('knows a stock Tailwind colour from a Hurra token', () => {
    const stock = [
      'bg-amber-600',
      'ring-slate-300/80',
      'hover:text-slate-200',
      'md:hover:bg-emerald-500/[0.35]',
      'from-sky-500/30',
      'border-x-zinc-900',
      'inset-ring-mist-100',
      'decoration-taupe-950',
      'text-gray-50!',
      'shadow-[0_0_4px_var(--color-rose-400)]',
      'bg-[theme(colors.indigo.700)]',
      'bg-${hue}-500',
      "['bg-primary', 'bg-red-400'][i]",
    ]
    for (const name of stock) expect(matches(name, STOCK_CLASS), name).toHaveLength(1)

    const tokens = [
      'bg-pink',
      'text-pink/80',
      'bg-guest-teal',
      'bg-guest-violet/40',
      'text-key-c',
      'bg-key-d',
      'bg-paper-2',
      'text-paper-3',
      'ring-confetti-violet',
      'bg-gold-rim',
      'text-tv-floor',
      'size-500',
      'primrose-100',
    ]
    for (const name of tokens) expect(matches(name, STOCK_CLASS), name).toEqual([])
  })

  it('knows a hex colour from an anchor or an issue number', () => {
    for (const hex of [
      '#fff',
      '#14110E',
      "'#ff6fae'",
      'bg-[#06050b]',
      '#0008',
      'fill="#b7791f80"',
      'shadow-[0_0_24px_#f5c542]',
      'bg-[linear-gradient(#0f0d1a_0%,transparent)]',
    ]) {
      expect(matches(hex, HEX), hex).toHaveLength(1)
    }
    for (const text of ['#add-a-game', 'issue #12', '&#123;', '#abcde', '#1234567', '#coffee']) {
      expect(matches(text, HEX), text).toEqual([])
    }
  })

  it('knows a colour written as numbers from a function of a token', () => {
    for (const color of [
      'drop-shadow-[0_0_20px_rgb(245_197_66/0.6)]',
      'rgba(0, 0, 0, 0.4)',
      'fill="hsl(${hue} 42% 30%)"',
      'bg-[oklch(0.8_0.15_90)]',
      '[text-shadow:0_0_40px_rgb(.96_.77_.26)]',
    ]) {
      expect(matches(color, COLOR_FN), color).toHaveLength(1)
    }
    for (const text of [
      'drop-shadow-[0_0_20px_color-mix(in_oklab,var(--color-gold)_60%,transparent)]',
      'bg-[radial-gradient(80%_70%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]',
      'rgb(var(--x))',
      'the hsl() function',
    ]) {
      expect(matches(text, COLOR_FN), text).toEqual([])
    }
  })

  it("names every hue in Tailwind's own palette", () => {
    const theme = readFileSync(new URL('../../node_modules/tailwindcss/theme.css', import.meta.url), 'utf8')
    const hues = new Set(Array.from(theme.matchAll(/--color-([a-z]+)-50:/g), (match) => match[1]))
    expect([...hues].sort()).toEqual([...STOCK_HUES].sort())
  })
})

describe('the old shadcn names', () => {
  it("point at Hurra's tokens, so a token changed in the theme changes them too", () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8')
    const tokens = new Set(Array.from(css.matchAll(/^\s*(--color-[\w-]+):/gm), (match) => match[1]))
    const root = css.match(/^:root \{([^}]*)\}/m)?.[1] ?? ''
    const aliases = Array.from(root.matchAll(/(--[\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()] as const)
    expect(aliases.map(([name]) => name)).toContain('--background')
    for (const [name, value] of aliases.filter(([name]) => name !== '--radius')) {
      expect(value, name).toMatch(/^var\(--color-[\w-]+\)$/)
      expect([...tokens], name).toContain(value.slice('var('.length, -1))
    }
  })
})

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast between two #rrggbb colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** The six-digit hex colours a CSS block sets, by name. */
const colours = (block: string) =>
  Object.fromEntries(Array.from(block.matchAll(/^\s*--color-([\w-]+):\s*(#[0-9a-f]{6});/gim), ([, name, value]) => [name, value.toLowerCase()]))

describe('the brighter picture', () => {
  // docs/identity.md, The TV's frame: for a TV that crushes dark tones, the
  // same look with its dark end raised, over the tokens and nothing else.
  const css = readFileSync(join(SRC, 'index.css'), 'utf8')
  const standard = colours(css.match(/^@theme \{([\s\S]*?)^\}/m)?.[1] ?? '')
  const selector = `:root[${PICTURE_ATTRIBUTE}='bright']`
  const block = css.match(new RegExp(`^${selector.replace(/[[\]()]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1]
  const bright = { ...standard, ...colours(block ?? '') }
  const SURFACES = ['ground', 'raised', 'overlay', 'rule']

  it("is scoped to the attribute the TV page sets on the document's root", () => {
    expect(block, selector).toBeDefined()
    expect(standard.ground).toBe('#14110e')
  })

  it('lifts only the dark end: gold, pink, the key, the guest colours, paper and ink stay as they are', () => {
    const lifted = Object.keys(colours(block ?? ''))
    expect(lifted.sort()).toEqual([...SURFACES, 'paper-2', 'paper-3'].sort())
    for (const name of lifted) expect(Object.keys(standard), name).toContain(name)
    // Every declaration in the block is one of those colours: no other token, no alias.
    expect(Array.from((block ?? '').matchAll(/--[\w-]+:/g)).length).toBe(lifted.length)
  })

  it('raises every surface, keeps it warm, and sets each a bigger step from the ground than the standard picture does', () => {
    for (const [i, name] of SURFACES.entries()) {
      expect(luminance(bright[name]), name).toBeGreaterThan(luminance(standard[name]))
      // Warm like the studio black it lifts (red over green over blue), never a grey or a cool wash.
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(bright[name].slice(at, at + 2), 16))
      expect(r > g && g > b, `${name} ${bright[name]}`).toBe(true)
      if (i === 0) continue
      expect(luminance(bright[name]), name).toBeGreaterThan(luminance(bright[SURFACES[i - 1]]))
      expect(contrast(bright[name], bright.ground), name).toBeGreaterThan(contrast(standard[name], standard.ground) * 1.25)
    }
    // The line colour shows on the ground and on a panel.
    expect(contrast(bright.rule, bright.ground)).toBeGreaterThanOrEqual(2.5)
    expect(contrast(bright.rule, bright.raised)).toBeGreaterThanOrEqual(1.75)
  })

  it('reads secondary text at 7 to 1 or more on its ground, and keeps paper, paper-2 and paper-3 in that order', () => {
    expect(contrast(bright['paper-2'], bright.ground)).toBeGreaterThanOrEqual(7)
    expect(contrast(bright['paper-3'], bright.ground)).toBeGreaterThanOrEqual(7)
    expect(luminance(bright.paper)).toBeGreaterThan(luminance(bright['paper-2']))
    expect(luminance(bright['paper-2'])).toBeGreaterThan(luminance(bright['paper-3']))
    // Ranks and the quiz's stepped-back tiles stay readable on a panel.
    expect(contrast(bright['paper-3'], bright.raised)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(bright['paper-3'], bright.rule)).toBeGreaterThanOrEqual(3)
  })
})

describe("src uses only Hurra's colours", () => {
  const files = sourceFiles()

  it('has no stock Tailwind colour class, variable or theme() call', () => {
    expect(files.filter((file) => file !== THIS_FILE).flatMap((file) => findings(file, STOCK_CLASS))).toEqual([])
  })

  it('has no raw hex colour outside src/index.css and the allowed files', () => {
    expect(files.filter((file) => !(file in HEX_ALLOWED)).flatMap((file) => findings(file, HEX))).toEqual([])
  })

  it('has no colour written as numbers in a colour function outside the allowed files', () => {
    expect(files.filter((file) => !(file in COLOR_FN_ALLOWED)).flatMap((file) => findings(file, COLOR_FN))).toEqual([])
  })

  it('keeps only exceptions that are still needed', () => {
    for (const [allowed, pattern, name] of [
      [HEX_ALLOWED, HEX, 'HEX_ALLOWED'],
      [COLOR_FN_ALLOWED, COLOR_FN, 'COLOR_FN_ALLOWED'],
    ] as const) {
      for (const file of Object.keys(allowed).filter((file) => file !== 'index.css')) {
        expect(files, file).toContain(file)
        expect(findings(file, pattern).length, `${file} needs no exception any more: drop it from ${name}`).toBeGreaterThan(0)
      }
    }
  })
})
