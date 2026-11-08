import type { ReactNode } from 'react'
import { ErrorNotice, Loading } from '@/components/layout'
import type { LiveQuery } from '@/lib/useLiveQuery'

/**
 * A screen's main query in every state: the loader while it loads, `notFound`
 * when there's nothing there (null), the error with Retry, and otherwise the
 * screen itself. Pages never treat "no data" as "still loading".
 */
export default function QueryGate<T>({
  query,
  notFound,
  children,
}: {
  query: LiveQuery<T | null>
  notFound: ReactNode
  children: (data: T) => ReactNode
}) {
  // A failed reload keeps the data on screen (useLiveQuery retries it), so errors only show without data.
  if (query.data === undefined) return query.error ? <ErrorNotice error={query.error} onRetry={query.retry} /> : <Loading />
  if (query.data === null) return notFound
  return children(query.data)
}
