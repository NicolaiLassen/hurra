import { describe, expect, it } from 'vitest'
import { menuSteps, moreTime, nextStep, songsLeft, topDue, type Where } from './steps'

const at = (where: Partial<Where>): Where => ({
  phase: 'lobby',
  played: 0,
  total: 8,
  revealed: 0,
  standingsEvery: 4,
  lastCallSeconds: 60,
  extended: 0,
  closing: false,
  ...where,
})

const labels = (where: Partial<Where>) => menuSteps(at(where)).map((step) => step.label)

describe('the gold step', () => {
  it('plays the songs in order, then calls the last call after the last one', () => {
    expect(nextStep(at({ phase: 'lobby' }))).toMatchObject({ label: 'Play song 1', action: { type: 'play', index: 0 } })
    expect(nextStep(at({ phase: 'playing', played: 5 }))).toMatchObject({ label: 'Play song 6', action: { type: 'play', index: 5 } })
    expect(nextStep(at({ phase: 'playing', played: 8 }))).toMatchObject({ label: 'Last call', action: { type: 'lastCall', after: 8 } })
  })

  it('has none while the last call runs: it locks by itself', () => {
    expect(nextStep(at({ phase: 'lastCall', played: 8 }))).toBeNull()
  })

  it('reveals in order, shows the top 5 when it is due, and crowns after the last reveal', () => {
    expect(nextStep(at({ phase: 'locked', played: 8 }))).toMatchObject({ label: 'Reveal song 1', action: { type: 'reveal', index: 0 } })
    expect(nextStep(at({ phase: 'reveal', played: 8, revealed: 1 }))).toMatchObject({ label: 'Reveal song 2', action: { type: 'reveal', index: 1 } })
    expect(nextStep(at({ phase: 'reveal', played: 8, revealed: 4 }))).toMatchObject({ label: 'Show the top 5', action: { type: 'standings', after: 4 } })
    expect(nextStep(at({ phase: 'standings', played: 8, revealed: 4 }))).toMatchObject({ label: 'Reveal song 5', action: { type: 'reveal', index: 4 } })
    expect(nextStep(at({ phase: 'reveal', played: 8, revealed: 8 }))).toMatchObject({ label: 'Show the top 5', action: { type: 'standings', after: 8 } })
    expect(nextStep(at({ phase: 'standings', played: 8, revealed: 8 }))).toMatchObject({ label: 'Crown Lydspor', action: { type: 'crown' } })
    expect(nextStep(at({ phase: 'done', played: 8, revealed: 8 }))).toBeNull()
  })

  it('crowns straight after the last reveal when the top 5 is not due, or never shown', () => {
    expect(nextStep(at({ phase: 'reveal', played: 6, revealed: 6 }))).toMatchObject({ label: 'Crown Lydspor' })
    expect(nextStep(at({ phase: 'reveal', played: 8, revealed: 8, standingsEvery: 0 }))).toMatchObject({ label: 'Crown Lydspor' })
    expect(topDue(at({ phase: 'reveal', revealed: 4, standingsEvery: 0 }))).toBe(false)
    expect(topDue(at({ phase: 'standings', revealed: 4 }))).toBe(false)
  })

  it('gives each step its own id, so a pending button knows itself', () => {
    expect(nextStep(at({ phase: 'playing', played: 2 }))!.id).not.toBe(nextStep(at({ phase: 'playing', played: 3 }))!.id)
  })
})

describe('more time', () => {
  it('adds 30 s twice, naming the extension it is, until the timer closes the answers', () => {
    expect(moreTime(at({ phase: 'lastCall', played: 8 }))).toMatchObject({ label: 'More time (+30 s)', action: { type: 'more', n: 1 }, left: 2 })
    expect(moreTime(at({ phase: 'lastCall', played: 8, extended: 1 }))).toMatchObject({ action: { type: 'more', n: 2 }, left: 1 })
    expect(moreTime(at({ phase: 'lastCall', played: 8, extended: 2 }))).toBeNull()
    expect(moreTime(at({ phase: 'lastCall', played: 8, closing: true }))).toBeNull()
    expect(moreTime(at({ phase: 'playing', played: 8 }))).toBeNull()
  })
})

describe('the menu', () => {
  it('holds the steps that skip ahead, each asking first', () => {
    expect(labels({ phase: 'lobby' })).toEqual([])
    expect(labels({ phase: 'playing', played: 6 })).toEqual(['Last call now…', 'Lock now…'])
    expect(labels({ phase: 'playing', played: 8 })).toEqual(['Lock now…'])
    expect(labels({ phase: 'lastCall', played: 8 })).toEqual(['Lock now…'])
    expect(labels({ phase: 'lastCall', played: 8, closing: true })).toEqual(['Lock now…'])
    expect(labels({ phase: 'locked', played: 8 })).toEqual(['Crown Lydspor now…'])
    expect(labels({ phase: 'reveal', played: 8, revealed: 2 })).toEqual(['Show the top 5 now', 'Crown Lydspor now…'])
    expect(labels({ phase: 'reveal', played: 8, revealed: 4 })).toEqual(['Skip the top 5: reveal song 5', 'Crown Lydspor now…'])
    expect(labels({ phase: 'reveal', played: 8, revealed: 8 })).toEqual(['Skip the top 5: crown Lydspor'])
    expect(labels({ phase: 'standings', played: 8, revealed: 8 })).toEqual([])
    for (const step of menuSteps(at({ phase: 'playing', played: 6 }))) expect(step.confirm).toBeDefined()
  })

  it('locks with every played prompt closed first, so the lock reads the final answers', () => {
    const lock = menuSteps(at({ phase: 'lastCall', played: 2 })).find((step) => step.action.type === 'lock')!
    expect(lock.close).toEqual(['s1.title', 's1.singer', 's1.event', 's2.title', 's2.singer', 's2.event'])
  })

  it('says which songs an early last call or crown leaves out', () => {
    const lastCall = menuSteps(at({ phase: 'playing', played: 6 }))[0]
    expect(lastCall.confirm).toEqual({
      title: 'Lock after song 6?',
      description: "Songs 7 and 8 won't play. The answers lock 60 s after you tap.",
      label: 'Last call',
    })
    const crown = menuSteps(at({ phase: 'reveal', played: 8, revealed: 7 })).find((step) => step.action.type === 'crown')!
    expect(crown.confirm!.description).toBe("Song 8 isn't revealed yet. It stays secret, and only the revealed songs count.")
    const early = menuSteps(at({ phase: 'locked', played: 8 })).find((step) => step.action.type === 'crown')!
    expect(early.confirm!.description).toBe('No song is revealed yet, so nobody scores and nobody wins.')
  })

  it('words a range of songs', () => {
    expect(songsLeft(8, 8, "won't play")).toBe("Song 8 won't play")
    expect(songsLeft(7, 8, "won't play")).toBe("Songs 7 and 8 won't play")
    expect(songsLeft(5, 8, "isn't revealed yet")).toBe("Songs 5 to 8 aren't revealed yet")
  })
})
