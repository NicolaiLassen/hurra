import { describe, expect, it, vi } from 'vitest'
import { countingUploads, encodeWithin, FULL_QUALITIES, fitWithin, gameMediaUrl, jpegHasMetadata, thumbPath } from './media'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    },
  },
}))

const bytes = (text: string) => [...text].map((c) => c.charCodeAt(0))
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const APP0 = segment(0xe0, [...bytes('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
const DQT = segment(0xdb, [0, ...Array.from({ length: 64 }, () => 1)])
const EXIF = segment(0xe1, [...bytes('Exif'), 0, 0, ...bytes('MM'), 0, 42, 0, 0, 0, 8])
const COM = segment(0xfe, bytes('prompt: Mads and Ida, fused portrait'))
const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0])

/** A tiny JPEG: SOI, the given header segments, a scan and EOI. */
function jpeg(...segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...SOS, 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])
}

describe('fitWithin', () => {
  it('scales the long edge down to the limit, keeping the shape', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(1601, 1, 1600)).toEqual({ width: 1600, height: 1 })
    expect(fitWithin(1600, 900, 400)).toEqual({ width: 400, height: 225 })
  })

  it('never scales up, and never returns a 0 side', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10_000, 1, 400)).toEqual({ width: 400, height: 1 })
  })
})

describe('encodeWithin', () => {
  const blob = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

  it('steps the quality down from 0.82 until the image is under the limit', async () => {
    const sizes: Record<number, number> = { 0.82: 610_000, 0.76: 480_000, 0.7: 390_000, 0.65: 350_000, 0.6: 300_000 }
    const tried: number[] = []
    const result = await encodeWithin(async (quality) => (tried.push(quality), blob(sizes[quality])), 400_000)
    expect(tried).toEqual([0.82, 0.76, 0.7])
    expect(result.size).toBe(390_000)
  })

  it('stops at the first quality that fits', async () => {
    const encode = vi.fn(async () => blob(280_000))
    expect((await encodeWithin(encode, 400_000)).size).toBe(280_000)
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('keeps the last step (0.6) when nothing fits', async () => {
    const tried: number[] = []
    const result = await encodeWithin(async (quality) => (tried.push(quality), blob(900_000)), 400_000)
    expect(tried).toEqual([...FULL_QUALITIES])
    expect(tried[tried.length - 1]).toBe(0.6)
    expect(result.size).toBe(900_000)
  })
})

describe('jpegHasMetadata', () => {
  it('finds an EXIF (APP1) segment and a comment (COM) segment', () => {
    expect(jpegHasMetadata(jpeg(APP0, EXIF, DQT))).toBe(true)
    expect(jpegHasMetadata(jpeg(APP0, DQT, COM))).toBe(true)
    // Fill bytes before a marker are allowed.
    expect(jpegHasMetadata(Uint8Array.from([0xff, 0xd8, 0xff, ...COM, ...SOS, 0xff, 0xd9]))).toBe(true)
  })

  it('passes a clean, re-encoded JPEG', () => {
    expect(jpegHasMetadata(jpeg(APP0, DQT))).toBe(false)
    expect(jpegHasMetadata(jpeg())).toBe(false)
  })

  it('looks only at the header: bytes inside the image data are not segments', () => {
    const inScan = Uint8Array.from([0xff, 0xd8, ...APP0, ...SOS, 0xff, 0x00, 0xff, 0xe1, 0x00, 0x04, 0, 0, 0xff, 0xd9])
    expect(jpegHasMetadata(inScan)).toBe(false)
  })

  it('answers false for something that is not a JPEG, or is cut short', () => {
    expect(jpegHasMetadata(Uint8Array.from(bytes('\x89PNG\r\n')))).toBe(false)
    expect(jpegHasMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(false)
    expect(jpegHasMetadata(new Uint8Array())).toBe(false)
  })
})

describe('paths and URLs', () => {
  it('puts the thumbnail beside the full image', () => {
    expect(thumbPath('s/g/2f1c.jpg')).toBe('s/g/2f1c.thumb.jpg')
    expect(thumbPath('s/g/2f1c.thumb.jpg')).toBe('s/g/2f1c.thumb.jpg')
  })

  it('gives the public URL of the full image, or of its thumbnail', () => {
    expect(gameMediaUrl('s/g/2f1c.jpg')).toBe('http://127.0.0.1:54321/storage/v1/object/public/game-media/s/g/2f1c.jpg')
    expect(gameMediaUrl('s/g/2f1c.jpg', 'thumb')).toBe('http://127.0.0.1:54321/storage/v1/object/public/game-media/s/g/2f1c.thumb.jpg')
  })
})

describe('countingUploads', () => {
  // The settings form keeps Save off while this count is above 0 (an image's path arrives only when its upload ends).
  it('counts uploads in flight, and each one leaves the count as it ends, whether it worked or not', async () => {
    let inFlight = 0
    const counts: number[] = []
    const pending: { resolve: (path: string) => void; reject: (error: Error) => void }[] = []
    const upload = countingUploads(
      () => new Promise<string>((resolve, reject) => void pending.push({ resolve, reject })),
      (change) => void counts.push((inFlight += change)),
    )
    const first = upload(new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    const second = upload(new File(['b'], 'b.jpg', { type: 'image/jpeg' }))
    expect(inFlight).toBe(2)

    pending[0].resolve('s/g/one.jpg')
    // The count is down by the time the caller has the path, so the form sees both in one go.
    await expect(first).resolves.toBe('s/g/one.jpg')
    expect(inFlight).toBe(1)

    pending[1].reject(new Error("That image couldn't be uploaded"))
    await expect(second).rejects.toThrow("That image couldn't be uploaded")
    expect(inFlight).toBe(0)
    expect(counts).toEqual([1, 2, 1, 0])
  })

  it('leaves the count at 0 when an upload fails at once (an image this browser cannot read)', async () => {
    let inFlight = 0
    const upload = countingUploads(
      async () => {
        throw new Error("This image can't be read here. Use a JPEG or PNG.")
      },
      (change) => void (inFlight += change),
    )
    await expect(upload(new File(['x'], 'x.heic'))).rejects.toThrow("can't be read here")
    expect(inFlight).toBe(0)
  })
})
