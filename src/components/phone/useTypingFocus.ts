// Whether the guest is typing on this phone: a text field has the focus.
// Generic, for every game: the phone home steps the Show my code bar aside
// while it is true, for the browsers that lift a fixed bar above the keyboard
// (most keep it behind), and never scrolls the page under the guest's fingers.
import { useSyncExternalStore } from 'react'

/** Input types that open a keyboard for text. */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number'])

/** Whether an element takes typed text: a text field, a text area or an editable element. */
export function isTypingTarget(element: EventTarget | null | undefined): boolean {
  if (typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) return false
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && TEXT_TYPES.has(element.type)
  return element.isContentEditable
}

// One value for every subscriber. Focus moving from one field straight to
// another (a keyboard's Next) stays true throughout: focusout names where the
// focus goes, so the bar never flashes back for a frame between two fields.
let typing = false

function subscribe(onChange: () => void) {
  typing = isTypingTarget(document.activeElement)
  const onFocusIn = (event: FocusEvent) => {
    typing = isTypingTarget(event.target)
    onChange()
  }
  const onFocusOut = (event: FocusEvent) => {
    typing = isTypingTarget(event.relatedTarget)
    onChange()
  }
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  return () => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
  }
}

/** The store behind useTypingFocus: subscribe to focus changes, then read whether a text field has the focus. */
export const typingStore = { subscribe, read: () => typing }

/** True while a text field on the page has the focus. */
export function useTypingFocus(): boolean {
  return useSyncExternalStore(typingStore.subscribe, typingStore.read, () => false)
}
