import { lazy, Suspense } from 'react'
import { Loading } from '@/components/layout'

// Loaded on demand so guests' phones don't download the animation library.
const Scoreboard = lazy(() => import('@/pages/host/Scoreboard'))

export default function LazyScoreboard() {
  return (
    <Suspense fallback={<Loading />}>
      <Scoreboard />
    </Suspense>
  )
}
