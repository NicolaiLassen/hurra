// The photo pickers and the save, shared by the join step and the phone's
// photo sheet (docs/guest-photos.md, 6.3).
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { GameCallError } from '@/lib/gameApi'
import { playerPhotoPath, preparePhoto } from '@/lib/media'
import { photoErrorMessage } from '@/lib/photos'
import { removeMyPhoto, setMyPhoto } from '@/lib/queries'
import type { PlayerRow } from '@/lib/types'

/**
 * Two hidden file inputs, the front camera (capture="user") and the photo
 * library (accept="image/*"), and the taps that open them. A pick resets its
 * input, so the same photo can be picked again.
 */
export function usePhotoPicker(onPick: (file: File) => void): { inputs: ReactNode; takeSelfie: () => void; choosePhoto: () => void } {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) onPick(file)
  }
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />
      <input ref={library} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />
    </>
  )
  return { inputs, takeSelfie: () => camera.current?.click(), choosePhoto: () => library.current?.click() }
}

export type PhotoSave = {
  status: 'idle' | 'saving' | 'removing' | 'saved' | 'removed' | 'failed'
  /** An object URL of the photo being saved, or just saved, on this phone. */
  preview: string | null
  /** The path the last save set. */
  savedPath: string | null
  /** photoErrorMessage of the last failure. */
  error: string | null
  /** True after a failure with status 0: `retry` sends the same photo to the same path. */
  canRetry: boolean
  save: (file: File) => Promise<boolean>
  retry: () => Promise<boolean>
  remove: () => Promise<boolean>
}

type SaveState = Omit<PhotoSave, 'save' | 'retry' | 'remove'>
/** A prepared photo on its way, with its path and its preview. */
type Prepared = { photo: Blob; path: string; url: string }

/** The longest a photo change waits for the one before it: keepOnly's list and delete have no timeout of their own. */
const CHANGE_WAIT_MAX_MS = 60_000
/** Each player's last photo change on this phone, while it runs. */
const changes = new Map<string, Promise<unknown>>()

/**
 * Runs `change` once the player's change before it on this phone has settled,
 * worked or not, or after 60 s at most; another player's change never waits.
 * The join step's save goes on after Skip for now, and the phone home's
 * sheet saves with a hook of its own: in this order the later pick is set
 * last (setMyPhoto waits out the throttle), and each save's cleanup is done
 * before the next one uploads, so neither deletes the other's file.
 */
export function afterEarlierChange<T>(playerId: string, change: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, CHANGE_WAIT_MAX_MS)))
  const earlier = changes.get(playerId) ?? Promise.resolve()
  const next = Promise.race([earlier, late])
    .finally(() => clearTimeout(timer))
    .then(change, change)
  changes.set(playerId, next)
  const forget = () => {
    if (changes.get(playerId) === next) changes.delete(playerId)
  }
  void next.then(forget, forget)
  return next
}

/**
 * preparePhoto, then setMyPhoto; or removeMyPhoto. After a failure with
 * status 0 it keeps the prepared JPEG and its path, and `retry` uploads that
 * same blob to that same path (an earlier attempt that did land counts as
 * uploaded on its 409, and setting the photo the player already has is a
 * no-op), so trying again never reopens the camera; any other failure drops
 * them, since setMyPhoto deleted the file. Calls `onChanged` after a success
 * (the sheet passes refresh). Revokes its object URLs when replaced and on
 * unmount. A save takes at most about 31 s on a dead connection (two upload
 * attempts of 15 s, 4.2) plus 8 s per call (4.3), and a quick second photo
 * waits out the throttle, a few seconds at most. Each change first waits for
 * the player's change before it on this phone (afterEarlierChange), still
 * 'saving' or 'removing' meanwhile.
 */
export function usePhotoSave(player: Pick<PlayerRow, 'id' | 'session_id'>, onChanged?: () => void): PhotoSave {
  const [state, setState] = useState<SaveState>({ status: 'idle', preview: null, savedPath: null, error: null, canRetry: false })
  // The object URLs this phone shows, the last saved photo's, and the photo kept for a retry.
  const urls = useRef(new Set<string>())
  const saved = useRef<string | null>(null)
  const kept = useRef<Prepared | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)

  useEffect(() => {
    mounted.current = true
    const held = urls.current
    return () => {
      mounted.current = false
      for (const url of held) URL.revokeObjectURL(url)
      held.clear()
    }
  }, [])

  function preview(photo: Blob): string {
    const url = URL.createObjectURL(photo)
    // A save that outlives its screen (Skip for now) shows nothing.
    if (mounted.current) urls.current.add(url)
    else URL.revokeObjectURL(url)
    return url
  }
  function revoke(url: string | null): void {
    if (!url) return
    URL.revokeObjectURL(url)
    urls.current.delete(url)
  }
  /** A photo kept for a retry goes once another is picked or the photo is removed. */
  function dropKept(): void {
    revoke(kept.current?.url ?? null)
    kept.current = null
  }
  /** One change at a time: a second tap while one runs does nothing. */
  async function run(change: () => Promise<boolean>): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    try {
      return await change()
    } finally {
      busy.current = false
    }
  }
  function failed(error: unknown, retry: Prepared | null, action: 'save' | 'remove' = 'save'): false {
    const shown = retry?.url ?? saved.current
    const message = photoErrorMessage(error, action)
    setState((s) => ({ ...s, status: 'failed', preview: shown, error: message, canRetry: retry !== null }))
    return false
  }

  async function send(prepared: Prepared): Promise<boolean> {
    try {
      const path = await afterEarlierChange(player.id, () => setMyPhoto(player, prepared.photo, prepared.path))
      if (saved.current !== prepared.url) revoke(saved.current)
      saved.current = prepared.url
      kept.current = null
      setState({ status: 'saved', preview: prepared.url, savedPath: path, error: null, canRetry: false })
      onChanged?.()
      return true
    } catch (error) {
      if (error instanceof GameCallError && error.status === 0) {
        kept.current = prepared
        return failed(error, prepared)
      }
      kept.current = null
      revoke(prepared.url)
      return failed(error, null)
    }
  }

  const save = (file: File) =>
    run(async () => {
      dropKept()
      const shown = saved.current
      setState((s) => ({ ...s, status: 'saving', preview: shown, error: null, canRetry: false }))
      let prepared: Prepared
      try {
        const photo = await preparePhoto(file)
        prepared = { photo, path: playerPhotoPath(player.session_id, player.id), url: preview(photo) }
      } catch (error) {
        return failed(error, null)
      }
      const url = prepared.url
      setState((s) => ({ ...s, preview: url }))
      return send(prepared)
    })

  const retry = () =>
    run(async () => {
      const prepared = kept.current
      if (!prepared) return false
      setState((s) => ({ ...s, status: 'saving', preview: prepared.url, error: null, canRetry: false }))
      return send(prepared)
    })

  const remove = () =>
    run(async () => {
      dropKept()
      const shown = saved.current
      setState((s) => ({ ...s, status: 'removing', preview: shown, error: null, canRetry: false }))
      try {
        await afterEarlierChange(player.id, () => removeMyPhoto(player))
      } catch (error) {
        return failed(error, null, 'remove')
      }
      revoke(saved.current)
      saved.current = null
      setState({ status: 'removed', preview: null, savedPath: null, error: null, canRetry: false })
      onChanged?.()
      return true
    })

  return { ...state, save, retry, remove }
}
