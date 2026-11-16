// Who a guest is on every screen (docs/identity.md, The player token): their
// colour and piece, and the first name a big token shows. Everything here is
// keyed on the name, as a guest's colour always has been, so the TV, every
// phone and the host room draw the same guest the same way without asking
// anyone. Nothing here touches the DOM: Avatar draws it, and this is all a
// test needs.

/** The six guest colours (--color-guest-* in src/index.css): identity only. Gold and pink have jobs, so they are never a guest's. */
export const GUEST_COLORS = ['coral', 'teal', 'violet', 'sky', 'lime', 'paper'] as const
export type GuestColor = (typeof GUEST_COLORS)[number]

/** The logo's confetti pieces a guest can have (src/components/Piece.tsx). The star stays in the confetti. */
export const GUEST_PIECES = ['dot', 'curl', 'wave'] as const
export type GuestPiece = (typeof GUEST_PIECES)[number]

export type GuestLook = { color: GuestColor; piece: GuestPiece }

/** Each guest colour as a background class, spelled out so Tailwind finds it. */
export const GUEST_BG: Record<GuestColor, string> = {
  coral: 'bg-guest-coral',
  teal: 'bg-guest-teal',
  violet: 'bg-guest-violet',
  sky: 'bg-guest-sky',
  lime: 'bg-guest-lime',
  paper: 'bg-guest-paper',
}

/** The hash Avatar has always coloured a guest by: their name, character by character. */
export function nameHash(name: string): number {
  return Array.from(name).reduce((h, ch) => (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0, 7)
}

/**
 * What the database's clean_name drops, as code point ranges: control,
 * invisible and direction characters. The emoji joiner and style selectors
 * stay, for emoji.
 */
const INVISIBLE: readonly (readonly [number, number])[] = [
  [0x1, 0x8], [0xe, 0x1f], [0x7f, 0x84], [0x86, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160],
  [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f],
  [0x2800, 0x2800], [0x3164, 0x3164], [0xfe00, 0xfe0d], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfffb],
  [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe001f], [0xe0080, 0xe0fff],
]
/** A run of white space of any kind, which clean_name makes one plain space. */
const SPACES = /[\s\u0085]+/gu

/**
 * A name as the database stores it (clean_name in the v2 migration): composed
 * (NFC), invisible characters dropped, every run of white space one plain
 * space, the ends trimmed. A stored name is already clean, so this changes
 * only what a guest is still typing.
 */
export function cleanName(name: string): string {
  const seen = Array.from(name.normalize('NFC')).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0
    return !INVISIBLE.some(([from, to]) => code >= from && code <= to)
  })
  return seen.join('').replace(SPACES, ' ').trim()
}

/**
 * A guest's colour and piece, one of the 18 pairs, from their name as the
 * database stores it, so the join form's preview shows the look the guest
 * gets. The one place they come from, so every screen agrees. Two guests can
 * share a pair: a small token always has the name beside it.
 */
export function guestLook(name: string): GuestLook {
  const pair = nameHash(cleanName(name)) % (GUEST_COLORS.length * GUEST_PIECES.length)
  return {
    color: GUEST_COLORS[pair % GUEST_COLORS.length],
    piece: GUEST_PIECES[Math.floor(pair / GUEST_COLORS.length)],
  }
}

/** What breaks a name: a hyphen, or the Unicode hyphens (U+2010, U+2011) a phone keyboard may type. */
const HYPHENS = /([-‐‑])/g

/**
 * The first name a token of 96 px and up shows, one line per part: the whole
 * first word, never cut short, broken after each hyphen (Marie- and Louise).
 * No lines when the name has no word.
 */
export function slateLines(name: string): string[] {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first.normalize('NFC').replace(HYPHENS, '$1\n').split('\n').filter(Boolean)
}

/**
 * Archivo's advance widths at the slate's instance (62 percent wide, weight
 * 900), in thousandths of an em, measured in Chrome from
 * @fontsource-variable/archivo 5.3. A letter with an accent takes its base
 * letter's width (é is e), as Archivo draws them. Kerning only ever narrows
 * a word, so a sum of these is never short.
 */
const ADVANCE: Record<string, number> = {
  a: 443, b: 440, c: 421, d: 440, e: 428, f: 287, g: 415, h: 437, i: 228, j: 232, k: 462, l: 228, m: 649,
  n: 437, o: 433, p: 440, q: 440, r: 296, s: 400, t: 293, u: 437, v: 414, w: 638, x: 448, y: 408, z: 383,
  A: 530, B: 498, C: 513, D: 509, E: 462, F: 402, G: 543, H: 513, I: 263, J: 453, K: 510, L: 432, M: 705,
  N: 518, O: 554, P: 485, Q: 554, R: 509, S: 469, T: 475, U: 503, V: 490, W: 729, X: 500, Y: 481, Z: 475,
  '0': 444, '1': 371, '2': 427, '3': 440, '4': 435, '5': 437, '6': 445, '7': 396, '8': 432, '9': 445,
  æ: 642, ø: 433, ß: 483, ð: 433, þ: 440, đ: 440, ħ: 437, ı: 228, ĳ: 460, ĸ: 462, ŀ: 228, ł: 228, ŋ: 437, œ: 656, ŧ: 293,
  Æ: 740, Ø: 554, Ð: 509, Þ: 480, Đ: 509, Ħ: 513, Ĳ: 716, Ŀ: 432, Ł: 432, Ŋ: 518, Œ: 760, Ŧ: 475,
  '-': 240, '‐': 240, '‑': 240, "'": 213, '’': 204, '‘': 204, '.': 222, '·': 210,
}
/** Any other character (another script, an emoji) comes from a fallback face: counted wider than any of Archivo's. */
const OTHER_ADVANCE = 1300

/** A line's width in em at the slate's instance. */
function lineWidth(line: string): number {
  return Array.from(line).reduce((sum, ch) => sum + (ADVANCE[ch] ?? ADVANCE[ch.normalize('NFD')[0]] ?? OTHER_ADVANCE), 0) / 1000
}

/** The slate's lines are this far apart, in em: Archivo's tight on-air setting. */
export const SLATE_LINE_HEIGHT = 0.9
/** The slate is tilted this many degrees, rising to the right, like a name slate held up to the camera. */
export const SLATE_TILT_DEG = 4
/** The tilted lines may take this share of the token's width and height, which keeps them clear of its corners. */
const SLATE_ROOM = 0.78
/** A short name (Bo, Ida) stops at this share of the token's width, so it doesn't shout. */
const SLATE_LARGEST = 0.58

/**
 * The slate's font size as a share of the token's width: the largest at which
 * every line, tilted, fits inside SLATE_ROOM of the token both ways, and never
 * above SLATE_LARGEST. Avatar sets it in container units, so it holds at any
 * size a call site gives the token.
 */
export function slateSize(lines: readonly string[]): number {
  if (lines.length === 0) return 0
  const width = Math.max(...lines.map(lineWidth))
  const height = lines.length * SLATE_LINE_HEIGHT
  const tilt = (SLATE_TILT_DEG * Math.PI) / 180
  const [cos, sin] = [Math.cos(tilt), Math.sin(tilt)]
  return Math.min(SLATE_LARGEST, SLATE_ROOM / (width * cos + height * sin), SLATE_ROOM / (width * sin + height * cos))
}
