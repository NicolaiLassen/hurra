import { createBrowserRouter } from 'react-router'
import { RouteError } from '@/components/layout'
import HostHome from '@/pages/host/HostHome'
import HostLayout from '@/pages/host/HostLayout'
import HostLogin from '@/pages/host/HostLogin'
import HostSession from '@/pages/host/HostSession'
import LazyScoreboard from '@/pages/host/LazyScoreboard'
import RequireHost from '@/pages/host/RequireHost'
import Scan from '@/pages/host/Scan'
import Home from '@/pages/Home'
import Join from '@/pages/Join'
import NotFound from '@/pages/NotFound'
import Play from '@/pages/Play'
import PlayerCard from '@/pages/PlayerCard'

export const router = createBrowserRouter([
  {
    // A screen that throws, or a lazy chunk that fails to load, shows the app's
    // own error notice with Retry instead of the router's default page.
    errorElement: <RouteError />,
    children: [
      // Players
      { path: '/', element: <Home /> },
      { path: '/join/:joinCode', element: <Join /> },
      { path: '/play/:joinCode', element: <Play /> },
      // Target of player QR codes: scoring screen for the host, info for others.
      { path: '/p/:playerCode', element: <PlayerCard /> },

      // Host
      { path: '/host/login', element: <HostLogin /> },
      {
        path: '/host',
        element: <RequireHost />,
        children: [
          {
            element: <HostLayout />,
            children: [
              { index: true, element: <HostHome /> },
              { path: 's/:sessionId', element: <HostSession /> },
              { path: 'scan', element: <Scan /> },
            ],
          },
          { path: 's/:sessionId/scoreboard', element: <LazyScoreboard /> },
        ],
      },

      { path: '*', element: <NotFound /> },
    ],
  },
])
