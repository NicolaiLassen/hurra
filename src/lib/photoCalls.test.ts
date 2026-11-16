// The guest photo calls of queries.ts (docs/guest-photos.md, 4.3 and 8.1)
// against a stand-in for supabase-js: table queries and RPCs as in
// queries.test.ts, plus a small fake of the player-photos bucket. Every call
// goes into one log, in order, so a test can say what happens before what.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameCallError } from './gameApi'
import { deleteSession, removeGuestPhoto, removeMyPhoto, removePlayer, setMyPhoto } from './queries'

type DbError = { message: string; details?: string | null; hint?: string | null; code?: string | null }
type Result = { data: unknown; error: DbError | null; status: number }
type RespondRpc = (name: string, args: Record<string, unknown>, signal: AbortSignal | undefined) => Result | Promise<Result>

const db = vi.hoisted(() => {
  const state = {
    /** Every call in order: ['rpc', name, args], ['upload', bucket, path, options], ['list', bucket, folder, options], ['remove', bucket, paths], ['table', name, ops]. */
    log: [] as unknown[][],
    /** The abort signal each RPC was given. */
    signals: [] as AbortSignal[],
    /** The paths the bucket holds. */
    files: new Set<string>(),
    /** What every listing answers as its error instead of the files, when set. */
    listError: null as unknown,
    respondRpc: (() => ({ data: null, error: null, status: 200 })) as RespondRpc,
  }
  const builder = (table: string, ops: unknown[][]): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            const result: Result = { data: table === 'session_games' ? [] : null, error: null, status: 200 }
            return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
          }
          return (...args: unknown[]) => {
            ops.push([String(prop), args])
            return builder(table, ops)
          }
        },
      },
    )
  const bucket = (name: string) => ({
    async upload(path: string, _photo: Blob, options: unknown) {
      state.log.push(['upload', name, path, options])
      if (state.files.has(path)) {
        return { data: null, error: { name: 'StorageApiError', message: 'The resource already exists', status: 400, statusCode: '409' } }
      }
      state.files.add(path)
      return { data: { path }, error: null }
    },
    async list(folder: string, options: unknown) {
      state.log.push(['list', name, folder, options])
      if (state.listError) return { data: null, error: state.listError }
      const inside = [...state.files].filter((path) => path.startsWith(`${folder}/`))
      return { data: [...new Set(inside.map((path) => path.slice(folder.length + 1).split('/')[0]))].map((entry) => ({ name: entry })), error: null }
    },
    async remove(paths: string[]) {
      state.log.push(['remove', name, paths])
      for (const path of paths) state.files.delete(path)
      return { data: paths.map((path) => ({ name: path })), error: null }
    },
  })
  const client = {
    from(table: string) {
      const ops: unknown[][] = []
      state.log.push(['table', table, ops])
      return builder(table, ops)
    },
    /** Like postgrest-js: a thenable whose abortSignal() hands the signal to the request. */
    rpc(name: string, args: Record<string, unknown>) {
      state.log.push(['rpc', name, args])
      let signal: AbortSignal | undefined
      const call = {
        abortSignal(given: AbortSignal) {
          signal = given
          state.signals.push(given)
          return call
        },
        then(resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(state.respondRpc(name, args, signal)).then(resolve, reject)
        },
      }
      return call
    },
    storage: { from: bucket },
  }
  return { state, client }
})

vi.mock('@/lib/supabase', () => ({ supabase: db.client }))

