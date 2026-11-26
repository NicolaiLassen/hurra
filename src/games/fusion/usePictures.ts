// The TV's picture cache for Participant fusion (spec 8.2). A picture's image
// reaches the TV only once it is asked, so the cache holds the pictures asked
// so far: each thumbnail (which also gives the pictures' shape) and full image
// load as their paths arrive, and the picture asked now loads at high priority
// and decoded (decodeSet), so its face can flip in sharp at the end of the
// suspense; `ready` says when it can. References to decoded images that no
// longer show are dropped, so 40 decoded portraits never sit in memory.
import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeSet, frameAspect, FULLS_AT_ONCE, runQueue, THUMBS_AT_ONCE, wallAspect } from '@/games/fusion/preload'
import type { FusionPublicState } from '@/games/fusion/shapes'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

export type PictureCache = {
  /** The wall's tile shape (width over height), from the thumbnails in so far; 4:5 before any picture is asked. */
  wallAspect: number
  /** The frame's shape: the wall's, portrait or square only. */
  frameAspect: number
  /** Whether a picture's full image is in and decoded, or has failed (its thumbnail or label stands in then): its face can flip in. */
  ready: (path: string) => boolean
}

/** Loads an image into the cache; resolves with its natural size, or null when it fails. */
function load(src: string, priority: 'high' | 'low' | 'auto'): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.fetchPriority = priority
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function usePictures(pub: FusionPublicState | null, mediaUrl: MediaUrl): PictureCache {
  const paths = useMemo(() => (pub ? pub.pictures.flatMap((p) => (p.image ? [p.image] : [])) : []), [pub])
  const signature = paths.join('\n')
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [decodedPaths, setDecoded] = useState<ReadonlySet<string>>(() => new Set())
  // The latest URL builder, without restarting the queue when the parent passes a new one.
  const url = useRef(mediaUrl)
  useEffect(() => {
    url.current = mediaUrl
  }, [mediaUrl])

  useEffect(() => {
    if (signature === '') return
    const list = signature.split('\n')
    let stopped = false
    const thumbs = list.map((path) => async () => {
      const size = await load(url.current(path, 'thumb'), 'auto')
      if (!stopped && size && size.width > 0 && size.height > 0) setAspects((a) => ({ ...a, [path]: size.width / size.height }))
    })
    const fulls = list.map((path) => async () => {
      await load(url.current(path, 'full'), 'low')
    })
    void runQueue(thumbs, THUMBS_AT_ONCE, () => stopped).then(() => runQueue(fulls, FULLS_AT_ONCE, () => stopped))
    return () => {
      stopped = true
    }
  }, [signature])

  const wanted = pub ? decodeSet(pub) : []
  const wantedKey = wanted
    .map((n) => pub?.pictures.find((p) => p.n === n)?.image ?? '')
    .filter((path) => path !== '')
    .join('\n')
  const decoded = useRef(new Map<string, HTMLImageElement>())
  useEffect(() => {
    const keep = new Set(wantedKey === '' ? [] : wantedKey.split('\n'))
    const held = decoded.current
    for (const path of held.keys()) if (!keep.has(path)) held.delete(path)
    for (const path of keep) {
      if (held.has(path)) continue
      const img = new Image()
      img.decoding = 'async'
      img.fetchPriority = 'high'
      img.src = url.current(path, 'full')
      const done = () => setDecoded((set) => (set.has(path) ? set : new Set(set).add(path)))
      // A picture that fails keeps its thumbnail, or its label, on screen: it is as ready as it gets.
      img.decode().then(done, done)
      held.set(path, img)
    }
  }, [wantedKey])

  const shapes = paths.flatMap((path) => (aspects[path] ? [aspects[path]] : []))
  return {
    wallAspect: wallAspect(shapes),
    frameAspect: frameAspect(shapes),
    ready: (path) => decodedPaths.has(path),
  }
}
