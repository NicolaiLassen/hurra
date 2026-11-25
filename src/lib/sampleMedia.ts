// Dev builds only: the fixtures' fused pictures (src/lib/fixtures.ts) are
// paths under fixture/, which gameMediaUrl turns into a drawn picture here, so
// the fixture scenes show images with no storage behind them. A production
// build never meets such a path, and drops this file with the branch that
// calls it (import.meta.env.DEV).

/** The prefix of a sample path: `fixture/fusion-3.jpg`. */
export const SAMPLE_PREFIX = 'fixture/'

/** Whether a game-media path is one of the fixtures' samples. */
export const isSamplePath = (path: string) => path.startsWith(SAMPLE_PREFIX)

/** A sample original: one of the two people in picture n, `fixture/original-4-1.jpg` (1 or 2). */
const ORIGINAL = /original-(\d+)-([12])\D*$/

/** The two hues of picture n's sample: the first person's on the left, the second's on the right. */
const huesOf = (n: number) => {
  const left = (n * 47 + 12) % 360
  return [left, (left + 150) % 360] as const
}

/**
 * A head and shoulders in two hues, blended across the face, as a 4:5 SVG
 * data URL: a stand-in for a fused portrait. The hues come from the number in
 * the path, never from a name, so a sample says nothing about who is in it.
 * The thumbnail is the same drawing at a quarter of the size, as a real
 * thumbnail keeps its image's shape.
 */
export function samplePicture(path: string, size: 'full' | 'thumb' = 'full'): string {
  const original = ORIGINAL.exec(path)
  if (original) return sampleOriginal(Number(original[1]), Number(original[2]) as 1 | 2, size)
  const n = Number(/(\d+)\D*$/.exec(path)?.[1] ?? 0)
  const [left, right] = huesOf(n)
  const [width, height] = size === 'thumb' ? [320, 400] : [1280, 1600]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 80 100">` +
    '<defs>' +
    `<linearGradient id="f" x1="0" x2="1"><stop offset="0.3" stop-color="hsl(${left} 62% 74%)"/><stop offset="0.7" stop-color="hsl(${right} 62% 74%)"/></linearGradient>` +
    `<linearGradient id="b" x1="0" x2="1"><stop offset="0" stop-color="hsl(${left} 38% 26%)"/><stop offset="1" stop-color="hsl(${right} 38% 26%)"/></linearGradient>` +
    `<linearGradient id="s" x1="0" x2="1"><stop offset="0.2" stop-color="hsl(${left} 52% 52%)"/><stop offset="0.8" stop-color="hsl(${right} 52% 52%)"/></linearGradient>` +
    '</defs>' +
    '<rect width="80" height="100" fill="url(#b)"/>' +
    '<ellipse cx="40" cy="40" rx="17" ry="21" fill="url(#f)"/>' +
    '<path d="M6 100c0-20 15-33 34-33s34 13 34 33z" fill="url(#s)"/>' +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * One of the two people of picture n's sample, as their own photo: a head and
 * shoulders in that person's one hue (the left half of the fused sample for
 * the first, the right for the second), as a 3:4 portrait, the shape of a
 * phone's photo, with a lighter wall behind so the square crop shows.
 */
function sampleOriginal(n: number, person: 1 | 2, size: 'full' | 'thumb'): string {
  const hue = huesOf(n)[person - 1]
  const [width, height] = size === 'thumb' ? [300, 400] : [1200, 1600]
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 75 100">` +
    `<rect width="75" height="100" fill="hsl(${hue} 30% 40%)"/>` +
    `<rect y="62" width="75" height="38" fill="hsl(${hue} 34% 30%)"/>` +
    `<ellipse cx="37.5" cy="38" rx="15" ry="19" fill="hsl(${hue} 62% 74%)"/>` +
    `<path d="M6 100c0-19 14-31 31.5-31s31.5 12 31.5 31z" fill="hsl(${hue} 52% 52%)"/>` +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
