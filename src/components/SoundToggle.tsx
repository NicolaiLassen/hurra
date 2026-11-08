import { SpeakerHighIcon, SpeakerSlashIcon } from '@phosphor-icons/react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { isAudioUnlocked, playSound, subscribeAudio, unlockAudio, useSoundSetting } from '@/lib/sound'
import { cn } from '@/lib/utils'

/**
 * Sound on/off for this device, as a compact icon button that keeps its size in
 * every state. Browsers keep audio locked until the page is tapped: while sound
 * is on but still locked, a gold dot marks the icon and tapping it unlocks audio.
 * The TV passes `prompt`, since nobody taps it: there the locked state is a small
 * "Click for sound" pill instead.
 */
export default function SoundToggle({ prompt = false, className }: { prompt?: boolean; className?: string }) {
  const [on, setOn] = useSoundSetting()
  const unlocked = useSyncExternalStore(subscribeAudio, isAudioUnlocked, () => false)
  const locked = on && !unlocked

  // Acts on what was on screen: a press that starts on the toggle doesn't unlock
  // audio through the page-wide gesture listener (see data-sound-toggle in
  // sound.ts), so `locked` can't change between the press and this click.
  function press() {
    if (!locked) setOn(!on)
    if (locked || !on) void unlockAudio().then(() => playSound('chime'))
  }

  if (locked && prompt) {
    return (
      <Button
        variant="ghost"
        size="lg"
        className={cn('rounded-full bg-card/80 px-4 text-muted-foreground ring-1 ring-foreground/10', className)}
        data-sound-toggle
        onClick={press}
      >
        <SpeakerHighIcon />
        Click for sound
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className={cn('relative text-muted-foreground', className)}
      aria-label={locked ? 'Turn on sound' : on ? 'Turn sound off' : 'Turn sound on'}
      aria-pressed={locked ? undefined : on}
      data-sound-toggle
      onClick={press}
    >
      {on ? <SpeakerHighIcon /> : <SpeakerSlashIcon />}
      {locked && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />}
    </Button>
  )
}
