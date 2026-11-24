import { SpeakerHighIcon, SpeakerLowIcon, SpeakerSlashIcon } from '@phosphor-icons/react'
import { useId, useRef, useState } from 'react'
import { useHostCall } from '@/components/host/hostCalls'
import { soundVolumeLabel, soundVolumeToast } from '@/components/host/scene'
import { Slider } from '@/components/ui/slider'
import { setSoundVolume } from '@/lib/queries'
import { type HeldLevel, newestOnly, soundVolumeOf, stillHeld } from '@/lib/soundVolume'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** Crossed out when off, more waves as it gets louder: beside the slider, in paper, never gold (docs/identity.md). */
function Speaker({ volume, className }: { volume: number; className?: string }) {
  if (volume <= 0) return <SpeakerSlashIcon className={className} />
  return volume <= 50 ? <SpeakerLowIcon className={className} /> : <SpeakerHighIcon className={className} />
}

/**
 * The TV's sound effects volume (docs/engine-v2.md, 7.3): a slider from Off to
 * 100% in steps of 5, with the level beside it. Only TV screens follow it
 * (paired TVs and a TV tab of this browser), so a computer that plays the party
 * music as well can keep Hurra's sounds under the music; phones keep their own
 * volume. The level saves when the host lets go (or with each arrow key), one
 * save at a time and the newest last. A saved change says so in a toast, and an
 * open TV plays a short sound at the new level. `tvOpen`: a TV is paired, or
 * open in this browser.
 */
export default function TvSoundControl({ sessionId, volume: stored, tvOpen }: { sessionId: string; volume: unknown; tvOpen: boolean }) {
  const volume = soundVolumeOf(stored)
  const call = useHostCall()
  const labelId = useId()
  const [enqueue] = useState(newestOnly)
  // The level under the host's finger while it drags.
  const [dragging, setDragging] = useState<number | null>(null)
  // The level the host set, shown until the snapshot has it (stillHeld).
  const [held, setHeld] = useState<HeldLevel | null>(null)
  const [seen, setSeen] = useState(volume)
  if (volume !== seen) {
    setSeen(volume)
    setHeld(stillHeld(held, volume))
  }
  const shown = dragging ?? held?.level ?? volume
  // A pointer drag saves the level it last moved to when it lets go: Radix
  // commits the value it last rendered, and a quick release can come before
  // that render. An arrow key saves the level Radix commits (key events render
  // at once, and Radix reports the commit before the change).
  const pointer = useRef(false)
  const moved = useRef<number | null>(null)

  function save(level: number) {
    if (level === (held?.level ?? volume)) return
    setHeld({ level, settled: false })
    enqueue(async (newest) => {
      const saved = await call(() => setSoundVolume(sessionId, level))
      if (!newest()) return
      if (!saved) {
        setHeld(null)
        return
      }
      setHeld((current) => (current?.level === level ? { level, settled: true } : current))
      toast.success(soundVolumeToast(level), {
        id: 'tv-sound-volume',
        description: level > 0 && tvOpen ? 'The TV plays a short sound at this level.' : undefined,
      })
    })
  }

  return (
    <div className="grid gap-3 border-t pt-3">
      <div className="min-w-0">
        <p className="text-sm font-extrabold">
          <span id={labelId}>TV sound effects</span>
        </p>
        <p className="mt-0.5 text-sm text-paper-2">Keep them under the party music. Phones keep their own volume.</p>
      </div>
      <div className="flex items-center gap-3">
        <Speaker volume={shown} className="size-5 shrink-0 text-paper-2" />
        <Slider
          className="h-9 min-w-0 flex-1"
          min={0}
          max={100}
          step={5}
          value={[shown]}
          onPointerDown={() => (pointer.current = true)}
          onKeyDown={() => (pointer.current = false)}
          onValueChange={([level]) => {
            if (!pointer.current) return
            moved.current = level
            setDragging(level)
          }}
          onPointerUp={() => {
            const level = moved.current
            moved.current = null
            setDragging(null)
            if (level !== null) save(level)
          }}
          onValueCommit={([level]) => {
            if (!pointer.current) save(level)
          }}
          thumbProps={{ 'aria-labelledby': labelId, 'aria-valuetext': soundVolumeLabel(shown) }}
        />
        {/* Condensed numerals, as wide for 5% as for 100%, so the slider never shifts while it moves. */}
        <span className={cn('tv-num w-14 shrink-0 text-right text-2xl leading-none', shown > 0 ? 'text-paper' : 'text-paper-2')}>
          {soundVolumeLabel(shown)}
        </span>
      </div>
    </div>
  )
}
