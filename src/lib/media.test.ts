import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameCallError } from './gameApi'
import {
  countingUploads,
  encodeWithin,
  FULL_QUALITIES,
  fitWithin,
  gameMediaUrl,
  isPlayerPhotoPath,
  jpegHasMetadata,
  listPartyPhotos,
  PHOTO_QUALITIES,
  playerPhotoPath,
  playerPhotoUrl,
  preparePhoto,
  removePlayerPhotos,
  squareCrop,
  storageFailure,
  thumbPath,
  UNREADABLE_PHOTO,
  uploadPlayerPhoto,
} from './media'

type StorageAnswer = { data: unknown; error: unknown }
type StorageState = {
  calls: unknown[][]
  upload: () => Promise<StorageAnswer>
  list: (folder: string) => Promise<StorageAnswer>
  remove: (paths: string[]) => Promise<StorageAnswer>
}

/** A stand-in for supabase-js's storage: every call is recorded, and the state's functions answer it. */
const storage = vi.hoisted(() => {
  const state: StorageState = {
    calls: [],
    upload: async () => ({ data: { path: '' }, error: null }),
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ data: [], error: null }),
  }
  const bucket = (name: string) => ({
    getPublicUrl: (path: string) => ({ data: { publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/${name}/${path}` } }),
    upload: (path: string, body: Blob, options: unknown) => {
      state.calls.push(['upload', name, path, body, options])
      return state.upload()
    },
    list: (folder: string, options: unknown) => {
      state.calls.push(['list', name, folder, options])
      return state.list(folder)
    },
    remove: (paths: string[]) => {
      state.calls.push(['remove', name, paths])
      return state.remove(paths)
    },
  })
  const client: { storage?: { from: typeof bucket } } = { storage: { from: bucket } }
  return { state, client, bucket }
})

vi.mock('@/lib/supabase', () => ({ supabase: storage.client }))

const defaults = { ...storage.state }
beforeEach(() => {
  Object.assign(storage.state, defaults, { calls: [] })
  storage.client.storage = { from: storage.bucket }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const SESSION = '0b6a7c1e-5d2f-4b8a-9c3d-2e1f0a9b8c7d'
const PLAYER = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
const FILE = '3c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f'

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

  it('steps a guest photo down from 0.82 to 0.4 and no further', async () => {
    const tried: number[] = []
    const result = await encodeWithin(async (quality) => (tried.push(quality), blob(60_000)), 48_000, PHOTO_QUALITIES)
    expect(tried).toEqual([0.82, 0.76, 0.7, 0.65, 0.6, 0.5, 0.4])
    expect(result.size).toBe(60_000)
    // A face fits at once.
    expect((await encodeWithin(async () => blob(25_000), 48_000, PHOTO_QUALITIES)).size).toBe(25_000)
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

describe('squareCrop', () => {
  it('takes the largest square, centred across and 0.35 of the spare height down, drawn at most 320 px', () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000, size: 320 })
    // 0.35 of the 1000 px to spare: a face sits a little above the middle.
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 350, side: 3000, size: 320 })
    expect(squareCrop(2250, 4000)).toEqual({ sx: 0, sy: 613, side: 2250, size: 320 })
    expect(squareCrop(1000, 1000)).toEqual({ sx: 0, sy: 0, side: 1000, size: 320 })
  })

  it('never scales a small picture up, and never returns a 0 side', () => {
    expect(squareCrop(200, 100)).toEqual({ sx: 50, sy: 0, side: 100, size: 100 })
    expect(squareCrop(1, 1)).toEqual({ sx: 0, sy: 0, side: 1, size: 1 })
  })
})

describe('preparePhoto', () => {
  type FakeCanvas = { width: number; height: number; drawn: unknown[][] }

  /** Canvases that record what is drawn on them and encode `bytesAt(quality)` bytes, and the qualities asked for. */
  function stubCanvas(bytesAt: (quality: number) => number) {
    const canvases: FakeCanvas[] = []
    const qualities: number[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const drawn: unknown[][] = []
        const canvas = {
          width: 0,
          height: 0,
          drawn,
          getContext: () => ({ fillRect: () => undefined, drawImage: (...args: unknown[]) => void drawn.push(args) }),
          toBlob: (done: (blob: Blob) => void, type: string, quality: number) => {
            qualities.push(quality)
            done(new Blob([new Uint8Array(bytesAt(quality))], { type }))
          },
        }
        canvases.push(canvas)
        return canvas
      },
    })
    return { canvases, qualities }
  }

  function stubBitmap(width: number, height: number) {
    const bitmap = { width, height, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', async () => bitmap)
    return bitmap
  }

  it('draws a camera photo down in two steps, the square a little above the middle, to 320 px', async () => {
    const bitmap = stubBitmap(3000, 4000)
    const { canvases, qualities } = stubCanvas((quality) => (quality > 0.8 ? 52_000 : 26_000))
    const photo = await preparePhoto(new Blob(['camera file']))
    expect(canvases.map(({ width, height }) => [width, height])).toEqual([
      [640, 640],
      [320, 320],
    ])
    expect(canvases[0].drawn).toEqual([[bitmap, 0, 350, 3000, 3000, 0, 0, 640, 640]])
    expect(canvases[1].drawn).toEqual([[canvases[0], 0, 0, 640, 640, 0, 0, 320, 320]])
    expect(qualities).toEqual([0.82, 0.76])
    expect([photo.size, photo.type]).toEqual([26_000, 'image/jpeg'])
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('draws a small picture once, never larger than it is', async () => {
    const bitmap = stubBitmap(200, 100)
    const { canvases } = stubCanvas(() => 9_000)
    await preparePhoto(new Blob(['small']))
    expect(canvases).toHaveLength(1)
    expect(canvases[0].drawn).toEqual([[bitmap, 50, 0, 100, 100, 0, 0, 100, 100]])
  })

  it('keeps a photo just over 48 KB at 0.4, as set_my_photo takes up to 49,152 bytes', async () => {
    stubBitmap(1000, 1000)
    stubCanvas(() => 48_500)
    expect((await preparePhoto(new Blob(['busy']))).size).toBe(48_500)
  })

  it("says the photo can't be read for a file this browser can't decode, a picture with no size, and one over 49,152 bytes at 0.4", async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('InvalidStateError')
    })
    vi.stubGlobal(
      'Image',
      class {
        decoding = ''
        src = ''
        decode = async () => {
          throw new Error('EncodingError')
        }
      },
    )
    await expect(preparePhoto(new Blob(['heic']))).rejects.toThrow(UNREADABLE_PHOTO)

    const empty = stubBitmap(0, 0)
    await expect(preparePhoto(new Blob(['empty']))).rejects.toThrow(UNREADABLE_PHOTO)
    expect(empty.close).toHaveBeenCalledOnce()

    const noise = stubBitmap(1000, 1000)
    const { qualities } = stubCanvas(() => 50_000)
    await expect(preparePhoto(new Blob(['noise']))).rejects.toThrow(UNREADABLE_PHOTO)
    expect(qualities).toEqual([...PHOTO_QUALITIES])
    expect(noise.close).toHaveBeenCalledOnce()
  })
})

describe('guest photo paths and URLs', () => {
  it('makes <session>/<player>/<new uuid>.jpg, with a new uuid each time', () => {
    const first = playerPhotoPath(SESSION, PLAYER)
    const second = playerPhotoPath(SESSION, PLAYER)
    expect(first).toMatch(new RegExp(`^${SESSION}/${PLAYER}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`))
    expect(second).not.toBe(first)
    expect(isPlayerPhotoPath(first) && isPlayerPhotoPath(second)).toBe(true)
    expect(playerPhotoPath(SESSION, PLAYER, FILE)).toBe(`${SESSION}/${PLAYER}/${FILE}.jpg`)
  })

  it('knows only the photo shape, as is_photo_path does', () => {
    expect(isPlayerPhotoPath(`${SESSION}/${PLAYER}/${FILE}.jpg`)).toBe(true)
    for (const path of [
      `${SESSION.toUpperCase()}/${PLAYER}/${FILE}.jpg`,
      `${SESSION}/${PLAYER}/${FILE.toUpperCase()}.jpg`,
      `${SESSION}/${PLAYER}/${FILE}.JPG`,
      `${SESSION}/${PLAYER}/${FILE}.png`,
      `${SESSION}/${PLAYER}/${FILE}.jpeg`,
      `${SESSION}/${PLAYER}/x/${FILE}.jpg`,
      `${PLAYER}/${FILE}.jpg`,
      `${SESSION}/${PLAYER}/../${FILE}.jpg`,
      `../${PLAYER}/${FILE}.jpg`,
      '',
    ]) {
      expect(isPlayerPhotoPath(path), path).toBe(false)
    }
  })

  it('gives the public URL of a photo', () => {
    expect(playerPhotoUrl(`${SESSION}/${PLAYER}/${FILE}.jpg`)).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/player-photos/${SESSION}/${PLAYER}/${FILE}.jpg`,
    )
  })
})

