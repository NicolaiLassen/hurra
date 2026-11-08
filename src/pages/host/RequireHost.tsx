import { useCallback } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ErrorNotice, Loading } from '@/components/layout'
import { currentUser, isHost } from '@/lib/auth'
import { useLiveQuery } from '@/lib/useLiveQuery'

export default function RequireHost() {
  const check = useCallback(async () => ((await currentUser()) ? isHost() : false), [])
  const { data: host, error, retry } = useLiveQuery(check)
  const location = useLocation()

  if (error) return <ErrorNotice error={error} onRetry={retry} />
  if (host === undefined) return <Loading />
  // The login comes back here afterwards (e.g. the TV's scoreboard link).
  return host ? <Outlet /> : <Navigate to="/host/login" replace state={{ from: location.pathname + location.search }} />
}
