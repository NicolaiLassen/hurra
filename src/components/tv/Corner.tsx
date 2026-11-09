import { CornersInIcon, CornersOutIcon } from '@phosphor-icons/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import SoundToggle from '@/components/SoundToggle'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/**
 * The bottom-left corner, in the gutter below every scene so it never covers
 * the board: full screen, sound, and the live dot (teal while pings arrive,
 * grey while the TV polls instead). A host's own browser says "Host preview".
 */
export default function Corner({ live, hostPreview }: { live: boolean; hostPreview: boolean }) {
  // The browser knows at once when the network drops; the realtime socket can take
  // up to a minute to notice, so the dot doesn't wait for it.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
      <FullscreenButton />
      <SoundToggle prompt className="opacity-60 hover:opacity-100" />
      <LiveDot live={live && online} />
      {hostPreview && (
        <span className="ml-2 rounded-full bg-card/80 px-3 py-1 text-sm font-semibold text-muted-foreground ring-1 ring-foreground/10">
          Host preview
        </span>
      )}
    </div>
  )
}

function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      role="status"
      title={live ? 'Live: updates arrive as they happen' : 'Reconnecting: checking for updates every few seconds'}
      className="flex items-center gap-2 px-2 text-sm text-muted-foreground opacity-70"
    >
      <span className="relative flex size-3">
        {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-confetti-teal opacity-75 motion-reduce:animate-none" />}
        <span className={cn('relative inline-flex size-3 rounded-full', live ? 'bg-confetti-teal' : 'bg-muted-foreground/70')} />
      </span>
      {live ? 'Live' : 'Reconnecting'}
    </span>
  )
}

function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="text-muted-foreground opacity-40 hover:opacity-100"
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      onClick={() => void (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
    >
      {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
    </Button>
  )
}