const SESSION = '0b6a7c1e-5d2f-4b8a-9c3d-2e1f0a9b8c7d'
const PLAYER = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
const BO = '9e8d7c6b-5a49-4382-a716-f5e4d3c2b1a0'
const ME = { id: PLAYER, session_id: SESSION }
const FOLDER = `${SESSION}/${PLAYER}`
const OLD = `${FOLDER}/11111111-1111-4111-8111-111111111111.jpg`
const STRAY = `${FOLDER}/22222222-2222-4222-8222-222222222222.jpg`
const BOS = `${SESSION}/${BO}/33333333-3333-4333-8333-333333333333.jpg`
const ELSEWHERE = '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d/5b4c3d2e-1f0a-4b9c-8d7e-6f5a4b3c2d1e/44444444-4444-4444-8444-444444444444.jpg'
const PHOTO = new Blob([new Uint8Array(25_000)], { type: 'image/jpeg' })
const UPLOAD = { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' }
const NEW_PATH = new RegExp(`^${FOLDER}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`)

const ok = (data: unknown): Result => ({ data, error: null, status: 200 })
const refusal = (status: number, details: string, message: string, hint: string | null = null): Result => ({
  data: null,
  error: { message, details, hint, code: `PT${status}` },
  status,
})
const OFFLINE: Result = { data: null, error: { message: 'TypeError: Load failed' }, status: 0 }
/** set_my_photo as the database answers a path it accepted. */
const setsIt = (previous: string | null) => (_name: string, args: Record<string, unknown>) => ok({ photo: args.p_path, previous })
/** Each log entry as its kind and its name: 'rpc set_my_photo', 'list player-photos', 'table players'. */
const steps = () => db.state.log.map(([kind, name]) => `${kind} ${name}`)
const uploadedPath = () => db.state.log.find(([kind]) => kind === 'upload')?.[2] as string

beforeEach(() => {
  db.state.log = []
  db.state.signals = []
  db.state.files = new Set()
  db.state.listError = null
  db.state.respondRpc = () => ok(null)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('setMyPhoto', () => {
  it('uploads to a new path in the player’s folder, sets it, then deletes the folder’s other files and never the new one', async () => {
    db.state.files = new Set([OLD, STRAY, BOS])
    db.state.respondRpc = setsIt(OLD)
    const path = await setMyPhoto(ME, PHOTO)
    expect(path).toMatch(NEW_PATH)
    expect(db.state.log).toEqual([
      ['upload', 'player-photos', path, UPLOAD],
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: path }],
      ['list', 'player-photos', FOLDER, { limit: 100 }],
      ['remove', 'player-photos', [OLD, STRAY]],
    ])
    expect(db.state.files).toEqual(new Set([BOS, path]))
    expect(db.state.signals).toHaveLength(1)
    expect(db.state.signals[0].aborted).toBe(false)
  })

  it('uses the path it is given when the phone tries a failed save again, and its own earlier upload counts', async () => {
    const again = `${FOLDER}/55555555-5555-4555-8555-555555555555.jpg`
    db.state.files = new Set([again])
    db.state.respondRpc = setsIt(null)
    await expect(setMyPhoto(ME, PHOTO, again)).resolves.toBe(again)
    expect(db.state.log.slice(0, 2)).toEqual([
      ['upload', 'player-photos', again, UPLOAD],
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: again }],
    ])
    expect(db.state.files).toEqual(new Set([again]))
  })

  it('waits the milliseconds too_soon names, plus 250, and asks once more', async () => {
    vi.useFakeTimers()
    let calls = 0
    db.state.respondRpc = (name, args) =>
      ++calls === 1 ? refusal(429, 'too_soon', 'Wait a moment before changing your photo again', '4000') : setsIt(null)(name, args)
    const saving = setMyPhoto(ME, PHOTO)
    await vi.advanceTimersByTimeAsync(4249)
    expect(steps()).toEqual(['upload player-photos', 'rpc set_my_photo'])
    await vi.advanceTimersByTimeAsync(1)
    const path = await saving
    expect(path).toMatch(NEW_PATH)
    expect(db.state.log.filter(([kind]) => kind === 'rpc')).toEqual([
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: path }],
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: path }],
    ])
    expect(db.state.files).toEqual(new Set([path]))
  })

  it('never waits more than 10 s, and asks only once more: still too soon, it gives up and deletes the new file', async () => {
    vi.useFakeTimers()
    for (const hint of ['600000', null]) {
      db.state.log = []
      db.state.respondRpc = () => refusal(429, 'too_soon', 'Wait a moment before changing your photo again', hint)
      const saving = setMyPhoto(ME, PHOTO).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10_249)
      expect(steps()).toEqual(['upload player-photos', 'rpc set_my_photo'])
      await vi.advanceTimersByTimeAsync(1)
      const error = (await saving) as GameCallError
      expect([error.status, error.code]).toEqual([429, 'too_soon'])
      expect(steps()).toEqual(['upload player-photos', 'rpc set_my_photo', 'rpc set_my_photo', 'remove player-photos'])
      expect(db.state.files.size).toBe(0)
    }
  })

  it('deletes the new file again when set_my_photo refuses it, and rejects with its code', async () => {
    db.state.files = new Set([OLD])
    db.state.respondRpc = () => refusal(415, 'bad_file', "That file can't be a photo here")
    const error = (await setMyPhoto(ME, PHOTO).catch((e: unknown) => e)) as GameCallError
    expect(error).toBeInstanceOf(GameCallError)
    expect([error.status, error.code, error.message]).toEqual([415, 'bad_file', "That file can't be a photo here"])
    const path = uploadedPath()
    expect(db.state.log).toEqual([
      ['upload', 'player-photos', path, UPLOAD],
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: path }],
      ['remove', 'player-photos', [path]],
    ])
    // The photo in use stays.
    expect(db.state.files).toEqual(new Set([OLD]))
  })

  it('keeps the new file when set_my_photo never answered: it may have worked', async () => {
    db.state.files = new Set([OLD])
    db.state.respondRpc = () => OFFLINE
    const error = (await setMyPhoto(ME, PHOTO).catch((e: unknown) => e)) as GameCallError
    expect([error.status, error.code]).toEqual([0, 'unavailable'])
    expect(steps()).toEqual(['upload player-photos', 'rpc set_my_photo'])
    expect(db.state.files).toEqual(new Set([OLD, uploadedPath()]))
  })

  it('gives set_my_photo up after 8 s (status 0) and keeps the new file', async () => {
    vi.useFakeTimers()
    db.state.respondRpc = (_name, _args, signal) =>
      new Promise<Result>((resolve) =>
        signal?.addEventListener('abort', () =>
          resolve({ data: null, error: { message: 'AbortError: This operation was aborted', details: '', hint: '', code: '' }, status: 0 }),
        ),
      )
    let settled = false
    const saving = setMyPhoto(ME, PHOTO)
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(7999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = (await saving) as GameCallError
    expect([error.status, error.code]).toEqual([0, 'unavailable'])
    expect(db.state.signals.map((signal) => signal.aborted)).toEqual([true])
    expect(steps()).toEqual(['upload player-photos', 'rpc set_my_photo'])
    expect(db.state.files).toEqual(new Set([uploadedPath()]))
  })
})

