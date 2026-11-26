import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@/lib/types'
import { restage, routeNews, takeNews, type NewsStage } from './news'

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

describe('restage', () => {
  it("takes a knockout's strap down when a game takes the stage under it, and puts it on the band's event line", () => {
    // Routed to the strap while the standings showed, then Lydspor took the stage: there it is a line in the band.
    const knockout = item({ game_id: 'background', message: 'Bo got Ana', sound: 'slash' })
    expect(routeNews(knockout, BOARD)).toBe('banner')
    expect(restage({ banner: knockout }, BOARD)).toEqual({ banner: knockout })
    expect(restage({ banner: knockout }, SOUND_ONLY)).toEqual({ banner: undefined, ticker: knockout })
    // An older line in the band gives way to it; a newer one stays.
    const older = item({ id: knockout.id - 100, game_id: 'background' })
    expect(restage({ banner: knockout, ticker: older }, BANNERS)).toEqual({ banner: undefined, ticker: knockout })
    const newer = item({ game_id: 'background' })
    expect(restage({ banner: knockout, ticker: newer }, BANNERS)).toEqual({ banner: undefined, ticker: newer })
  })

  it('keeps a strap that is still big news on the new stage: a winner, or news for the whole party', () => {
    const winner = item({ game_id: 'background', interrupt: true })
    const party = item({ game_id: null })
    expect(restage({ banner: winner }, SOUND_ONLY)).toEqual({ banner: winner })
    expect(restage({ banner: party }, SOUND_ONLY)).toEqual({ banner: party })
  })

  it("takes down a game's own strap when its final screen takes the stage, which shows that moment itself", () => {
    const own = item({ game_id: 'stage', interrupt: true })
    expect(restage({ banner: own }, SOUND_ONLY)).toEqual({ banner: undefined, ticker: undefined })
    // The recap keeps only a winner.
    expect(restage({ banner: item({ game_id: null }) }, RECAP)).toEqual({ banner: undefined, ticker: undefined })
  })

  it('changes nothing without a strap', () => {
    const line = item({ game_id: 'background' })
    expect(restage({ ticker: line }, BANNERS)).toEqual({ ticker: line })
  })
})
