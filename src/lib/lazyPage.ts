// The host's pages load on demand (router.tsx), and so do the games' TV
// screens (lazyScreen). A deploy replaces the site's files, and a tab opened
// before it still runs the old app, which asks for a page by its old file name
// (assets/Recap-<hash>.js). That file is gone, the site answers with its
// index.html, and the import fails: the host pressed Recap and got "Something
// went wrong" until Retry reloaded the tab. So a page whose file fails to load
// while the site answers loads the new app straight at the address the host
// was going to, under the loader, and the page shows right after it.
import { lazy, type ComponentType } from 'react'

/**
 * What browsers say when a module's file didn't load, and Vite's preload of its
 * CSS. Chrome and Firefox say the same whatever came back. Safari (every iPhone
 * browser) says "Importing a module script failed." for a 404 or no answer, and
 * for the site's index.html in the file's place, which is how Netlify answers a
 * file a deploy removed: "'text/html' is not a valid JavaScript MIME type."
 */
const MISSING_CODE = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|is not a valid javascript mime type|unable to preload css/i

export function isMissingCode(error: unknown): boolean {
  return MISSING_CODE.test(error instanceof Error ? error.message : String(error))
}

export type Reloader = {
  /** Whether the site answers: with the network down a reload would only lose the page, so its error shows instead. */
  siteAnswers(): Promise<boolean>
  /**
   * Loads the app afresh at `href` (null: this address), unless it just did for
   * new code (a deploy that is itself broken): then false, and the error shows with Retry.
   */
  reload(href: string | null): boolean
}

const RELOADED_AT = 'hurra:reloaded-for-new-code'
/** A second missing page this soon after reloading for one is not a new deploy: its error shows. */
const AGAIN_AFTER_MS = 60_000

const browserReloader: Reloader = {
  async siteAnswers() {
    if (navigator.onLine === false) return false
    try {
      return (await fetch('/', { method: 'HEAD', cache: 'no-store' })).ok
    } catch {
      return false
    }
  },
  reload(href) {
    try {
      if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < AGAIN_AFTER_MS) return false
      sessionStorage.setItem(RELOADED_AT, String(Date.now()))
    } catch {
      // Nowhere to remember it, so no way to stop a loop: the error shows, and Retry reloads.
      return false
    }
    if (href) {
      // Back may bring this old app out of the browser's back/forward cache,
      // its navigation still loading (Safari keeps it there): it loads afresh instead.
      window.addEventListener(
        'pageshow',
        (event) => {
          if (event.persisted) window.location.reload()
        },
        { once: true },
      )
      window.location.assign(href)
    } else window.location.reload()
    return true
  },
}

/**
 * Loads a page's module. When the deploy it was built from is gone, the app
 * loads afresh at `destination()` (where the navigation was going; null for
 * this address) and this never settles, so the loader stays up meanwhile.
 */
export async function loadPage<T>(
  load: () => Promise<T>,
  destination: () => string | null = () => null,
  reloader: Reloader = browserReloader,
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (!isMissingCode(error) || !(await reloader.siteAnswers()) || !reloader.reload(destination())) throw error
    return new Promise<T>(() => {})
  }
}

/** A route's `lazy` for a page module with a default export; `destination` as for loadPage. */
export function lazyPage(load: () => Promise<{ default: ComponentType }>, destination?: () => string | null) {
  return async () => ({ Component: (await loadPage(load, destination)).default })
}

/**
 * A screen that loads on demand, as React's `lazy`, plus `preload()` to load
 * its file now. The TV runs all evening, deploys included, so it loads every
 * game's TV screens as it opens (preloadTvScreens in src/games/registry.ts): a
 * module the page has loaded stays in it, and no later deploy can take it away.
 * A screen whose file is gone all the same loads the new app at this address
 * (loadPage). A preload that fails for another reason stays quiet: the screen
 * tries again when it shows. Game modules get it from @/games/types.
 */
export function lazyScreen<P>(load: () => Promise<{ default: ComponentType<P> }>) {
  const screen = () => loadPage(load)
  return Object.assign(lazy(screen), {
    preload: async () => {
      await screen().catch(() => {})
    },
  })
}
