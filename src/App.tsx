import { useEffect } from 'react'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from '@/components/ui/sonner'
import { startLoader } from '@/lib/loader'
import { router } from '@/router'

export default function App() {
  // Runs after every screen's own effects in the first render, so the splash
  // only leaves once the first screen has said whether it's still loading.
  useEffect(() => startLoader(), [])

  return (
    <>
      <RouterProvider router={router} />
      {/* On a phone the toasts stand 10 px over the Show my code bar as tall as it is now (96 px at rest), so a task turned over on the bar pushes them up. */}
      <Toaster position="bottom-center" offset={24} mobileOffset={{ bottom: 'calc(var(--phone-bar-height, 86px) + 10px)' }} />
    </>
  )
}
