import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { loaderShowing, useLoaderHold } from '@/lib/loader'
import { cn } from '@/lib/utils'

export function Screen({ children, wide = false, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <main className={cn('mx-auto w-full px-4 py-8', wide ? 'max-w-5xl' : 'max-w-md', className)}>{children}</main>
}

/**
 * A screen that's still loading. The loader itself is the app's one overlay
 * (#splash in index.html, timed by src/lib/loader.ts); this holds it up and
 * keeps the page's place.
 */
export function Loading() {
  useLoaderHold()
  return <div aria-busy="true" className="min-h-dvh" />
}

/**
 * A Suspense fallback for part of a screen, such as a game's lazy TV view. It
 * keeps the loader up if it's still showing (the first open). Otherwise it
 * holds the loader only once the wait outlasts the 300ms React keeps any
 * fallback on screen, so a quick load never flashes it.
 */
export function LoadingPart() {
  const [slow, setSlow] = useState(loaderShowing)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 300)
    return () => clearTimeout(timer)
  }, [])
  useLoaderHold(slow)
  return null
}

/** A full-screen message: what happened, and buttons for the way on (`actions`). */
export function Notice({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <Screen>
      <Card className="mt-[20dvh]">
        <CardHeader>
          <CardTitle className="text-xl font-bold">{title}</CardTitle>
          {children && <CardDescription className="text-base">{children}</CardDescription>}
        </CardHeader>
        {actions && <CardContent className="grid gap-2">{actions}</CardContent>}
      </Card>
    </Screen>
  )
}

/**
 * What browsers say when a request never got an answer (Chrome, Firefox,
 * Safari), including a lazy chunk that didn't load (e.g. on bad Wi-Fi, or an old
 * chunk name after a deploy, which a reload fixes).
 */
const NETWORK_ERROR =
  /failed to fetch|networkerror|load failed|network request failed|importing a module script failed|dynamically imported module/i

/** A query that failed, with Retry (a page reload when there's no query to retry). */
export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const offline = NETWORK_ERROR.test(error.message)
  return (
    <Notice
      title="Something went wrong"
      actions={
        <Button size="xl" variant="secondary" onClick={onRetry ?? (() => window.location.reload())}>
          <ArrowClockwiseIcon />
          Retry
        </Button>
      }
    >
      {offline ? "Couldn't reach the party. Check your connection, then try again." : error.message}
    </Notice>
  )
}

/** A screen that threw while rendering, or a lazy chunk that failed to load (e.g. after a deploy). Retry reloads the page. */
export function RouteError() {
  const error = useRouteError()
  return <ErrorNotice error={error instanceof Error ? error : new Error(String(error))} />
}
