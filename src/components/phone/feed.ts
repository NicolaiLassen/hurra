// Game announcements as toasts on a phone (docs/engine-v2.md, 7.1, and the
// sound policy): which new feed rows to show, and the one sound to play.
import { useEffect, useRef } from 'react'
import type { SoundName } from '@/games/core/sounds'
import { toastAnnouncement } from '@/lib/announcement'
import { playSound } from '@/lib/sound'
import { strongestSound } from '@/lib/soundPolicy'
import type { FeedItem } from '@/lib/types'

/** Rows of one game this close together are one moment ("Bo got you" and "Bo got Sofie"). */
export const SAME_MOMENT_MS = 5000
/** Rows older than this by the database clock aren't news, e.g. after the phone slept. */
export const STALE_MS = 120_000
/** At most this many room-wide toasts at once: the newest of a batch. */
export const MAX_TOASTS = 3

const isFor = (item: FeedItem, playerId: string) => item.audience?.includes(playerId) === true

/**
 * What a batch of new feed rows (oldest first) shows on this phone. Rows aimed
 * at this player replace the room-wide row of the same moment, and only they
 * sound: the strongest of them, so the winner hears the fanfare, not a coin
 * too. Room-wide sounds belong to the TV. Rows that are stale by `now` (the
 * database clock) are skipped, and a long batch keeps its newest room-wide
 * rows and every row aimed at this player.
 */
export function feedNews(
  fresh: readonly FeedItem[],
  playerId: string,
  now: number,
): { toasts: FeedItem[]; sound: SoundName | undefined } {
  const news = fresh.filter((item) => now - item.created_at <= STALE_MS)
  const mine = news.filter((item) => isFor(item, playerId))
  const sameMoment = (item: FeedItem) =>
    mine.some((m) => m.game_id === item.game_id && Math.abs(m.created_at - item.created_at) <= SAME_MOMENT_MS)
  const room = news.filter((item) => item.audience === null && !sameMoment(item)).slice(-MAX_TOASTS)
  return {
    toasts: news.filter((item) => isFor(item, playerId) || room.includes(item)),
    sound: strongestSound(mine.map((item) => item.sound)),
  }
}

/**
 * Shows new announcements as they arrive. The feed is newest first; rows that
 * were there when the page opened aren't news. `now` is the snapshot's
 * database clock.
 */
export function useFeedToasts(feed: readonly FeedItem[], playerId: string, now: number) {
  const seen = useRef<Set<number> | null>(null)
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(feed.map((item) => item.id))
      return
    }
    const known = seen.current
    const fresh = [...feed].reverse().filter((item) => !known.has(item.id))
    if (fresh.length === 0) return
    fresh.forEach((item) => known.add(item.id))
    const { toasts, sound } = feedNews(fresh, playerId, now)
    toasts.forEach(toastAnnouncement)
    if (sound) void playSound(sound)
  }, [feed, playerId, now])
}
