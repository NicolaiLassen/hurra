import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@/lib/types'
import { feedNews, MAX_TOASTS, STALE_MS } from './feed'

const NOW = 1_800_000_000_000
let id = 1

function row(message: string, patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id: id++,
    game_id: 'elimination',
    message,
    detail: null,
    audience: null,
    sound: null,
    icon: null,
    tone: null,
    interrupt: false,
    created_at: NOW - 1000,
    ...patch,
  }
}

const titles = (items: FeedItem[]) => items.map((item) => item.message)

describe('feedNews', () => {
  it('shows a row aimed at this phone instead of the room-wide row of the same moment, with its sound', () => {
    const news = feedNews(
      [row('Bo got Sofie', { sound: 'slash' }), row("You're out!", { audience: ['me'], sound: 'sad' })],
      'me',
      NOW,
    )
    expect(titles(news.toasts)).toEqual(["You're out!"])
    expect(news.sound).toBe('sad')
  })

  it('keeps room-wide rows of other moments, and plays only the strongest sound aimed at this phone', () => {
    const news = feedNews(
      [
        row('Quiz time!', { game_id: 'quiz', sound: 'whoosh' }),
        row('You got Ana', { audience: ['me'], sound: 'coin' }),
        row('You are the last one standing!', { audience: ['me'], sound: 'fanfare' }),
        row('Bo got Ana', { created_at: NOW - 60_000 }),
      ],
      'me',
      NOW,
    )
    expect(titles(news.toasts)).toEqual(['Quiz time!', 'You got Ana', 'You are the last one standing!', 'Bo got Ana'])
    expect(news.sound).toBe('fanfare')
  })

  it('plays no sound for room-wide rows: their sound is the TV’s', () => {
    expect(feedNews([row('Bo got Ana', { sound: 'slash' })], 'me', NOW).sound).toBeUndefined()
  })

  it('skips rows that are old news by the database clock, e.g. after the phone slept', () => {
    const news = feedNews([row('Long ago', { created_at: NOW - STALE_MS - 1 }), row('Just now')], 'me', NOW)
    expect(titles(news.toasts)).toEqual(['Just now'])
  })

  it('shows at most the newest few room-wide rows of a long batch, and every row aimed at this phone', () => {
    const batch = [
      row('One', { game_id: 'a' }),
      row('Yours', { game_id: 'b', audience: ['me'] }),
      row('Two', { game_id: 'c' }),
      row('Three', { game_id: 'd' }),
      row('Four', { game_id: 'e' }),
      row('Five', { game_id: 'f' }),
    ]
    const news = feedNews(batch, 'me', NOW)
    expect(news.toasts.filter((item) => item.audience === null)).toHaveLength(MAX_TOASTS)
    expect(titles(news.toasts)).toEqual(['Yours', 'Three', 'Four', 'Five'])
  })

  it('ignores rows aimed at other players', () => {
    expect(titles(feedNews([row('Not yours', { audience: ['other'] })], 'me', NOW).toasts)).toEqual([])
  })
})
