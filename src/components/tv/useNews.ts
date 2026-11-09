import { useEffect, useState } from 'react'
import { BANNER_MS, takeNews, TICKER_MS, type NewsStage } from '@/components/tv/news'
import type { SoundName } from '@/games/core/sounds'
import { playSound } from '@/lib/sound'
import type { FeedItem } from '@/lib/types'

/**
 * The announcements on the TV as they arrive: the banner (8 s), the ticker
 * (20 s) and one sound per batch, sorted by news.ts for what holds the stage
 * when they arrive. Whatever was in the feed when the TV opened isn't news,
 * and a re-read can never bring back (or replay) an older row.
 */
export function useNews(feed: readonly FeedItem[], stage: NewsStage): { banner?: FeedItem; ticker?: FeedItem } {
  const newest = feed.reduce((max, item) => Math.max(max, item.id), 0)
  const [seen, setSeen] = useState<number | null>(null)
  const [banner, setBanner] = useState<FeedItem>()
  const [ticker, setTicker] = useState<FeedItem>()
  const [sound, setSound] = useState<{ name: SoundName; seq: number }>()

  // Adjusted while rendering (React's "adjust state on prop change" pattern), so a batch is sorted exactly once.
  if (seen === null) {
    setSeen(newest)
  } else if (newest > seen) {
    setSeen(newest)
    const news = takeNews(
      feed.filter((item) => item.id > seen && item.audience === null),
      stage,
    )
    if (news.banner) setBanner(news.banner)
    if (news.ticker) setTicker(news.ticker)
    if (news.sound) setSound({ name: news.sound, seq: (sound?.seq ?? 0) + 1 })
  }

  useEffect(() => {
    if (sound) void playSound(sound.name)
  }, [sound])

  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(() => setBanner(undefined), BANNER_MS)
    return () => clearTimeout(timer)
  }, [banner])

  useEffect(() => {
    if (!ticker) return
    const timer = setTimeout(() => setTicker(undefined), TICKER_MS)
    return () => clearTimeout(timer)
  }, [ticker])

  return { banner, ticker }
}
