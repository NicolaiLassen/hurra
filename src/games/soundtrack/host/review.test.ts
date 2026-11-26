import { describe, expect, it } from 'vitest'
import { soundtrackSample } from '../samples'
import type { ReviewRow, SoundtrackState } from '../types'
import { acceptId, closeLeft, guests, reasonTag, scoringOn, songReview } from './review'

const NAMES = ['Ana', 'Bo', 'Clara', 'Sofie', 'Emil', 'Lars', 'Ida', 'Freja', 'Mads', 'Noah', 'Oscar', 'Karl']
const cast = { players: NAMES.map((name, i) => ({ id: `p${i}`, name })) }
const NOW = Date.UTC(2026, 10, 28, 20, 30)

describe("the host's review of a revealed song", () => {
  const sample = soundtrackSample('reveal', cast, NOW)
  const review = songReview(sample.state, sample.config, cast.players, 0)!

  it('agrees with the counts the TV shows, the accept included', () => {
    expect(sample.publicState.reveal).not.toBeNull()
    expect(review.of).toBe(sample.publicState.reveal!.scoring)
    expect(review.title.got).toBe(sample.publicState.reveal!.counts.title)
    expect(review.singer.got).toBe(sample.publicState.reveal!.counts.singer)
  })

  it('agrees on every revealed song in the final round', () => {
    const final = soundtrackSample('standings', cast, NOW)
    expect(final.state.revealed).toBe(4)
    const last = songReview(final.state, final.config, cast.players, 3)!
    expect([last.of, last.title.got, last.singer.got]).toEqual([
      final.publicState.reveal!.scoring,
      final.publicState.reveal!.counts.title,
      final.publicState.reveal!.counts.singer,
    ])
  })

  it('splits the rows: close to accept, wrong in a fold, typos counted already, exact left out', () => {
    expect(review.title.truth).toBe('Paper Lanterns')
    expect(review.title.close.every((row) => row.verdict === 'close')).toBe(true)
    expect(review.title.wrong.every((row) => row.verdict === 'wrong')).toBe(true)
    expect(review.title.typo.every((row) => row.verdict === 'typo')).toBe(true)
    // The close title the phone's guest and one more typed, accepted at the reveal.
    const accepted = review.title.close.find((row) => row.accepted)!
    expect(accepted.text).toBe('Papir Lanterner')
    expect(accepted.players).toHaveLength(2)
    expect(review.singer.close.map((row) => row.text)).toContain('Myra Holmes')
  })

  it('keeps in each row only the guests it can score for, and drops a row with none left', () => {
    const sofie = 'p3'
    // Sofie and Freja sit out now, by name as the host typed them: the close title counts for one guest only, the close singer for nobody.
    const state: SoundtrackState = { ...sample.state, sitOut: [...sample.state.sitOut, ' sofie', 'FREJA'] }
    const changed = songReview(state, sample.config, cast.players, 0)!
    expect(changed.title.close.find((row) => row.text === 'Papir Lanterner')!.players).toEqual(['p9'])
    expect(changed.singer.close.map((row) => row.text)).not.toContain('Myra Holmes')
    expect(scoringOn(state, cast.players).has(sofie)).toBe(false)
    expect(changed.of).toBe(review.of - 2)
  })

  it('leaves out guests who left the party', () => {
    const fewer = cast.players.filter((p) => p.id !== 'p9')
    expect(songReview(sample.state, sample.config, fewer, 0)!.title.close.find((row) => row.text === 'Papir Lanterner')!.players).toEqual(['p3'])
  })

  it('counts the close answers the host has not accepted yet, for the cue list', () => {
    const open = [...review.title.close, ...review.singer.close].filter((row) => !row.accepted).length
    expect(closeLeft(review)).toBe(open)
    expect(closeLeft(null)).toBe(0)
  })

  it('has nothing before the lock', () => {
    const playing = soundtrackSample('playing', cast, NOW)
    expect(songReview(playing.state, playing.config, cast.players, 0)).toBeNull()
  })
})

describe('the words of the review', () => {
  const row = (reason: ReviewRow['reason'], off: number | null = null) => ({ reason, off })
  it('tags each close answer with why it is close', () => {
    expect(reasonTag(row('spelling', 3), 'title')).toBe('3 letters off')
    expect(reasonTag(row('spelling', 1), 'title')).toBe('1 letter off')
    expect(reasonTag(row('part'), 'singer')).toBe('Part of it')
    expect(reasonTag(row('extra'), 'singer')).toBe('With extra words')
    expect(reasonTag(row('order'), 'title')).toBe('Words in another order')
    expect(reasonTag(row('otherPart'), 'title')).toBe("That's the singer")
    expect(reasonTag(row('otherPart'), 'singer')).toBe("That's the title")
  })

  it('counts guests and names each accept', () => {
    expect([guests(1), guests(2)]).toEqual(['1 guest', '2 guests'])
    expect(acceptId(0, 'title', 'papirlanterner')).toBe('accept:0:title:papirlanterner')
  })
})
