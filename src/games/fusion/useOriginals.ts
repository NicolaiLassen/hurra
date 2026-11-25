// The two people's own photos on the TV (docs/identity.md, Participant fusion
// on the TV): secret until their picture is revealed, so they reach the TV
// with the reveal's own state and no sooner. From that render on, each loads
// at high priority, the thumbnail (about 30 KB, in at once on the venue's
// line) beside the full image, both decoded, while the picture moves to the
// middle; the reveal brings each person in once theirs is ready
// (reveal.ts). References to a reveal's photos are dropped once it is over.
import { useEffect, useRef, useState } from 'react'
import type { OriginalStatus } from '@/games/fusion/reveal'

type MediaUrl = (path: string, size?: 'full' | 'thumb') => string

/** Loads an image now at high priority, decoded; resolves true when it is ready to draw, false when it fails. */
function load(src: string): { image: HTMLImageElement; done: Promise<boolean> } {
  const image = new Image()
  image.decoding = 'async'
  image.fetchPriority = 'high'
  const done = new Promise<boolean>((resolve) => {
    image.onload = () => {
      image.decode().then(
        () => resolve(true),
        // Loaded but not decoded here: the screen decodes it as it draws.
        () => resolve(true),
      )
    }
    image.onerror = () => resolve(false)
  })
  image.src = src
  return { image, done }
}

/**
 * Each of the two photos' state, in the order of the people: 'none' for no
 * photo, 'loading', 'ready' once its thumbnail or full image is in, 'failed'
 * when both fail (the reveal shows the guest's profile photo or token then).
 */
export function useOriginals(paths: readonly [string | null, string | null] | null, mediaUrl: MediaUrl): [OriginalStatus, OriginalStatus] {
  const signature = paths ? `${paths[0] ?? ''}\n${paths[1] ?? ''}` : ''
  const [loads, setLoads] = useState<Readonly<Record<string, 'ready' | 'failed'>>>({})
  const held = useRef(new Map<string, HTMLImageElement[]>())
  // The latest URL builder, without loading again when the parent passes a new one.
  const url = useRef(mediaUrl)
  useEffect(() => {
    url.current = mediaUrl
  }, [mediaUrl])

  useEffect(() => {
    const list = signature.split('\n').filter((path) => path !== '')
    const keep = new Set(list)
    for (const path of held.current.keys()) if (!keep.has(path)) held.current.delete(path)
    for (const path of list) {
      if (held.current.has(path)) continue
      const thumb = load(url.current(path, 'thumb'))
      const full = load(url.current(path, 'full'))
      held.current.set(path, [thumb.image, full.image])
      const ready = () => setLoads((l) => (l[path] === 'ready' ? l : { ...l, [path]: 'ready' }))
      void thumb.done.then((ok) => ok && ready())
      void full.done.then((ok) => ok && ready())
      void Promise.all([thumb.done, full.done]).then(([a, b]) => {
        if (!a && !b) setLoads((l) => ({ ...l, [path]: 'failed' }))
      })
    }
  }, [signature])

  const statusOf = (path: string | null | undefined): OriginalStatus => (path ? (loads[path] ?? 'loading') : 'none')
  return [statusOf(paths?.[0]), statusOf(paths?.[1])]
}
