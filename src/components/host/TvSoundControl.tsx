import { SpeakerHighIcon, SpeakerLowIcon, SpeakerSlashIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import { useHostCall } from '@/components/host/hostCalls'
import { soundVolumeLabel, soundVolumeToast } from '@/components/host/scene'
import { Button } from '@/components/ui/button'
import { setSoundVolume } from '@/lib/queries'
import { SOUND_VOLUME_STEPS, soundVolumeOf } from '@/lib/soundVolume'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** Crossed out when off, more waves as it gets louder. */
function Speaker({ volume, className }: { volume: number; className?: string }) {
  if (volume <= 0) return <SpeakerSlashIcon className={className} />
  return volume <= 50 ? <SpeakerLowIcon className={className} /> : <SpeakerHighIcon className={className} />
}

/**
 * The TV's sound effects volume (docs/engine-v2.md, 7.3): steps from Off to
 * 100%, the party's current one in gold. Only TV screens follow it (paired TVs
 * and a TV tab of this browser), so a computer that plays the party music as
 * well can keep Hurra's sounds under the music; phones keep their own volume.
 * A change says so in a toast, and an open TV plays a short sound at the new
 * level. `tvOpen`: a TV is paired, or open in this browser.
 */
export default function TvSoundControl({ sessionId, volume: stored, tvOpen }: { sessionId: string; volume: unknown; tvOpen: boolean }) {
  const volume = soundVolumeOf(stored)
  const call = useHostCall()
  const [pending, setPending] = useState<number | null>(null)
  const labelId = useId()
  // The step just tapped shows at once; the snapshot confirms it a moment later.
  const shown = pending ?? volume

  async function pick(step: number) {
    if (pending !== null || step === volume) return
    setPending(step)
    const changed = await call(() => setSoundVolume(sessionId, step))
    setPending(null)
    if (changed) {
      toast.success(soundVolumeToast(step), {
        description: step > 0 && tvOpen ? 'The TV plays a short sound at this level.' : undefined,
      })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
      <div className="min-w-0 flex-1 basis-56">
        <p id={labelId} className="flex items-center gap-2 text-sm font-medium">
          <Speaker volume={shown} className={cn('size-4', shown > 0 ? 'text-primary' : 'text-muted-foreground')} />
          TV sound effects
          {/* Set some other way (not one of the steps): say what it is. */}
          {!SOUND_VOLUME_STEPS.includes(shown) && <span className="text-muted-foreground tabular-nums">{shown}%</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Keep them under the party music. Phones keep their own volume.</p>
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex w-full gap-1 rounded-lg bg-background p-1 ring-1 ring-foreground/10 sm:w-auto"
      >
        {SOUND_VOLUME_STEPS.map((step) => (
          <Button
            key={step}
            variant={step === shown ? 'default' : 'ghost'}
            aria-pressed={step === shown}
            isPending={pending === step}
            className={cn('h-9 flex-1 px-3 font-semibold tabular-nums sm:h-8 sm:flex-none', step !== shown && 'text-muted-foreground')}
            onClick={() => void pick(step)}
          >
            {soundVolumeLabel(step)}
          </Button>
        ))}
      </div>
    </div>
  )
}
