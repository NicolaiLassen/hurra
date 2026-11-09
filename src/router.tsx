import { createBrowserRouter } from 'react-router'
import { Loading, RouteError } from '@/components/layout'
import HostLayout from '@/pages/host/HostLayout'
import LazyScoreboard from '@/pages/host/LazyScoreboard'
import RequireHost from '@/pages/host/RequireHost'
import Home from '@/pages/Home'
import Join from '@/pages/Join'
import NotFound from '@/pages/NotFound'
import Play from '@/pages/Play'
import PlayerCard from '@/pages/PlayerCard'

// The guests' pages come with the app. The host's pages load on demand, so 45
// phones never download the control room, the settings editors or the recap.
const hostHome = async () => ({ Component: (await import('@/pages/host/HostHome')).default })
const hostLogin = async () => ({ Component: (await import('@/pages/host/HostLogin')).default })
const hostSession = async () => ({ Component: (await import('@/pages/host/HostSession')).default })
const recap = async () => ({ Component: (await import('@/pages/host/Recap')).default })
const scan = async () => ({ Component: (await import('@/pages/host/Scan')).default })

export const router = createBrowserRouter([
  {
    // A screen that throws, or a lazy page that fails to load, shows the app's
    // own error notice with Retry instead of the router's default page.
    errorElement: <RouteError />,
    // While the first page loads on demand, the loader stays up.
    hydrateFallbackElement: <Loading />,
    children: [
      // Players
      { path: '/', element: <Home /> },
      { path: '/join/:joinCode', element: <Join /> },
      { path: '/play/:joinCode', element: <Play /> },
      // Target of player QR codes: scoring screen for the host, info for others.
      { path: '/p/:playerCode', element: <PlayerCard /> },

      // The TV: a screen the host pairs with a code, never a host (docs/engine-v2.md, 7.2).
      { path: '/tv/:joinCode', element: <LazyScoreboard /> },

      // Host
      { path: '/host/login', lazy: hostLogin },
      {
        path: '/host',
        element: <RequireHost />,
        children: [
          {
            element: <HostLayout />,
            children: [
              { index: true, lazy: hostHome },
              { path: 's/:sessionId', lazy: hostSession },
              { path: 's/:sessionId/recap', lazy: recap },
              { path: 'scan', lazy: scan },
            ],
          },
        ],
      },

      { path: '*', element: <NotFound /> },
    ],
  },
])
