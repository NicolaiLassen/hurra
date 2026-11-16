import { ArrowClockwiseIcon, CameraIcon, ImagesIcon, SpinnerIcon, TrashIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import Avatar from '@/components/Avatar'
import AvatarBadge from '@/components/AvatarBadge'
import { usePhotoPicker, usePhotoSave } from '@/components/photos/PhotoControls'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { usePlayerPhoto } from '@/lib/photoIndex'
import { toast } from '@/lib/toast'
import type { Player, Session } from '@/lib/types'
import { useLive } from '@/lib/useLive'

/** The longest this phone shows its own change after it is done, before it follows the snapshot again. */
const HOLD_MS = 10_000

type Tap = 'selfie' | 'library' | 'retry' | 'remove'
/** The sheet's buttons: with Try again, and with Remove photo. */
type Layout = { retry: boolean; photo: boolean }

/**
 * The phone header's avatar, as a button that opens "Your photo"
 * (docs/guest-photos.md, 6.2). The hooks live here, not in the sheet's
 * content, which closes away: a save goes on with the sheet closed, and the
 * header keeps showing this phone's preview until the snapshot has the photo,
 * so it never flickers back.
 */
export default function MyPhotoButton({ session, player }: { session: Session; player: Player }) {
  const { refresh } = useLive()
  const save = usePhotoSave({ id: player.id, session_id: session.id }, refresh)
  const measured = usePlayerPhoto(player.id)
  const [open, setOpen] = useState(false)
  // This phone's change: the snapshot's photo when it started, and whether it is done.
  const [held, setHeld] = useState<{ from: string | null; done: boolean } | null>(null)
  const [tap, setTap] = useState<{ which: Tap; layout: Layout } | null>(null)

  useEffect(() => {
    if (!held?.done) return
    const timer = setTimeout(() => setHeld(null), HOLD_MS)
    return () => clearTimeout(timer)
  }, [held])

  // Held until the snapshot's photo is no longer the one the change started
  // from and, for a new photo, this screen has measured it; 10 s at most.
  const photo = player.photo ?? null
  const caughtUp = held !== null && held.done && photo !== held.from && (photo === null || measured !== null)
  const src = held === null || caughtUp ? undefined : save.status === 'removed' ? null : (save.preview ?? undefined)
  const hasPhoto = src === undefined ? photo !== null : src !== null
  const over = session.archived_at !== null
  const busy = save.status === 'saving' || save.status === 'removing'

  async function change(run: () => Promise<boolean>, success: string) {
    if (busy) return
    setHeld({ from: photo, done: false })
    const ok = await run()
    setHeld((h) => (ok && h ? { ...h, done: true } : null))
    if (ok) toast.success(success)
  }
  const picker = usePhotoPicker((file) => void change(() => save.save(file), 'Photo saved'))

  const now: Layout = { retry: save.canRetry, photo: hasPhoto }
  // While a change runs, the buttons stay as they were when it was tapped, the tapped one spinning.
  const layout = busy && tap ? tap.layout : now
  const spinning = (which: Tap) => busy && tap?.which === which
  const press = (which: Tap, act: () => void) => () => {
    setTap({ which, layout: now })
    act()
  }

  const face = <Avatar name={player.name} playerId={player.id} src={src} className="size-12 text-lg" />
  if (over && !hasPhoto) return face

  const text = busy
    ? save.status === 'saving'
      ? 'Saving your photo…'
      : 'Removing your photo…'
    : over
      ? 'The party is over. You can still remove your photo.'
      : hasPhoto
        ? "Everyone sees it next to your name on the TV and on their phones. It's deleted after the party."
        : "Add a photo so everyone can see who's who. It's deleted after the party."

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={hasPhoto ? 'Change your photo' : 'Add a photo'}
          className="relative shrink-0 rounded-full transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 motion-reduce:transition-none"
        >
          {face}
          {!hasPhoto && <AvatarBadge icon={CameraIcon} tone="gold" size="md" />}
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md gap-0 rounded-t-2xl px-4 pt-6 pb-[max(env(safe-area-inset-bottom),1.5rem)]"
      >
        {picker.inputs}
        <SheetTitle className="text-center text-xl font-bold">Your photo</SheetTitle>
        <div className="relative mt-5 self-center">
          {/* After a save the connection lost: the photo Try again sends. */}
          <Avatar name={player.name} playerId={player.id} src={save.canRetry ? save.preview : src} className="size-32 text-5xl" />
          {busy && (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-background/50">
              <SpinnerIcon className="size-10 animate-spin" />
            </span>
          )}
        </div>
        {save.error ? (
          <SheetDescription key="error" role="alert" className="mt-5 text-center text-base text-destructive">
            {save.error}
          </SheetDescription>
        ) : (
          <SheetDescription key="text" aria-live="polite" className="mt-5 text-center text-base text-balance">
            {text}
          </SheetDescription>
        )}

        <div className="mt-6 grid gap-3">
          {layout.retry && !over && (
            <Button size="xl" disabled={busy} isPending={spinning('retry')} onClick={press('retry', () => void change(save.retry, 'Photo saved'))}>
              {spinning('retry') ? <SpinnerIcon className="animate-spin" /> : <ArrowClockwiseIcon />}
              Try again
            </Button>
          )}
          {!over && (
            <>
              <Button
                size="xl"
                variant={layout.retry ? 'secondary' : 'default'}
                disabled={busy}
                isPending={spinning('selfie')}
                onClick={press('selfie', picker.takeSelfie)}
              >
                {spinning('selfie') ? <SpinnerIcon className="animate-spin" /> : <CameraIcon />}
                Take a selfie
              </Button>
              <Button size="xl" variant="secondary" disabled={busy} isPending={spinning('library')} onClick={press('library', picker.choosePhoto)}>
                {spinning('library') ? <SpinnerIcon className="animate-spin" /> : <ImagesIcon />}
                Choose a photo
              </Button>
            </>
          )}
          {layout.photo && (
            <Button
              size="lg"
              variant="destructive"
              disabled={busy}
              isPending={spinning('remove')}
              onClick={press('remove', () => void change(save.remove, 'Photo removed'))}
            >
              {spinning('remove') ? <SpinnerIcon className="animate-spin" /> : <TrashIcon />}
              Remove photo
            </Button>
          )}
          <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
