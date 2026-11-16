/* eslint-disable react-refresh/only-export-components -- the provider and its words are one module, as in useLive.tsx */
// Guest photos on every screen (docs/guest-photos.md, 4.4 and 5): every
// LiveSessionProvider mounts a PlayerPhotosProvider over its snapshot's
// players. It makes the public URLs, measures each photo once per tab off
// screen, and gives Avatar (through photoIndex.ts) only the photos that passed.
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { GameCallError } from '@/lib/gameApi'
import { playerPhotoUrl, UNREADABLE_PHOTO } from '@/lib/media'
import { onlyAllowed, photoIndex, photoKey, PhotosContext, PLACEHOLDER_NAMES, type PhotoIndex } from '@/lib/photoIndex'
import type { Player } from '@/lib/types'

/** The largest side any screen draws. The app's own photos are 320 px, so anything bigger didn't come from its encoder. */
export const MAX_PHOTO_SIDE = 640
/** A photo that failed to load is measured again after this long. */
const REMEASURE_MS = 60_000

/** useMeasuredPhotos' size rule: a photo is drawn only when both its sides are between 1 and MAX_PHOTO_SIDE. */
export function isDrawablePhoto(width: number, height: number): boolean {
  return width >= 1 && height >= 1 && width <= MAX_PHOTO_SIDE && height <= MAX_PHOTO_SIDE
}

type Measure = 'drawable' | 'too big' | 'failed'
// This tab's measurements by URL. Replaced on every change, never changed in
// place, so each screen sees a result land. A failed one is dropped after
// REMEASURE_MS, so it is measured again.
let measures: ReadonlyMap<string, Measure> = new Map()
const measuring = new Set<string>()
const listeners = new Set<() => void>()

function record(url: string, measure: Measure | null): void {
  const next = new Map(measures)
  if (measure) next.set(url, measure)
  else next.delete(url)
  measures = next
  for (const listener of listeners) listener()
}

function measure(url: string): void {
  if (measuring.has(url) || measures.has(url)) return
  measuring.add(url)
  const image = new Image()
  image.decoding = 'async'
  image.fetchPriority = 'low'
  image.onload = () => {
    measuring.delete(url)
    record(url, isDrawablePhoto(image.naturalWidth, image.naturalHeight) ? 'drawable' : 'too big')
  }
  image.onerror = () => {
    measuring.delete(url)
    record(url, 'failed')
    setTimeout(() => record(url, null), REMEASURE_MS)
  }
  image.src = url
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const currentMeasures = () => measures

/**
 * Loads each URL of the index once per tab with an off-screen Image
 * (decoding 'async', fetchPriority 'low', never added to the page) and keeps
 * the ones whose naturalWidth and naturalHeight are both between 1 and
 * MAX_PHOTO_SIDE. Nothing is drawn while measuring, so a small file that
 * claims a huge picture is never decoded for a screen; a URL that fails to
 * load is measured again after 60 s. The results live in a module-level map,
 * so a remount waits for nothing. The set changes identity when a result
 * lands. On a phone this also loads every photo of the party into the cache
 * in the background, when its snapshot first names it (7).
 */
function useMeasuredPhotos(index: PhotoIndex): ReadonlySet<string> {
  const results = useSyncExternalStore(subscribe, currentMeasures, currentMeasures)
  // Again whenever a result lands, so a failed photo is measured again once it is dropped.
  useEffect(() => {
    for (const url of index.byId.values()) measure(url)
  }, [index, results])
  return useMemo(() => new Set([...index.byId.values()].filter((url) => results.get(url) === 'drawable')), [index, results])
}

/** A head and shoulders on a hue picked from the name, as an SVG data URL. */
function drawnFace(name: string): string {
  const hue = Array.from(name).reduce((h, ch) => (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0, 7) % 360
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    `<rect width="64" height="64" fill="hsl(${hue} 42% 30%)"/>` +
    `<circle cx="32" cy="27" r="12" fill="hsl(${hue} 70% 80%)"/>` +
    `<path d="M9 64c0-13 10-22 23-22s23 9 23 22z" fill="hsl(${hue} 60% 62%)"/>` +
    '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Dev builds only (import.meta.env.DEV, so a production build drops it), with
 * ?photos in the page's URL: a drawn face for every player (an SVG data URL,
 * a head and shoulders on a hue picked from the name), so the fixture scenes
 * show photos (12.3). Null otherwise, and under Node (no window).
 */
function devPhotos(players: readonly Player[] | undefined): PhotoIndex | null {
  if (!import.meta.env.DEV) return null
  if (typeof window === 'undefined' || !players || !new URLSearchParams(window.location?.search).has('photos')) return null
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const player of players) {
    const face = drawnFace(player.name)
    byId.set(player.id, face)
    if (!PLACEHOLDER_NAMES.has(player.name)) byName.set(player.name, face)
  }
  return { byId, byName }
}

export function PlayerPhotosProvider({ players, children }: { players: readonly Player[] | undefined; children: ReactNode }) {
  const key = photoKey(players)
  const index = useMemo(() => photoIndex(key, playerPhotoUrl), [key])
  const measured = useMeasuredPhotos(index)
  const value = useMemo(() => devPhotos(players) ?? onlyAllowed(index, measured), [players, index, measured])
  return <PhotosContext.Provider value={value}>{children}</PhotosContext.Provider>
}

/** What a phone says when a photo couldn't be saved (6.1, 6.2). */
export function photoErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === UNREADABLE_PHOTO) return UNREADABLE_PHOTO
  if (error instanceof GameCallError) {
    if (error.status === 0) return "Couldn't save your photo. Check your connection and try again."
    if (error.status === 413) return 'That photo is too big. Try another one.'
    if (error.code === 'too_soon') return 'Wait a moment, then try again.'
    if (error.code === 'archived') return 'This party is over'
  }
  return "Couldn't save your photo. Try again."
}
