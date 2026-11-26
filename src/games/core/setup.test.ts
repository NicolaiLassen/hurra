import { describe, expect, it } from 'vitest'
import { counted, lowerFirst, need, needsList, readyLine } from './setup'

describe('the readiness words', () => {
  it('counts what is left, with the verb that fits the count', () => {
    expect(needsList([need(2, 'a photo'), need(1, 'a caption'), need(0, 'a fix')])).toBe('2 need a photo, 1 needs a caption')
    expect(needsList([need(1, 'both its people', 'both their people'), need(3, 'both its people', 'both their people')])).toBe(
      '1 needs both its people, 3 need both their people',
    )
  })

  it('says how many are ready of how many, and what the rest need', () => {
    expect(readyLine(6, 8, ['song', 'songs'], [need(2, 'a photo')])).toBe('6 of 8 songs ready: 2 need a photo')
    expect(readyLine(8, 8, ['song', 'songs'], [])).toBe('8 songs ready')
    expect(readyLine(1, 1, ['song', 'songs'], [])).toBe('1 song ready')
    expect(readyLine(0, 1, ['picture', 'pictures'], [])).toBe('0 of 1 picture ready')
  })

  it('counts and lowers a first letter', () => {
    expect(counted(1, 'task')).toBe('1 task')
    expect(counted(12, 'task')).toBe('12 tasks')
    expect(lowerFirst('Add at least 2 extra photos')).toBe('add at least 2 extra photos')
    expect(lowerFirst('')).toBe('')
  })
})
