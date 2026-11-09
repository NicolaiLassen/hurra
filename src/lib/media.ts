// Game media: fusion pictures and anything else a game shows (docs/engine-v2.md,
// 5.8 and 2.11). The pictures go to 45 phones over the venue's one connection,
// so nothing is uploaded raw: the browser decodes the file, draws it onto a
// canvas and encodes a JPEG (a 1600 px long edge of about 300 KB, and a 400 px
// thumbnail of about 30 KB). Drawing onto a canvas drops every metadata block
// (EXIF, GPS, PNG text chunks), and AI images often carry the prompt or the
// input file names, and so who is in the picture, in exactly those.
//
// Paths are <session id>/<game id>/<random uuid>.jpg with the thumbnail beside
// it as <uuid>.thumb.jpg, so a file name never says who is in a picture. Only
// hosts upload; everyone reads through the bucket's public URL.
import { newRequestId } from '@/lib/gameApi'
import { supabase } from '@/lib/supabase'

export const GAME_MEDIA_BUCKET = 'game-media'

const FULL_EDGE = 1600
const THUMB_EDGE = 400
const FULL_MAX_BYTES = 400_000
/** 0.82 first, stepping down to 0.6 until the full image is under 400 KB. */
export const FULL_QUALITIES = [0.82, 0.76, 0.7, 0.65, 0.6] as const
const THUMB_QUALITY = 0.8
/** Transparent parts of a PNG land on the night sky, not on black. */
const BACKDROP = '#0f0d1a'

export const UNREADABLE_IMAGE = "This image can't be read here. Use a JPEG or PNG."

/** The size that fits within `longEdge` on its longer side, never larger than the original. */
export function fitWithin(width: number, height: number, longEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  const scale = longest > longEdge ? longEdge / longest : 1
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Whether JPEG bytes still hold an EXIF or XMP (APP1) or a comment (COM) segment before the image data. */
export function jpegHasMetadata(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let i = 2
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return false
    const marker = bytes[i + 1]
    if (marker === 0xff) {
      // Fill byte before a marker.
      i++
      continue
    }
    // Start of scan or end of image: the header segments are over.
    if (marker === 0xda || marker === 0xd9) return false
    // Markers without a length: restart markers and TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker === 0xe1 || marker === 0xfe) return true
    if (i + 3 >= bytes.length) return false
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (length < 2) return false
    i += 2 + length
  }
  return false
}

/** Encodes with each quality in turn until the result is under `maxBytes`; the last quality's result is kept whatever its size. */
export async function encodeWithin(
  encode: (quality: number) => Promise<Blob>,
  maxBytes: number,
  qualities: readonly number[] = FULL_QUALITIES,
): Promise<Blob> {
  let blob: Blob | undefined
  for (const quality of qualities) {
    blob = await encode(quality)
    if (blob.size < maxBytes) return blob
  }
  if (!blob) throw new Error('No quality to encode with')
  return blob
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void }

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // Safari reads HEIC in an <img> but not always as a bitmap: try that next.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error(UNREADABLE_IMAGE)
  }
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error(UNREADABLE_IMAGE)
  context.fillStyle = BACKDROP
  context.fillRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_IMAGE))), 'image/jpeg', quality),
  )
}

/** The re-encoding: canvas drawing drops every metadata block (EXIF, GPS, PNG text chunks). */
export async function prepareImage(file: File): Promise<{ full: Blob; thumb: Blob }> {
  const image = await decode(file)
  try {
    if (!(image.width > 0 && image.height > 0)) throw new Error(UNREADABLE_IMAGE)
    const size = fitWithin(image.width, image.height, FULL_EDGE)
    const canvas = draw(image.source, size.width, size.height)
    const full = await encodeWithin((quality) => toJpeg(canvas, quality), FULL_MAX_BYTES)
    // The thumbnail comes from the already scaled image: two steps down look better than one big one.
    const thumbSize = fitWithin(size.width, size.height, THUMB_EDGE)
    const thumb = await toJpeg(draw(canvas, thumbSize.width, thumbSize.height), THUMB_QUALITY)
    return { full, thumb }
  } finally {
    image.release()
  }
}

/** <uuid>.jpg to <uuid>.thumb.jpg. */
export const thumbPath = (path: string) => path.replace(/(\.thumb)?\.jpg$/i, '.thumb.jpg')

/**
 * prepareImage, then uploads <session>/<game>/<uuid>.jpg and <uuid>.thumb.jpg
 * (no upsert). Returns the full image's path, for the settings. Hosts only.
 */
export async function uploadGameMedia(sessionId: string, gameId: string, file: File): Promise<string> {
  const { full, thumb } = await prepareImage(file)
  const path = `${sessionId}/${gameId}/${newRequestId()}.jpg`
  const bucket = supabase.storage.from(GAME_MEDIA_BUCKET)
  // The uuid makes every path new, so the files never change: cache them for a year.
  const options = { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }
  const uploaded = await bucket.upload(path, full, options)
  if (uploaded.error) throw new Error(uploaded.error.message)
  const uploadedThumb = await bucket.upload(thumbPath(path), thumb, options)
  if (uploadedThumb.error) {
    // No half-uploaded picture left behind.
    await bucket.remove([path]).catch(() => undefined)
    throw new Error(uploadedThumb.error.message)
  }
  return path
}

/** The public URL of a game-media path. Phones use 'thumb' (with loading="lazy"); the TV uses 'full'. */
export function gameMediaUrl(path: string, size: 'full' | 'thumb' = 'full'): string {
  return supabase.storage.from(GAME_MEDIA_BUCKET).getPublicUrl(size === 'thumb' ? thumbPath(path) : path).data.publicUrl
}
