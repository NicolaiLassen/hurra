// The host page's calls (docs/engine-v2.md, 7.3). A refusal is a toast in the
// server's own words. A success reads the snapshot again at once: this screen
// gets no ping for its own call, so a lost ping never stalls it.
import { useCallback } from 'react'
import { callGame } from '@/lib/queries'
import { toast } from '@/lib/toast'
import { useLive } from '@/lib/useLive'

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'
}

/**
 * Runs one of the host's calls: on success it refreshes the snapshot (and
 * shows `success` as a toast, if given); a refusal is a toast. Resolves to
 * whether it worked, never rejects.
 */
export function useHostCall(): (run: () => Promise<unknown>, success?: string) => Promise<boolean> {
  const { refresh } = useLive()
  return useCallback(
    async (run, success) => {
      try {
        await run()
      } catch (error) {
        toast.error(errorMessage(error))
        return false
      }
      refresh()
      if (success) toast.success(success)
      return true
    },
    [refresh],
  )
}

/**
 * A game's HostViewProps.act. A skipped or replayed action counts as success.
 * A refusal is this wrapper's toast, then a rejection, so the view's button
 * leaves its pending state and the view stays quiet (6, 7.3).
 */
export function useHostAct(gameId: string): (action: unknown, options?: { close?: string[] }) => Promise<void> {
  const { refresh } = useLive()
  return useCallback(
    async (action, options) => {
      try {
        await callGame({ type: 'host-action', gameId, action, ...(options?.close?.length ? { close: options.close } : {}) })
      } catch (error) {
        toast.error(errorMessage(error))
        throw error
      }
      refresh()
    },
    [gameId, refresh],
  )
}