describe('removeMyPhoto', () => {
  it('calls set_my_photo with null, then empties the folder', async () => {
    db.state.files = new Set([OLD, STRAY, BOS])
    db.state.respondRpc = () => ok({ photo: null, previous: OLD })
    await removeMyPhoto(ME)
    expect(db.state.log).toEqual([
      ['rpc', 'set_my_photo', { p_player_id: PLAYER, p_path: null }],
      ['list', 'player-photos', FOLDER, { limit: 100 }],
      ['remove', 'player-photos', [OLD, STRAY]],
    ])
    expect(db.state.files).toEqual(new Set([BOS]))
  })

  it('leaves the folder alone when set_my_photo refuses', async () => {
    db.state.files = new Set([OLD])
    db.state.respondRpc = () => refusal(403, 'not_your_player', "That isn't your player")
    await expect(removeMyPhoto(ME)).rejects.toMatchObject({ status: 403, code: 'not_your_player' })
    expect(steps()).toEqual(['rpc set_my_photo'])
    expect(db.state.files).toEqual(new Set([OLD]))
  })
})

describe('removeGuestPhoto', () => {
  it('deletes only the photo host_remove_photo took down: a new one the guest is saving stays', async () => {
    db.state.files = new Set([OLD, STRAY])
    db.state.respondRpc = () => ok({ photo: null, previous: OLD })
    await removeGuestPhoto(PLAYER)
    expect(db.state.log).toEqual([
      ['rpc', 'host_remove_photo', { p_player_id: PLAYER }],
      ['remove', 'player-photos', [OLD]],
    ])
    expect(db.state.files).toEqual(new Set([STRAY]))
  })

  it('deletes nothing for a null answer or a player without a photo, and rejects a refusal with its code', async () => {
    for (const answer of [null, { photo: null, previous: null }]) {
      db.state.log = []
      db.state.respondRpc = () => ok(answer)
      await removeGuestPhoto(PLAYER)
      expect(steps()).toEqual(['rpc host_remove_photo'])
    }
    db.state.log = []
    db.state.respondRpc = () => refusal(403, 'not_host', 'Only hosts can do that')
    await expect(removeGuestPhoto(PLAYER)).rejects.toMatchObject({ status: 403, code: 'not_host' })
    expect(steps()).toEqual(['rpc host_remove_photo'])
  })
})

