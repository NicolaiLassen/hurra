import { IconContext } from '@phosphor-icons/react'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { holdLoaderForFonts } from '@/lib/fonts'
import '@/index.css'

// The first screen waits under the loader until its fonts are in (src/lib/fonts.ts).
holdLoaderForFonts()

// Phosphor's defaults with a bold weight: regular-weight icons look thin next to
// button text. The provider replaces the whole default context, so size and
// color must stay in it, or unsized icons lose their 1em size and stretch.
const iconDefaults = { color: 'currentColor', size: '1em', weight: 'bold', mirrored: false } as const

// Every motion animation follows the device's reduced motion setting: moves and
// scales are skipped, fades stay. MotionConfig and its context add under 2 KB to
// the first load; the animation library itself still loads only with the TV's
// screens, which read this same context.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <IconContext.Provider value={iconDefaults}>
        <App />
      </IconContext.Provider>
    </MotionConfig>
  </StrictMode>,
)
