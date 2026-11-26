import { CornersInIcon, CornersOutIcon, SpeakerHighIcon, SpeakerSlashIcon, SunDimIcon, SunIcon } from '@phosphor-icons/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { togglePicture, usePicture } from '@/components/tv/picture'
import { isAudioUnlocked, playSound, subscribeAudio, unlockAudio, useSoundSetting } from '@/lib/sound'
import { cn } from '@/lib/utils'

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** A quiet control: 32 px, so the row fits the bottom gutter of a 720p screen (36 px). */
const CONTROL = 'inline-flex h-8 shrink-0 items-center gap-2 rounded-chip px-2 text-sm font-semibold text-paper-3 transition-colors hover:bg-raised hover:text-paper'

/**
 * The bottom-left corner: the laptop's controls, not the programme. Full
 * screen, sound (with "Click for sound" until the browser lets the TV play
 * any), the picture (Standard or Brighter) and the connection, quiet in
 * paper-3 in the gutter under the band, so it never covers the band or the
 * stage. A host's own browser says "Host preview".
 */
export default function Corner({ live, hostPreview }: { live: boolean; hostPreview: boolean }) {
  // The browser knows at once when the network drops; the realtime socket can take
  // up to a minute to notice, so the state doesn't wait for it.
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  return (
    <div data-frame="corner" data-safe-skip className="absolute bottom-0 left-0 z-20 flex h-[5vh] items-center gap-1 px-3">
      <FullscreenButton />
      <SoundButton />
      <PictureButton />
      <Connection live={live && online} />
      {hostPreview && <span className="ml-2 text-sm font-semibold text-paper-3">Host preview</span>}
    </div>
  )
}

/**
 * Sound on or off for the TV. Browsers keep audio locked until the page is
 * clicked, and nobody taps a TV: while sound is on but locked, the corner
 * says "Click for sound", and a click anywhere on the page unlocks it too
 * (src/lib/sound.ts). This button unlocks in its own click handler
 * (data-sound-toggle), so it acts on what was on screen.
 */
function SoundButton() {
  const [on, setOn] = useSoundSetting(true)
  const unlocked = useSyncExternalStore(subscribeAudio, isAudioUnlocked, () => false)
  const locked = on && !unlocked

  function press() {
    if (!locked) setOn(!on)
    if (locked || !on) void unlockAudio().then(() => playSound('chime'))
  }

  return (
    <button
      type="button"
      data-sound-toggle
      onClick={press}
      aria-label={locked ? undefined : on ? 'Turn sound off' : 'Turn sound on'}
      aria-pressed={locked ? undefined : on}
      className={cn(CONTROL, locked ? 'bg-raised px-3 text-paper-2' : 'opacity-60 hover:opacity-100')}
    >
      {on ? <SpeakerHighIcon className="size-4" /> : <SpeakerSlashIcon className="size-4" />}
      {locked && 'Click for sound'}
    </button>
  )
}

/**
 * Brighter picture, for a TV that shows dark tones as black: the same look
 * with its dark end raised (picture.ts). Pressed while it is on; each TV
 * remembers its own.
 */
export function PictureButton() {
  const bright = usePicture() === 'bright'
  return (
    <button
      type="button"
      data-picture-toggle
      onClick={togglePicture}
      aria-label="Brighter picture"
      aria-pressed={bright}
      title={bright ? 'Brighter picture is on. Click for the standard picture' : 'Brighter picture, for a TV that shows dark tones as black'}
      className={cn(CONTROL, 'opacity-60 hover:opacity-100')}
    >
      {bright ? <SunIcon weight="fill" className="size-4" /> : <SunDimIcon className="size-4" />}
    </button>
  )
}

/** "Live" while updates arrive as they happen; "Reconnecting" a step brighter while the TV polls instead. A word, never a coloured dot. */
function Connection({ live }: { live: boolean }) {
  return (
    <span
      role="status"
      title={live ? 'Live: updates arrive as they happen' : 'Reconnecting: checking for updates every few seconds'}
      className={cn('px-2 text-sm font-semibold', live ? 'text-paper-3 opacity-60' : 'text-paper-2')}
    >
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
    <button
      type="button"
      className={cn(CONTROL, 'opacity-60 hover:opacity-100')}
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      onClick={() => void (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
    >
      {fullscreen ? <CornersInIcon className="size-4" /> : <CornersOutIcon className="size-4" />}
    </button>
  )
}
