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
      <Toaster position="bottom-center" offset={24} mobileOffset={{ bottom: 96 }} />
    </>
  )
}
