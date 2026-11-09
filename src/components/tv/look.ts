// The TV's shared look: motion and card chrome.
import type { Transition } from 'motion/react'

export const spring: Transition = { type: 'spring', stiffness: 260, damping: 28 }

/** The TV's card chrome, the same one the games' rail cards draw. */
export const CARD = 'rounded-3xl bg-card/80 ring-1 ring-foreground/10 backdrop-blur'

/** The rail's width, beside a game's screen. */
export const RAIL = 'w-96 short:w-88'
