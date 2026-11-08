import { IconContext } from '@phosphor-icons/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'

// Phosphor's defaults with a bold weight: regular-weight icons look thin next to
// button text. The provider replaces the whole default context, so size and
// color must stay in it, or unsized icons lose their 1em size and stretch.
const iconDefaults = { color: 'currentColor', size: '1em', weight: 'bold', mirrored: false } as const

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={iconDefaults}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
)