describe('storageFailure', () => {
  it("takes the status from the body's statusCode, and Storage's own code when it gives one", () => {
    const refused = storageFailure({ name: 'StorageApiError', message: 'new row violates row-level security policy', status: 400, statusCode: '403' })
    expect(refused).toBeInstanceOf(GameCallError)
    expect([refused.status, refused.code, refused.message]).toEqual([403, '403', 'new row violates row-level security policy'])
    const typed = storageFailure({ name: 'StorageApiError', message: 'mime type image/png is not supported', status: 400, statusCode: '415', code: 'InvalidMimeType' })
    expect([typed.status, typed.code]).toEqual([415, 'InvalidMimeType'])
    // No status in the body: the HTTP status.
    expect(storageFailure({ name: 'StorageApiError', message: 'Bad gateway', status: 502, statusCode: 'BadGateway' }).status).toBe(502)
    expect(storageFailure({ name: 'StorageApiError', message: '', status: 400, statusCode: '413' }).message).toBe('Storage answered 413')
  })

  it('makes a network failure, or no error at all, status 0 with the connection words', () => {
    for (const error of [{ name: 'StorageUnknownError', message: 'Load failed' }, { name: 'StorageApiError', message: 'Failed' }, null, undefined]) {
      const failure = storageFailure(error)
      expect([failure.status, failure.code, failure.message]).toEqual([0, 'unavailable', "Couldn't reach the party. Check your connection and try again."])
    }
  })
})

