// The TV's shared look: motion and card chrome.
import type { Transition } from 'motion/react'

export const spring: Transition = { type: 'spring', stiffness: 260, damping: 28 }

/**
 * The TV's card chrome: a solid raised surface, told apart from the ground by
 * value, with no blur and no ring (docs/identity.md). The games' status cards
 * (their TvStatus) draw the same.
 */
export const CARD = 'rounded-3xl bg-raised'
