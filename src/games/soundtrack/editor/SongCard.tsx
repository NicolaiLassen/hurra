import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Player } from '@/lib/types'
import { MAX_CAPTION, MAX_IN_PHOTO, MAX_NOTE } from '../logic'
import { MAX_TYPED, type SoundtrackSong } from '../types'
import PeopleField from '../host/PeopleField'
import { AlsoList, Field, Issues, PhotoPicker, StartField } from './parts'
import type { Issue } from './settings'

/**
 * One song in the settings (spec section 12): its photo, title and singer as
 * the reveal shows them, the other answers that count, its caption, where
 * the hook starts in Spotify, a story note for the cue card and who is in
 * the photo, with the game's problems and warnings about it underneath.
 */
export default function SongCard({
  n,
  song,
  count,
  players,
  photoUrl,
  uploading,
  busy,
  issues,
  idPrefix,
  onChange,
  onUpload,
  onMove,
  onRemove,
}: {
  n: number
  song: SoundtrackSong
  /** Songs in the list, for Move down. */
  count: number
  players: readonly Player[]
  photoUrl: string | null
  uploading: boolean
  /** An upload is running somewhere: the list keeps its order until it lands. */
  busy: boolean
  issues: readonly Issue[]
  idPrefix: string
  onChange: (patch: Partial<SoundtrackSong>) => void
  onUpload: (file: File) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  const id = (field: string) => `${idPrefix}-${n}-${field}`
  return (
    <li className="grid grid-cols-1 gap-3 rounded-lg bg-raised p-3 sm:p-4" aria-label={`Song ${n}`}>
      <div className="flex items-center gap-2">
        <span className="tv-num grid size-8 place-items-center rounded-chip bg-overlay text-lg">{n}</span>
        <p className="min-w-0 flex-1 truncate font-extrabold">
          {song.title.trim() ? song.title : `Song ${n}`}
          {song.singer.trim() && <span className="font-medium text-paper-2"> {song.singer}</span>}
        </p>
        <Button type="button" variant="ghost" size="icon" aria-label={`Move song ${n} up`} disabled={busy || n === 1} onClick={() => onMove(-1)}>
          <ArrowUpIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={`Move song ${n} down`} disabled={busy || n === count} onClick={() => onMove(1)}>
          <ArrowDownIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-paper-2 hover:text-destructive"
          aria-label={`Remove song ${n}`}
          disabled={busy}
          onClick={onRemove}
        >
          <TrashIcon />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <PhotoPicker url={photoUrl} label={`song ${n}'s photo`} uploading={uploading} disabled={busy && !uploading} onUpload={onUpload} className="w-36 sm:w-full" />

        <div className="grid grid-cols-1 min-w-0 gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id={id('title')} label="Title">
              <Input
                id={id('title')}
                value={song.title}
                maxLength={MAX_TYPED}
                placeholder="As the reveal shows it"
                onChange={(e) => onChange({ title: e.target.value })}
              />
            </Field>
            <Field id={id('singer')} label="Singer">
              <Input
                id={id('singer')}
                value={song.singer}
                maxLength={MAX_TYPED}
                placeholder="As the reveal shows it"
                onChange={(e) => onChange({ singer: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AlsoList label="Also accept for the title" items={song.alsoTitles} placeholder="Old Oak" onChange={(alsoTitles) => onChange({ alsoTitles })} />
            <AlsoList label="Also accept for the singer" items={song.alsoSingers} placeholder="Mira" onChange={(alsoSingers) => onChange({ alsoSingers })} />
          </div>
          <p className="text-sm text-paper-2">
            Capitals, accents, spaces, “the” and small typos are forgiven already. Add other names or spellings that should
            count, like a nickname or a shorter title.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field id={id('caption')} label="Caption at the reveal, with the year">
              <Input
                id={id('caption')}
                value={song.caption}
                maxLength={MAX_CAPTION}
                placeholder="Island trip, 2012"
                onChange={(e) => onChange({ caption: e.target.value })}
              />
            </Field>
            <StartField id={id('start')} seconds={song.startAt} onChange={(startAt) => onChange({ startAt })} />
          </div>

          <Field id={id('note')} label="Story note" hint="Host only: a line on the cue card at its reveal.">
            <Input
              id={id('note')}
              value={song.note}
              maxLength={MAX_NOTE}
              placeholder="Optional"
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-1 gap-1.5">
            <p className="text-sm font-medium">Who's in this photo</p>
            <PeopleField
              label={`Who's in song ${n}'s photo`}
              players={players}
              value={song.inPhoto}
              max={MAX_IN_PHOTO}
              empty="Nobody marked"
              onChange={(inPhoto) => onChange({ inPhoto })}
            />
            <p className="text-sm text-paper-2">They score nothing on this song; it counts as their own average.</p>
          </div>
        </div>
      </div>

      <Issues issues={issues} />
    </li>
  )
}
