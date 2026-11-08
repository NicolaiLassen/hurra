import { describe, expect, it } from 'vitest'
import { createGameContext } from './context'
import { testInfo } from './testing'

/** Half of a surrogate pair with no partner: what a cut through an emoji leaves behind. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

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
})
