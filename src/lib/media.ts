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
import { GameCallError, newRequestId } from '@/lib/gameApi'
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

/**
 * Wraps an upload so `count` follows the uploads in flight: +1 as one starts,
 * -1 as it ends, whether it worked or not. An image's path reaches a settings
 * form only when its upload ends, so the form waits for these.
 */
export function countingUploads<T>(upload: (file: File) => Promise<T>, count: (change: 1 | -1) => void): (file: File) => Promise<T> {
  return async (file) => {
    count(1)
    try {
      return await upload(file)
    } finally {
      count(-1)
    }
  }
}

/** The public URL of a game-media path. Phones use 'thumb' (with loading="lazy"); the TV uses 'full'. */
export function gameMediaUrl(path: string, size: 'full' | 'thumb' = 'full'): string {
  return supabase.storage.from(GAME_MEDIA_BUCKET).getPublicUrl(size === 'thumb' ? thumbPath(path) : path).data.publicUrl
}

// Guest photos (docs/guest-photos.md) -------------------------------------------------
// One small square JPEG per photo: a 320 px avatar needs no thumbnail. Drawing
// onto a canvas drops every metadata block (EXIF, GPS), as for game media.
// Paths are <session id>/<player id>/<random uuid>.jpg: a new one for every
// upload, so a file never changes and no cache ever shows an old photo.

export const PLAYER_PHOTOS_BUCKET = 'player-photos'
/** The side of a stored photo: the TV's biggest avatar is 144 px, and a 2x screen doubles it. */
export const PHOTO_EDGE = 320
/** The quality steps down from 0.82 until a photo is under this (about 25 KB for a face). */
export const PHOTO_MAX_BYTES = 48_000
/** 0.82 first, down to 0.6 for most pictures; 0.5 and 0.4 only for a picture of pure noise. */
export const PHOTO_QUALITIES = [0.82, 0.76, 0.7, 0.65, 0.6, 0.5, 0.4] as const
/** set_my_photo refuses a stored file over this (48 KB), so preparePhoto never returns one. The bucket takes 64 KB. */
export const PHOTO_LIMIT_BYTES = 49_152
/** Where the square sits in a tall picture: 0 is the top, 0.5 the middle; a face is usually a little above it. */
export const PHOTO_CROP_FROM_TOP = 0.35
/** How long one upload may take before it counts as lost: a stalled connection never fails by itself. */
export const PHOTO_UPLOAD_TIMEOUT_MS = 15_000
export const UNREADABLE_PHOTO = "This photo can't be read here. Try another one, or take a selfie."

/** The largest square of a picture (centred across, PHOTO_CROP_FROM_TOP down) and the side it is drawn at: never larger than the square. */
export function squareCrop(width: number, height: number, edge = PHOTO_EDGE): { sx: number; sy: number; side: number; size: number } {
  const side = Math.min(width, height)
  return {
    sx: Math.round((width - side) / 2),
    sy: Math.round((height - side) * PHOTO_CROP_FROM_TOP),
    side,
    size: Math.max(1, Math.min(edge, side)),
  }
}

/** The square of `source` at (sx, sy), `side` wide, drawn `size` wide on the night sky (transparent parts land on it). */
function drawSquare(source: CanvasImageSource, sx: number, sy: number, side: number, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error(UNREADABLE_PHOTO)
  context.fillStyle = BACKDROP
  context.fillRect(0, 0, size, size)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, sx, sy, side, side, 0, 0, size, size)
  return canvas
}

