import { ImageIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { GameGuest, PlayerId } from '@/games/core/Game'
import { MAX_IN_PHOTO } from '../logic'
import type { SoundtrackSong } from '../types'
import PeopleField from './PeopleField'

const sameIds = (a: readonly PlayerId[], b: readonly PlayerId[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * Doesn't play this game: the guests who sit Lydspor out (usually the
 * storyteller and whoever runs Spotify). Their phones say so; anything they
 * type scores nothing and isn't counted in the room's numbers.
 */
export function SitOutDialog({
  open,
  onOpenChange,
  guests,
  current,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guests: readonly GameGuest[]
  current: readonly PlayerId[]
  /** Sends the list; resolves once saved, rejects on a refusal (the host page shows it). */
  onSave: (ids: PlayerId[]) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Mounted only while open, so it starts from the saved list each time. */}
        <SitOutForm guests={guests} current={current} onSave={onSave} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SitOutForm({
  guests,
  current,
  onSave,
  onDone,
}: {
  guests: readonly GameGuest[]
  current: readonly PlayerId[]
  onSave: (ids: PlayerId[]) => Promise<void>
  onDone: () => void
}) {
  const [draft, setDraft] = useState<PlayerId[]>(() => [...current])
  const [saving, setSaving] = useState(false)
  const unchanged = sameIds(draft, current)

  async function save() {
    setSaving(true)
    try {
      await onSave(draft)
      onDone()
    } catch {
      // The host page shows the refusal in the server's words.
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-lg font-extrabold">Who sits Lydspor out?</DialogTitle>
        <DialogDescription>
          Usually the storyteller and whoever runs Spotify. Their phones say they sit this one out, and they don't count in
          the room's numbers.
        </DialogDescription>
      </DialogHeader>
      <PeopleField label="Doesn't play Lydspor" guests={guests} value={draft} onChange={setDraft} empty="Everyone plays" disabled={saving} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="lg" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button size="lg" disabled={unchanged} isPending={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </>
  )
}

/**
 * Who's in each photo, out of sight: a guest in a song's photo scores nothing
 * on it, and it counts as their own average at the crown. One row per song
 * with its photo and caption (never its title), each saved on its own.
 */
export function InPhotoDialog({
  open,
  onOpenChange,
  guests,
  songs,
  current,
  mediaUrl,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guests: readonly GameGuest[]
  songs: readonly Pick<SoundtrackSong, 'photo' | 'caption'>[]
  /** Per song, as the game holds it now. */
  current: readonly (readonly PlayerId[])[]
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  onSave: (index: number, ids: PlayerId[]) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Who's in each photo?</DialogTitle>
          <DialogDescription>
            A guest in a song's photo scores nothing on that song. At the crown it counts as their own average. Keep this
            phone out of sight while it is open.
          </DialogDescription>
        </DialogHeader>
        <ol className="divide-y divide-rule">
          {songs.map((song, i) => (
            <InPhotoRow
              key={i}
              n={i + 1}
              song={song}
              guests={guests}
              current={current[i] ?? []}
              mediaUrl={mediaUrl}
              onSave={(ids) => onSave(i, ids)}
            />
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

function InPhotoRow({
  n,
  song,
  guests,
  current,
  mediaUrl,
  onSave,
}: {
  n: number
  song: Pick<SoundtrackSong, 'photo' | 'caption'>
  guests: readonly GameGuest[]
  current: readonly PlayerId[]
  mediaUrl: (path: string, size?: 'full' | 'thumb') => string
  onSave: (ids: PlayerId[]) => Promise<void>
}) {
  const [draft, setDraft] = useState<PlayerId[] | null>(null)
  const [saving, setSaving] = useState(false)
  const value = draft ?? [...current]
  const changed = draft !== null && !sameIds(draft, current)

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      await onSave(draft)
      setDraft(null)
    } catch {
      // The host page shows the refusal in the server's words.
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="grid grid-cols-[4rem_1fr] gap-3 py-3">
      <Thumb path={song.photo} mediaUrl={mediaUrl} label={`Song ${n}'s photo`} />
      <div className="grid grid-cols-1 min-w-0 gap-2">
        <p className="font-extrabold">
          Song {n} <span className="font-medium text-paper-2">{song.caption}</span>
        </p>
        <PeopleField
          label={`Who's in song ${n}'s photo`}
          guests={guests}
          value={value}
          onChange={setDraft}
          max={MAX_IN_PHOTO}
          empty="Nobody marked"
          disabled={saving}
        />
        {changed && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" isPending={saving} onClick={() => void save()}>
              Save song {n}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}

/** A photo's thumbnail, or a quiet tile while it is missing or fails to load. */
export function Thumb({ path, mediaUrl, label, className = 'size-16' }: { path: string; mediaUrl: (path: string, size?: 'full' | 'thumb') => string; label: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!path || failed === path) {
    return (
      <span className={`grid shrink-0 place-items-center rounded-control bg-rule text-paper-3 ${className}`} role="img" aria-label={label}>
        <ImageIcon className="size-6" />
      </span>
    )
  }
  return (
    <img
      src={mediaUrl(path, 'thumb')}
      alt={label}
      loading="lazy"
      width={200}
      height={200}
      className={`shrink-0 rounded-control bg-rule object-cover ${className}`}
      onError={() => setFailed(path)}
    />
  )
}
