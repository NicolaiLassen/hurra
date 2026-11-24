import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@/lib/types'
import { onAirText, routeNews, takeNews, type NewsStage } from './news'

let nextId = 1
function item(patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id: nextId++,
    game_id: 'stage',
    message: 'Something happened',
    detail: null,
    audience: null,
    sound: null,
    icon: null,
    tone: null,
    interrupt: false,
    created_at: 0,
    ...patch,
  }
}

const BOARD: NewsStage = { kind: 'board' }
const BANNERS: NewsStage = { kind: 'stage', gameId: 'stage', banners: 'banner' }
const SOUND_ONLY: NewsStage = { kind: 'stage', gameId: 'stage', banners: 'sound-only' }
const RECAP: NewsStage = { kind: 'recap' }

describe('routeNews', () => {
  it('gives every announcement the banner while the standings show', () => {
    expect(routeNews(item({ game_id: 'background' }), BOARD)).toBe('banner')
    expect(routeNews(item({ game_id: null }), BOARD)).toBe('banner')
  })

  it("gives the stage game's announcements the banner, or only their sound when its view shows the moment", () => {
    expect(routeNews(item(), BANNERS)).toBe('banner')
    expect(routeNews(item(), SOUND_ONLY)).toBe('sound')
    // Its own winner too: its final screen shows that moment.
    expect(routeNews(item({ interrupt: true }), SOUND_ONLY)).toBe('sound')
  })

  it("puts a background game's news on the quiet ticker while another game holds the stage", () => {
    expect(routeNews(item({ game_id: 'background' }), BANNERS)).toBe('ticker')
    expect(routeNews(item({ game_id: 'background' }), SOUND_ONLY)).toBe('ticker')
  })

  it('banners a background winner (interrupt) and news for the whole party, even over a stage game', () => {
    expect(routeNews(item({ game_id: 'background', interrupt: true }), SOUND_ONLY)).toBe('banner')
    expect(routeNews(item({ game_id: null }), SOUND_ONLY)).toBe('banner')
  })

  it('lets only a winner break into the recap', () => {
    expect(routeNews(item({ interrupt: true }), RECAP)).toBe('banner')
    expect(routeNews(item(), RECAP)).toBe('skip')
    expect(routeNews(item({ game_id: null }), RECAP)).toBe('skip')
  })
})

describe('takeNews', () => {
  it('shows the newest banner of a batch with the strongest sound of the batch', () => {
    const knockout = item({ message: 'Bo got Ana', sound: 'slash' })
    const winner = item({ message: 'Bo is the last one standing!', sound: 'fanfare', interrupt: true })
    // Batches come newest first from the snapshot.
    const news = takeNews([winner, knockout], BANNERS)
    expect(news.banner).toBe(winner)
    expect(news.sound).toBe('fanfare')
    expect(news.ticker).toBeUndefined()
  })

  it('plays the pop for a banner without a sound of its own', () => {
    expect(takeNews([item()], BANNERS)).toMatchObject({ sound: 'pop' })
  })

  it('plays nothing for a sound-only moment that has no sound', () => {
    expect(takeNews([item()], SOUND_ONLY)).toEqual({})
    expect(takeNews([item({ sound: 'ticktock' })], SOUND_ONLY)).toEqual({ sound: 'ticktock' })
  })

  it('keeps the ticker quiet and shows its newest line', () => {
    const first = item({ game_id: 'background', message: 'Bo got Ana', sound: 'slash' })
    const second = item({ game_id: 'background', message: 'Ida got Emil', sound: 'slash' })
    expect(takeNews([second, first], SOUND_ONLY)).toEqual({ ticker: second })
  })

  it('mixes routes in one batch: the stage sound wins over a pop, the ticker still updates', () => {
    const reveal = item({ sound: 'gotcha' })
    const party = item({ game_id: null })
    const knockout = item({ game_id: 'background', sound: 'slash' })
    expect(takeNews([knockout, party, reveal], SOUND_ONLY)).toEqual({ banner: party, ticker: knockout, sound: 'gotcha' })
  })

  it('ignores sounds it has never heard of', () => {
    expect(takeNews([item({ sound: 'kazoo' })], BANNERS)).toEqual({ banner: expect.anything() })
  })
})

describe('onAirText', () => {
  it("drops a game's exclamation marks, since the TV keeps its one for the winner's screen", () => {
    expect(onAirText('Bo is the last one standing!')).toBe('Bo is the last one standing')
    expect(onAirText('Picture 3 was Ana and Bo!! ')).toBe('Picture 3 was Ana and Bo')
    expect(onAirText("That's you! No points on your own picture.")).toBe("That's you. No points on your own picture.")
  })

  it('leaves calm news as it is', () => {
    expect(onAirText('Clara got Frida')).toBe('Clara got Frida')
    expect(onAirText('Voting is closed. 6 pictures')).toBe('Voting is closed. 6 pictures')
  })
})