/**
 * The re-encoding for a guest photo: the square (centred across,
 * PHOTO_CROP_FROM_TOP down), at most 320 px, a JPEG under 48 KB (quality 0.82
 * stepping down), every metadata block gone. Throws UNREADABLE_PHOTO for a
 * file this browser can't decode, and for the picture that is still over
 * PHOTO_LIMIT_BYTES at 0.4 (none is, in practice).
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  let image: Decoded
  try {
    image = await decode(file)
  } catch {
    throw new Error(UNREADABLE_PHOTO)
  }
  try {
    if (!(image.width > 0 && image.height > 0)) throw new Error(UNREADABLE_PHOTO)
    const crop = squareCrop(image.width, image.height)
    // A camera photo goes down in two steps, to twice the size first: one big step looks grainy.
    const twice = crop.size * 2
    const canvas =
      crop.side > twice
        ? drawSquare(drawSquare(image.source, crop.sx, crop.sy, crop.side, twice), 0, 0, twice, crop.size)
        : drawSquare(image.source, crop.sx, crop.sy, crop.side, crop.size)
    const photo = await encodeWithin((quality) => toJpeg(canvas, quality), PHOTO_MAX_BYTES, PHOTO_QUALITIES)
    if (photo.size > PHOTO_LIMIT_BYTES) throw new Error(UNREADABLE_PHOTO)
    return photo
  } finally {
    image.release()
  }
}

/** <session id>/<player id>/<new uuid>.jpg. */
export function playerPhotoPath(sessionId: string, playerId: string, id: string = newRequestId()): string {
  return `${sessionId}/${playerId}/${id}.jpg`
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PHOTO_PATH = new RegExp(`^${UUID}/${UUID}/${UUID}\\.jpg$`)
/** The photo shape, as is_photo_path checks it (the database also checks the party and the player). */
export const isPlayerPhotoPath = (path: string) => PHOTO_PATH.test(path)

const PHOTO_UPLOAD = { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' } as const

/** A Storage error as a GameCallError: the status from the body's statusCode (403, 409, 413, 415), 0 when nothing answered. */
export function storageFailure(error: unknown): GameCallError {
  const e = (error ?? {}) as { name?: string; message?: string; statusCode?: string; status?: number; code?: string }
  const status = /^\d{3}$/.test(e.statusCode ?? '') ? Number(e.statusCode) : (e.status ?? 0)
  if (e.name === 'StorageUnknownError' || status === 0) {
    return new GameCallError("Couldn't reach the party. Check your connection and try again.", 0, 'unavailable')
  }
  return new GameCallError(e.message || `Storage answered ${status}`, status, e.code ?? String(status))
}

/** What an upload that took longer than PHOTO_UPLOAD_TIMEOUT_MS answers: a network failure (status 0). */
const LATE = { data: null, error: { name: 'StorageUnknownError', message: 'The upload took too long' } }

/**
 * Uploads one prepared photo: no upsert, cached an hour. An attempt that
 * fails on the network, or takes longer than 15 s, is tried once more after
 * 1 s, to the same path. storage-js takes no abort signal, so a slow attempt
 * is let go, not cancelled: if it lands later, the retry's 409 counts as
 * uploaded, and an orphan goes with the next save's clean-up or the
 * after-party script. A 409 counts as uploaded: every pick has a new uuid, so
 * a file already at this path is this phone's own earlier attempt, whose
 * answer was lost.
 */
export async function uploadPlayerPhoto(path: string, photo: Blob): Promise<void> {
  const bucket = supabase.storage.from(PLAYER_PHOTOS_BUCKET)
  for (let attempt = 1; ; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<typeof LATE>((resolve) => (timer = setTimeout(() => resolve(LATE), PHOTO_UPLOAD_TIMEOUT_MS)))
    const { error } = await Promise.race([bucket.upload(path, photo, PHOTO_UPLOAD), late]).finally(() => clearTimeout(timer))
    if (!error) return
    const failure = storageFailure(error)
    if (failure.status === 409) return
    if (failure.status !== 0 || attempt === 2) throw failure
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/** The photos in a player's folder, as paths: what its owner, or a host, may see and delete. */
export async function listPlayerPhotos(sessionId: string, playerId: string): Promise<string[]> {
  const folder = `${sessionId}/${playerId}`
  const { data, error } = await supabase.storage.from(PLAYER_PHOTOS_BUCKET).list(folder, { limit: 100 })
  if (error) throw storageFailure(error)
  return (data ?? []).map((file) => `${folder}/${file.name}`).filter(isPlayerPhotoPath)
}

const PLAYER_FOLDER = new RegExp(`^${UUID}$`)

/** Every photo of a party, as paths, folder by folder: what a host may see and delete. */
export async function listPartyPhotos(sessionId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(PLAYER_PHOTOS_BUCKET).list(sessionId, { limit: 1000 })
  if (error) throw storageFailure(error)
  const folders = (data ?? []).map((entry) => entry.name).filter((name) => PLAYER_FOLDER.test(name))
  return (await Promise.all(folders.map((playerId) => listPlayerPhotos(sessionId, playerId)))).flat()
}

/**
 * Deletes photos by path through the Storage API, 100 at a time. Never throws,
 * not even when there is no storage client (a test's): a file left behind
 * goes with the after-party script.
 */
export async function removePlayerPhotos(paths: readonly string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    try {
      await supabase.storage.from(PLAYER_PHOTOS_BUCKET).remove(paths.slice(i, i + 100))
    } catch {
      // Left for the after-party script (docs/guest-photos.md, 11).
    }
  }
}

/** The public URL of a player-photos path. */
export function playerPhotoUrl(path: string): string {
  return supabase.storage.from(PLAYER_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl
}
