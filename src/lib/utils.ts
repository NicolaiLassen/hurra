// Class merging (cn: clsx plus tailwind-merge's rules), taught Hurra's own
// scales from src/index.css. Untaught, it reads text-tv-question as a colour
// and drops the text-paper beside it, and it keeps rounded-lg beside
// rounded-control, leaving the winner to the stylesheet's order.
// src/lib/utils.test.ts fails when a name in index.css is missing here.
import { createCn } from 'cn/config'

/** Hurra's names in Tailwind's font size, radius, easing and animation scales. */
export const THEME_SCALES = {
  text: [
    'tv-count', 'tv-lead', 'tv-cheer', 'tv-code', 'tv-question', 'tv-answer', 'tv-score', 'tv-name', 'tv-band', 'tv-field',
    'tv-body', 'tv-tab', 'tv-floor', 'phone-key', 'phone-place', 'phone-head', 'phone-action',
  ],
  radius: ['token', 'chip', 'tile', 'control', 'phone'],
  ease: ['tab'],
  animate: ['strap-in', 'tab-land', 'count-pop'],
}

export const cn = createCn({ extend: { theme: THEME_SCALES } })
