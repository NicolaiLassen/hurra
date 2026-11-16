// The guest photo index Avatar reads (docs/guest-photos.md, 4.4 and 5). Never
// import the Supabase client here, directly or through another module: Avatar
// imports this, every game's views import Avatar, and the game tests run with
// no Supabase settings. The provider in photos.tsx makes the URLs.
import { createContext, useContext } from 'react'
import type { Player } from '@/lib/types'

export type PhotoIndex = { byId: ReadonlyMap<string, string>; byName: ReadonlyMap<string, string> }

/** The names call sites pass for someone who isn't a player (any more): never matched, whoever joins with one. */
export const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(['A guest', 'Someone'])

export const NO_PHOTOS: PhotoIndex = { byId: new Map(), byName: new Map() }

/**
 * The party's photos as one string, `id \t path \t name` per player with a
 * photo, one per line. It changes only when a photo, or the name of a player
 * with one, changes, so the index (and every Avatar) is rebuilt only then.
 * Names hold no tab or line break (clean_name, engine-v2 2.3).
 */
export function photoKey(players: readonly Pick<Player, 'id' | 'name' | 'photo'>[] | undefined): string {
  return (players ?? [])
    .filter((player) => player.photo)
    .map((player) => `${player.id}\t${player.photo}\t${player.name}`)
    .join('\n')
}

/**
 * The URLs a photoKey describes, made with `urlOf`, by player id and by name.
 * byName leaves out PLACEHOLDER_NAMES and any name two players share (never:
 * players_session_name_key forbids it). NO_PHOTOS for the empty key.
 */
export function photoIndex(key: string, urlOf: (path: string) => string): PhotoIndex {
  if (!key) return NO_PHOTOS
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  const shared = new Set<string>()
  for (const line of key.split('\n')) {
    const [id, path, name] = line.split('\t')
    const url = urlOf(path)
    byId.set(id, url)
    if (PLACEHOLDER_NAMES.has(name)) continue
    if (byName.has(name)) shared.add(name)
    byName.set(name, url)
  }
  for (const name of shared) byName.delete(name)
  return { byId, byName }
}

/** The same index with only the URLs in `allowed` (the measured ones, photos.tsx). */
export function onlyAllowed(index: PhotoIndex, allowed: ReadonlySet<string>): PhotoIndex {
  const keep = (map: ReadonlyMap<string, string>) => new Map([...map].filter(([, url]) => allowed.has(url)))
  return { byId: keep(index.byId), byName: keep(index.byName) }
}

/** A player's photo URL: by id when one is given (even when that player has none), else by the exact name; null for none. */
export function photoFor(index: PhotoIndex, playerId?: string, name?: string): string | null {
  if (playerId !== undefined) return index.byId.get(playerId) ?? null
  return name === undefined ? null : (index.byName.get(name) ?? null)
}

export const PhotosContext = createContext<PhotoIndex>(NO_PHOTOS)

/** The photo URL of a player for Avatar; null outside any provider (the join page) or for none. */
export function usePlayerPhoto(playerId?: string, name?: string): string | null {
  return photoFor(useContext(PhotosContext), playerId, name)
}