describe('removePlayer', () => {
  it('takes the photo down, deletes every file in the guest’s folder, then deletes the player', async () => {
    db.state.files = new Set([OLD, STRAY, BOS])
    db.state.respondRpc = () => ok({ photo: null, previous: OLD })
    await removePlayer(SESSION, PLAYER)
    expect(db.state.log).toEqual([
      ['rpc', 'host_remove_photo', { p_player_id: PLAYER }],
      ['remove', 'player-photos', [OLD]],
      ['list', 'player-photos', FOLDER, { limit: 100 }],
      ['remove', 'player-photos', [STRAY]],
      [
        'table',
        'players',
        [
          ['delete', []],
          ['eq', ['id', PLAYER]],
        ],
      ],
      [
        'table',
        'session_games',
        [
          ['select', ['id']],
          ['eq', ['session_id', SESSION]],
          ['eq', ['status', 'active']],
          ['is', ['archived_at', null]],
        ],
      ],
    ])
    expect(db.state.files).toEqual(new Set([BOS]))
  })

  it('still deletes the player when taking the photo down and listing the folder both fail', async () => {
    db.state.files = new Set([OLD])
    db.state.respondRpc = () => OFFLINE
    db.state.listError = { name: 'StorageUnknownError', message: 'Load failed' }
    await expect(removePlayer(SESSION, PLAYER)).resolves.toBeUndefined()
    expect(steps()).toEqual(['rpc host_remove_photo', 'list player-photos', 'table players', 'table session_games'])
    // Left for the after-party script.
    expect(db.state.files).toEqual(new Set([OLD]))
  })
})

describe('deleteSession', () => {
  it('deletes the party’s photos, folder by folder, before the party', async () => {
    db.state.files = new Set([OLD, BOS, ELSEWHERE])
    await deleteSession(SESSION)
    expect(db.state.log).toEqual([
      ['list', 'player-photos', SESSION, { limit: 1000 }],
      ['list', 'player-photos', FOLDER, { limit: 100 }],
      ['list', 'player-photos', `${SESSION}/${BO}`, { limit: 100 }],
      ['remove', 'player-photos', [OLD, BOS]],
      [
        'table',
        'sessions',
        [
          ['delete', []],
          ['eq', ['id', SESSION]],
        ],
      ],
    ])
    expect(db.state.files).toEqual(new Set([ELSEWHERE]))
  })

  it('still deletes the party when listing its photos fails', async () => {
    db.state.files = new Set([OLD])
    db.state.listError = { name: 'StorageApiError', message: 'new row violates row-level security policy', status: 400, statusCode: '403' }
    await expect(deleteSession(SESSION)).resolves.toBeUndefined()
    expect(steps()).toEqual(['list player-photos', 'table sessions'])
    expect(db.state.files).toEqual(new Set([OLD]))
  })
})
