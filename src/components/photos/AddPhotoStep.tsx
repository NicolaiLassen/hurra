import { ArrowClockwiseIcon, ArrowRightIcon, CameraIcon, ImagesIcon, SpinnerIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import Avatar from '@/components/Avatar'
import { Screen } from '@/components/layout'
import Logo from '@/components/Logo'
import { usePhotoPicker, usePhotoSave } from '@/components/photos/PhotoControls'
import { Button } from '@/components/ui/button'
import type { PlayerRow, PublicSession } from '@/lib/types'

/** The step's buttons: before a photo, with one saved here, or with Try again after a save the connection lost. */
type Layout = 'fresh' | 'saved' | 'retry'
type Tap = 'selfie' | 'library' | 'retry'

/**
 * "Add a photo" on the join page, right after Let's go (docs/guest-photos.md,
 * 6.1). Join holds it above its membership reload, so coming back from the
 * camera app never skips it. It never blocks joining: Skip for now works at
 * every moment, and a save it leaves finishes in the background.
 */
export default function AddPhotoStep({ player, onDone }: { party: PublicSession; player: PlayerRow; onDone: () => void }) {
  const save = usePhotoSave(player)
  const picker = usePhotoPicker((file) => void save.save(file))
  const saving = save.status === 'saving'
  const saved = save.savedPath !== null
  const now: Layout = save.canRetry ? 'retry' : saved ? 'saved' : 'fresh'
  // While a photo saves, the buttons stay as they were when it was tapped, the tapped one spinning.
  const [tap, setTap] = useState<{ which: Tap; layout: Layout } | null>(null)
  const layout = saving && tap ? tap.layout : now
  const spinning = (which: Tap) => saving && tap?.which === which

  const pick = (which: 'selfie' | 'library', variant: 'default' | 'secondary' | 'ghost') => {
    const Icon = which === 'selfie' ? CameraIcon : ImagesIcon
    return (
      <Button
        size={variant === 'ghost' ? 'lg' : 'xl'}
        variant={variant}
        disabled={saving}
        isPending={spinning(which)}
        onClick={() => {
          setTap({ which, layout: now })
          if (which === 'selfie') picker.takeSelfie()
          else picker.choosePhoto()
        }}
      >
        {spinning(which) ? <SpinnerIcon className="animate-spin" /> : <Icon />}
        {which === 'selfie' ? (saved ? 'Take another' : 'Take a selfie') : saved ? 'Choose another' : 'Choose a photo'}
      </Button>
    )
  }
  const leave = (variant: 'default' | 'ghost') =>
    saved ? (
      <Button size={variant === 'ghost' ? 'lg' : 'xl'} variant={variant} onClick={onDone}>
        Continue
        <ArrowRightIcon />
      </Button>
    ) : (
      <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={onDone}>
        Skip for now
      </Button>
    )

  return (
    <Screen className="flex min-h-dvh flex-col justify-center">
      {picker.inputs}
      <Logo className="size-16" />
      <p className="mt-6 text-muted-foreground">You're in, {player.name}.</p>
      <h1 className="text-3xl font-bold text-balance">{saved ? 'Looking good.' : 'Add a photo'}</h1>
      {/* Two lines kept for the text, so the screen doesn't jump as it changes. */}
      {save.error ? (
        <p key="error" role="alert" className="mt-2 min-h-12 text-destructive">
          {save.error}
        </p>
      ) : (
        <p key="text" aria-live="polite" className="mt-2 min-h-12 text-muted-foreground">
          {saving
            ? 'Saving your photo…'
            : saved
              ? 'Tap your photo at the top of your screen to change it.'
              : "It goes next to your name on the TV and on everyone's phone. It's deleted after the party."}
        </p>
      )}

      <div className="relative mt-8 self-center">
        <Avatar name={player.name} src={save.preview} className="size-32" />
        {saving && (
          <span className="absolute inset-0 grid place-items-center rounded-token bg-background/50">
            <SpinnerIcon className="size-10 animate-spin" />
          </span>
        )}
      </div>

      <div className="mt-8 grid gap-3">
        {layout === 'retry' && (
          <Button
            size="xl"
            disabled={saving}
            isPending={spinning('retry')}
            onClick={() => {
              setTap({ which: 'retry', layout: now })
              void save.retry()
            }}
          >
            {spinning('retry') ? <SpinnerIcon className="animate-spin" /> : <ArrowClockwiseIcon />}
            Try again
          </Button>
        )}
        {layout === 'saved' && leave('default')}
        {pick('selfie', layout === 'fresh' ? 'default' : 'secondary')}
        {pick('library', layout === 'saved' ? 'ghost' : 'secondary')}
        {layout !== 'saved' && leave('ghost')}
      </div>
    </Screen>
  )
}
