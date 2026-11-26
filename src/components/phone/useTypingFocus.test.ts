// Which focused elements count as typing (the code bar steps aside, and the
// phone home never scrolls under them), and how the focus moving between
// fields keeps the bar aside. Node has no DOM, so the element classes and the
// document are stood in for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTypingTarget, typingStore } from '@/components/phone/useTypingFocus'

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

/** A focus event as the browser sends it: its target, and where the focus goes (focusout) or came from. */
function focusEvent(type: 'focusin' | 'focusout', target: unknown, relatedTarget: unknown = null): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'target', { value: target })
  Object.assign(event, { relatedTarget })
  return event
}

describe('typingStore', () => {
  const page = Object.assign(new EventTarget(), { activeElement: null as unknown })
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', FakeElement)
    vi.stubGlobal('HTMLInputElement', FakeInput)
    vi.stubGlobal('HTMLTextAreaElement', FakeTextArea)
    vi.stubGlobal('document', page)
    page.activeElement = null
  })
  afterEach(() => vi.unstubAllGlobals())

  it('turns true when a text field takes the focus, and false when the focus leaves for no field', () => {
    const changed = vi.fn()
    const stop = typingStore.subscribe(changed)
    expect(typingStore.read()).toBe(false)
    const title = new FakeInput('text')
    page.dispatchEvent(focusEvent('focusin', title))
    expect(typingStore.read()).toBe(true)
    page.dispatchEvent(focusEvent('focusout', title, null))
    expect(typingStore.read()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stays true while the focus moves from one field straight to the next (a keyboard’s Next)', () => {
    const stop = typingStore.subscribe(() => undefined)
    const title = new FakeInput('text')
    const singer = new FakeInput('text')
    page.dispatchEvent(focusEvent('focusin', title))
    const seen: boolean[] = []
    const watch = typingStore.subscribe(() => seen.push(typingStore.read()))
    page.dispatchEvent(focusEvent('focusout', title, singer))
    page.dispatchEvent(focusEvent('focusin', singer, title))
    expect(seen).toEqual([true, true])
    // A button takes the focus: not typing.
    page.dispatchEvent(focusEvent('focusout', singer, new FakeInput('button')))
    expect(typingStore.read()).toBe(false)
    watch()
    stop()
  })

  it('reads the field that has the focus when it subscribes, and stops listening when it unsubscribes', () => {
    page.activeElement = new FakeTextArea()
    const changed = vi.fn()
    const stop = typingStore.subscribe(changed)
    expect(typingStore.read()).toBe(true)
    stop()
    page.dispatchEvent(focusEvent('focusout', page.activeElement, null))
    expect(changed).not.toHaveBeenCalled()
  })
})
