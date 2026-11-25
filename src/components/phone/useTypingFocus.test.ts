// Which focused elements count as typing (the code bar steps aside, and the
// phone home never scrolls under them). Node has no DOM, so the element
// classes are stood in for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTypingTarget } from '@/components/phone/useTypingFocus'

class FakeElement {
  isContentEditable = false
}
class FakeInput extends FakeElement {
  type: string
  readOnly: boolean
  disabled: boolean
  constructor(type: string, readOnly = false, disabled = false) {
    super()
    this.type = type
    this.readOnly = readOnly
    this.disabled = disabled
  }
}
class FakeTextArea extends FakeElement {
  readOnly = false
  disabled = false
}

describe('isTypingTarget', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', FakeTextArea)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is a text field, a text area or an editable element', () => {
    expect(isTypingTarget(new FakeInput('text') as never)).toBe(true)
    expect(isTypingTarget(new FakeInput('search') as never)).toBe(true)
    expect(isTypingTarget(new FakeTextArea() as never)).toBe(true)
    const editable = new FakeElement()
    editable.isContentEditable = true
    expect(isTypingTarget(editable as never)).toBe(true)
  })

  it('is not a button, a checkbox, a read-only or disabled field, or nothing', () => {
    expect(isTypingTarget(new FakeElement() as never)).toBe(false)
    expect(isTypingTarget(new FakeInput('checkbox') as never)).toBe(false)
    expect(isTypingTarget(new FakeInput('text', true) as never)).toBe(false)
    expect(isTypingTarget(new FakeInput('text', false, true) as never)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('is never true where there is no DOM (the server)', () => {
    vi.unstubAllGlobals()
    expect(isTypingTarget({} as never)).toBe(false)
  })
})
