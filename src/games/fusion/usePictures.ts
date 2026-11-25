// The TV's picture cache for Participant fusion (spec 8.2): from the moment
// the TV view mounts, every thumbnail (4 at a time, which also gives each
// picture's shape), then every full image (2 at a time, at low priority, to
// warm the HTTP cache). Full images are decoded only where they show soon
// (decodeSet), and references to the rest are dropped, so 40 decoded
// portraits never sit in memory at once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeSet, frameAspect, FULLS_AT_ONCE, runQueue, THUMBS_AT_ONCE, wallAspect } from '@/games/fusion/preload'
import type { FusionPublicState } from '@/games/fusion/shapes'
import { useServerTime } from '@/lib/gameClock'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

export type PictureCache = {
  /** The wall's tile shape (width over height), from the thumbnails in so far. */
  wallAspect: number
  /** The frame's shape: the wall's, portrait or square only. */
  frameAspect: number
  /** Full images loaded (or failed) so far, of `total`: pictures with an image. */
  warmed: number
  total: number
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

export function usePictures(pub: FusionPublicState | null, mediaUrl: MediaUrl, serverNow: () => number): PictureCache {
  const paths = useMemo(() => (pub ? pub.pictures.flatMap((p) => (p.image ? [p.image] : [])) : []), [pub])
  const signature = paths.join('\n')
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [warmed, setWarmed] = useState<ReadonlySet<string>>(() => new Set())
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
      if (!stopped) setWarmed((w) => new Set(w).add(path))
    })
    void runQueue(thumbs, THUMBS_AT_ONCE, () => stopped).then(() => runQueue(fulls, FULLS_AT_ONCE, () => stopped))
    return () => {
      stopped = true
    }
  }, [signature])

  // Decoding follows the clock only through the showing, where the picture on show moves on by itself.
  const now = useServerTime(serverNow, 500, pub?.phase === 'showing')
  const wanted = pub ? decodeSet(pub, now) : []
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
      img.src = url.current(path, 'full')
      img.decode().catch(() => {
        // A picture that fails keeps its thumbnail, or its label, on screen.
      })
      held.set(path, img)
    }
  }, [wantedKey])

  const shapes = paths.flatMap((path) => (aspects[path] ? [aspects[path]] : []))
  return {
    wallAspect: wallAspect(shapes),
    frameAspect: frameAspect(shapes),
    warmed: paths.filter((path) => warmed.has(path)).length,
    total: paths.length,
  }
}
