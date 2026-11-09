import { describe, expect, it } from 'vitest'
import { cleanCode } from './pairing'

describe('cleanCode', () => {
  it('keeps capitals and digits, at most 6', () => {
    expect(cleanCode('k7m-2qx')).toBe('K7M2QX')
    expect(cleanCode(' ab cd ef gh ')).toBe('ABCDEF')
    expect(cleanCode('')).toBe('')
  })
})
