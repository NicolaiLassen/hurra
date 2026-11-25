// Dev builds only: the fixtures' fused pictures (src/lib/fixtures.ts) are
// paths under fixture/, which gameMediaUrl turns into a drawn picture here, so
// the fixture scenes show images with no storage behind them. A production
// build never meets such a path, and drops this file with the branch that
// calls it (import.meta.env.DEV).

/** The prefix of a sample path: `fixture/fusion-3.jpg`. */
export const SAMPLE_PREFIX = 'fixture/'

/** Whether a game-media path is one of the fixtures' samples. */
export const isSamplePath = (path: string) => path.startsWith(SAMPLE_PREFIX)

/**
 * A head and shoulders in two hues, blended across the face, as a 4:5 SVG
 * data URL: a stand-in for a fused portrait. The hues come from the number in
 * the path, never from a name, so a sample says nothing about who is in it.
 * The thumbnail is the same drawing at a quarter of the size, as a real
 * thumbnail keeps its image's shape.
 */
export function samplePicture(path: string, size: 'full' | 'thumb' = 'full'): string {
  const n = Number(/(\d+)\D*$/.exec(path)?.[1] ?? 0)
  const left = (n * 47 + 12) % 360
  const right = (left + 150) % 360
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
