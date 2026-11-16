// The app's two faces (src/index.css, docs/identity.md): Archivo, the on-air
// voice, and Schibsted Grotesk for reading. index.html preloads Archivo's Latin
// file, so it downloads with the page; this module loads both faces into the
// document while the first open's loader is still up, so the first screen (on
// the TV, maybe a game's title card) is drawn in them, never in a fallback face
// that then swaps.
import { holdLoader } from '@/lib/loader'

/** One weight of each face: a variable file carries every weight and width. */
export const FACES = ['900 1em "Archivo Variable"', '400 1em "Schibsted Grotesk Variable"'] as const

/**
 * How long the first open waits for the faces at most. On a line that slow the
 * screen shows in the fallback face and swaps to the real one when it lands.
 */
export const FONT_WAIT_MS = 3000

/** Keeps the loader up until both faces are loaded (or failed), or FONT_WAIT_MS has passed. */
export function holdLoaderForFonts({
  fonts = globalThis.document?.fonts,
  hold = holdLoader,
  waitMs = FONT_WAIT_MS,
}: { fonts?: Pick<FontFaceSet, 'load'>; hold?: () => () => void; waitMs?: number } = {}): void {
  if (!fonts) return
  const release = hold()
  const timer = setTimeout(release, waitMs)
  Promise.allSettled(FACES.map((face) => fonts.load(face))).then(() => {
    clearTimeout(timer)
    release()
  })
}