describe('uploadPlayerPhoto', () => {
  const PATH = `${SESSION}/${PLAYER}/${FILE}.jpg`
  const photo = new Blob([new Uint8Array(25_000)], { type: 'image/jpeg' })
  const refusedWith = (statusCode: string, message: string) => async () => ({ data: null, error: { name: 'StorageApiError', message, status: 400, statusCode } })
  const offline = async () => ({ data: null, error: { name: 'StorageUnknownError', message: 'Load failed' } })
  const paths = () => storage.state.calls.map((call) => call[2])

  it('uploads to player-photos as image/jpeg, with no upsert, cached an hour', async () => {
    await uploadPlayerPhoto(PATH, photo)
    expect(storage.state.calls).toEqual([['upload', 'player-photos', PATH, photo, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' }]])
  })

  it('counts a 409 as uploaded: the file at that path is its own earlier attempt', async () => {
    storage.state.upload = refusedWith('409', 'The resource already exists')
    await expect(uploadPlayerPhoto(PATH, photo)).resolves.toBeUndefined()
    expect(storage.state.calls).toHaveLength(1)
  })

  it('throws what Storage refused at once, with its status', async () => {
    storage.state.upload = refusedWith('413', 'The object exceeded the maximum allowed size')
    const error = (await uploadPlayerPhoto(PATH, photo).catch((e: unknown) => e)) as GameCallError
    expect([error.status, error.message]).toEqual([413, 'The object exceeded the maximum allowed size'])
    expect(storage.state.calls).toHaveLength(1)
  })

  it('tries a network failure once more after 1 s, to the same path', async () => {
    vi.useFakeTimers()
    storage.state.upload = offline
    const failed = uploadPlayerPhoto(PATH, photo).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(999)
    expect(storage.state.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const error = (await failed) as GameCallError
    expect([error.status, error.code]).toEqual([0, 'unavailable'])
    expect(paths()).toEqual([PATH, PATH])

    storage.state.calls = []
    let attempts = 0
    storage.state.upload = async () => (++attempts === 1 ? offline() : { data: { path: PATH }, error: null })
    const uploaded = uploadPlayerPhoto(PATH, photo)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(uploaded).resolves.toBeUndefined()
    expect(paths()).toEqual([PATH, PATH])
  })

  it('lets an attempt that hangs past 15 s go and tries once more, then says status 0', async () => {
    vi.useFakeTimers()
    storage.state.upload = () => new Promise<never>(() => undefined)
    let settled = false
    const failed = uploadPlayerPhoto(PATH, photo)
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(storage.state.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(storage.state.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(((await failed) as GameCallError).status).toBe(0)
    expect(paths()).toEqual([PATH, PATH])
  })
})

describe('listing and deleting guest photos', () => {
  const BO = '9e8d7c6b-5a49-4382-a716-f5e4d3c2b1a0'
  const SECOND = '5f4e3d2c-1b0a-4987-b654-3210fedcba98'

  it('lists a party folder by folder, skipping entries that are not player folders or photos', async () => {
    const entries: Record<string, { name: string }[]> = {
      [SESSION]: [{ name: PLAYER }, { name: BO }, { name: '.emptyFolderPlaceholder' }, { name: 'notes' }],
      [`${SESSION}/${PLAYER}`]: [{ name: `${FILE}.jpg` }, { name: '.emptyFolderPlaceholder' }],
      [`${SESSION}/${BO}`]: [{ name: `${SECOND}.jpg` }, { name: `${SECOND}.png` }],
    }
    storage.state.list = async (folder) => ({ data: entries[folder] ?? [], error: null })
    await expect(listPartyPhotos(SESSION)).resolves.toEqual([`${SESSION}/${PLAYER}/${FILE}.jpg`, `${SESSION}/${BO}/${SECOND}.jpg`])
    expect(storage.state.calls).toEqual([
      ['list', 'player-photos', SESSION, { limit: 1000 }],
      ['list', 'player-photos', `${SESSION}/${PLAYER}`, { limit: 100 }],
      ['list', 'player-photos', `${SESSION}/${BO}`, { limit: 100 }],
    ])
  })

  it('throws a failed listing as a GameCallError', async () => {
    storage.state.list = async () => ({ data: null, error: { name: 'StorageApiError', message: 'Bucket not found', status: 400, statusCode: '404' } })
    await expect(listPartyPhotos(SESSION)).rejects.toMatchObject({ status: 404, message: 'Bucket not found' })
  })

  it('deletes in batches of 100', async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `${SESSION}/${PLAYER}/${i}.jpg`)
    await removePlayerPhotos(paths)
    expect(storage.state.calls.map(([op, bucket, batch]) => [op, bucket, (batch as string[]).length])).toEqual([
      ['remove', 'player-photos', 100],
      ['remove', 'player-photos', 100],
      ['remove', 'player-photos', 50],
    ])
    expect(storage.state.calls.flatMap((call) => call[2] as string[])).toEqual(paths)
    storage.state.calls = []
    await removePlayerPhotos([])
    expect(storage.state.calls).toEqual([])
  })

  it('never throws: a failed batch leaves the next one to go, and no storage client at all is fine', async () => {
    const paths = Array.from({ length: 150 }, (_, i) => `${SESSION}/${PLAYER}/${i}.jpg`)
    storage.state.remove = async () => {
      throw new Error('Load failed')
    }
    await expect(removePlayerPhotos(paths)).resolves.toBeUndefined()
    expect(storage.state.calls).toHaveLength(2)
    delete storage.client.storage
    await expect(removePlayerPhotos(paths)).resolves.toBeUndefined()
  })
})
