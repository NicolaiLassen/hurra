import { describe, expect, it } from 'vitest'
import { createGameContext, emptyEffects, hasEffects } from './context'
import { testInfo } from './testing'

/** Half of a surrogate pair with no partner: what a cut through an emoji leaves behind. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

const spec = { kind: 'choice', options: ['0', '1'], final: true } as const

describe('createGameContext', () => {
  it('cuts long text by characters, never through the middle of an emoji', () => {
    const { ctx, effects } = createGameContext(testInfo({}, ['ana']))
    // 279 letters, then emoji that take two UTF-16 code units each.
    ctx.announce('a'.repeat(279) + '🎉🎉', { detail: '🎉'.repeat(300) })
    ctx.awardPoints('ana', 1, 'b'.repeat(199) + '🎉🎉')
    const [announcement] = effects.announcements
    const [points] = effects.points

    expect(Array.from(announcement.message)).toHaveLength(280)
    expect(announcement.message.endsWith('🎉')).toBe(true)
    expect(Array.from(announcement.detail ?? '')).toHaveLength(280)
    expect(Array.from(points.reason)).toHaveLength(200)
    for (const text of [announcement.message, announcement.detail ?? '', points.reason]) {
      expect(text).not.toMatch(LONE_SURROGATE)
    }
  })

  it('treats an effect for an unknown player as a bug by default', () => {
    const { ctx } = createGameContext(testInfo({}, ['ana']))
    expect(() => ctx.awardPoints('gone', 1, 'x')).toThrow('Unknown player gone')
    expect(() => ctx.updateProfile('gone', {})).toThrow('Unknown player gone')
    expect(() => ctx.announce('Hi', { to: ['gone'] })).toThrow('Unknown player gone')
    expect(() => ctx.awardPoints('ana', 1.5, 'x')).toThrow('whole numbers')
  })

  it("skips effects for players who left in the engine's skip mode, and reports them", () => {
    const { ctx, effects, skipped } = createGameContext(testInfo({}, ['ana', 'bo']), Math.random, { unknownPlayers: 'skip' })
    ctx.awardPoints('gone', 2, 'x')
    ctx.updateProfile('gone', { wins: 1 })
    ctx.announce('For Ana and the one who left', { to: ['ana', 'gone'] })
    ctx.announce('Only for the one who left', { to: ['gone'] })
    ctx.record('fact', { n: 1 }, { about: ['bo', 'gone'] })

    expect(effects.points).toEqual([])
    expect(effects.profiles).toEqual({})
    // A targeted announcement keeps who is present and is dropped, never made public, when nobody is.
    expect(effects.announcements).toEqual([{ message: 'For Ana and the one who left', to: ['ana'] }])
    expect(effects.records).toEqual([{ type: 'fact', data: { n: 1 }, about: ['bo'] }])
    expect(skipped).toHaveLength(5)
  })

  it('keeps the interrupt flag and the other display options', () => {
    const { ctx, effects } = createGameContext(testInfo({}, ['ana']))
    ctx.announce('Ana wins!', { icon: 'crown', sound: 'fanfare', tone: 'gold', interrupt: true })
    expect(effects.announcements).toEqual([
      { message: 'Ana wins!', icon: 'crown', sound: 'fanfare', tone: 'gold', interrupt: true },
    ])
  })

  it('checks prompt keys: the database format, and once per round', () => {
    const info = testInfo({}, ['ana'], {
      prompts: { q1: { key: 'q1', spec, openedAt: 0, closesAt: null, closedAt: null, revealedAt: null } },
    })
    const { ctx, effects } = createGameContext(info)
    expect(() => ctx.openPrompt('bad key!', spec)).toThrow('Prompt keys')
    expect(() => ctx.openPrompt('x'.repeat(65), spec)).toThrow('Prompt keys')
    expect(() => ctx.openPrompt('q1', spec)).toThrow('already opened')
    ctx.openPrompt('q2', spec, { closesAt: 1234.6 })
    expect(() => ctx.openPrompt('q2', spec)).toThrow('already opened')
    expect(() => ctx.closePrompt('q9')).toThrow('never opened')
    expect(() => ctx.revealPrompt('q9')).toThrow('never opened')
    ctx.closePrompt('q2')
    ctx.closePrompt('q2')
    ctx.revealPrompt('q1')
    expect(effects.prompts).toEqual({ open: [{ key: 'q2', spec, closes_at: 1235 }], close: ['q2'], reveal: ['q1'] })
  })

  it('shares effects with a second context, as the member hooks run', () => {
    const info = testInfo({}, ['ana', 'bo'])
    const main = createGameContext(info)
    const system = createGameContext(info, Math.random, { actor: { kind: 'system' }, effects: main.effects })
    main.ctx.openPrompt('p1', spec)
    expect(() => system.ctx.openPrompt('p1', spec)).toThrow('already opened')
    system.ctx.awardPoints('bo', 1, 'Welcome')
    expect(main.effects.points).toEqual([{ player_id: 'bo', points: 1, reason: 'Welcome' }])
    expect(main.ctx.actor).toEqual({ kind: 'host' })
    expect(system.ctx.actor).toEqual({ kind: 'system' })
  })

  it('says whether anything happened', () => {
    expect(hasEffects(emptyEffects())).toBe(false)
    const { ctx, effects } = createGameContext(testInfo({}, ['ana']))
    ctx.updateSessionData({ round: 2 })
    expect(hasEffects(effects)).toBe(true)
  })
})
