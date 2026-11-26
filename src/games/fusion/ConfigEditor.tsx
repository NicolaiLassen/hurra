import { ImageIcon, PlusIcon, TrashIcon, UploadSimpleIcon, UserIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { GameGuest, PlayerId } from '@/games/core/Game'
import type { FusionConfig, FusionGame, FusionPicture } from '@/games/fusion/logic'
import {
  DEFAULT_SECONDS,
  DEFAULT_SHOW_SECONDS,
  defaultLabel,
  MAX_LABEL_LENGTH,
  MAX_PICTURES,
  MAX_POINTS,
  MAX_SECONDS,
  MAX_SHOW_SECONDS,
  MIN_SECONDS,
  MIN_SHOW_SECONDS,
} from '@/games/fusion/shapes'
import type { ConfigEditorProps } from '@/games/types'
import { sortNames } from '@/lib/guestList'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** The Select's value for "nobody picked yet": Radix keeps empty values for clearing. */
const NOBODY = 'nobody'

/** What an upload fills: the fused picture's image, or the own photo of its first or second person. */
type Slot = 'image' | 0 | 1

/**
 * Fusion's settings (hosts only): the numbered pictures, each with an optional
 * label, image and the two people in it, each person with their own photo
 * (secret until the reveal), the timing and the points. Who is in a picture
 * can also wait until the night (Show who in the live game). The people come
 * from the whole guest list, so the host can set the pictures before anyone
 * joins (docs/guest-list.md, section 9.2).
 */
export default function ConfigEditor({ config, onChange, guests, media }: ConfigEditorProps<FusionGame>) {
  const pictures: FusionPicture[] = Array.isArray(config.pictures) ? config.pictures : []
  // Uploads by picture index and slot ("3:image", "3:0"). Adding and removing pictures waits for them, so an index stays put.
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [count, setCount] = useState('12')
  const busy = Object.values(uploading).some(Boolean)

  // An upload takes a while: when it lands, it patches the settings as they are
  // then, so a label typed meanwhile isn't lost.
  const latest = useRef({ config, onChange })
  useEffect(() => {
    latest.current = { config, onChange }
  }, [config, onChange])

  const change = (patch: Partial<FusionConfig>) => onChange({ ...config, pictures, ...patch })
  const update = (index: number, patch: Partial<FusionPicture>) =>
    change({ pictures: pictures.map((p, i) => (i === index ? withPatch(p, patch) : p)) })

  async function upload(index: number, slot: Slot, file: File) {
    const id = `${index}:${slot}`
    setUploading((u) => ({ ...u, [id]: true }))
    try {
      const path = await media.upload(file)
      const { config: now, onChange: save } = latest.current
      const list = Array.isArray(now.pictures) ? now.pictures : []
      save({ ...now, pictures: list.map((p, i) => (i === index ? withPatch(p, slot === 'image' ? { image: path } : withOriginal(p, slot, path)) : p)) })
    } catch (error) {
      toast.error((error as Error).message || "That image couldn't be uploaded")
    } finally {
      setUploading((u) => ({ ...u, [id]: false }))
    }
  }

  if (pictures.length === 0) {
    const n = Number(count)
    const valid = Number.isInteger(n) && n >= 1 && n <= MAX_PICTURES
    return (
      <div className="grid gap-3">
        <Label htmlFor="fusion-count">How many fused pictures are there?</Label>
        <div className="flex gap-2 sm:max-w-80">
          <Input
            id="fusion-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PICTURES}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <Button
            size="lg"
            disabled={!valid}
            onClick={() => change({ pictures: Array.from({ length: n }, () => ({ label: '' })) })}
          >
            Add pictures
          </Button>
        </div>
        <p className="text-xs text-paper-2">
          Number the prints 1 to {valid ? n : 'N'}, as they are numbered here. You can add an image, the two people and their
          own photos for each one next.
        </p>
        <Rules config={config} change={change} />
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label asChild>
            <p>Pictures ({pictures.length})</p>
          </Label>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || pictures.length >= MAX_PICTURES}
            onClick={() => change({ pictures: [...pictures, { label: '' }] })}
          >
            <PlusIcon />
            Add a picture
          </Button>
        </div>
        <ol className="grid gap-2">
          {pictures.map((picture, index) => (
            <PictureRow
              key={index}
              n={index + 1}
              picture={picture}
              guests={guests}
              uploading={(slot) => uploading[`${index}:${slot}`] === true}
              busy={busy}
              thumbOf={(path) => media.url(path, 'thumb')}
              onChange={(patch) => update(index, patch)}
              onUpload={(slot, file) => void upload(index, slot, file)}
              onRemove={() => change({ pictures: pictures.filter((_, i) => i !== index) })}
            />
          ))}
        </ol>
        <p className="text-xs text-paper-2">
          The numbers here are the numbers on the prints: removing a picture renumbers the ones after it. Who is in each
          picture is optional now; you can set it on the night with Show who.
        </p>
        <p className="text-xs text-paper-2">
          Each person's own photo is optional and stays secret until the picture is revealed: then the TV shows the two photos
          beside it. Pick each person beside their own photo. Without one, the TV shows the guest's profile photo, or their
          token.
        </p>
      </div>
      <Rules config={config} change={change} />
    </div>
  )
}

function PictureRow({
  n,
  picture,
  guests,
  uploading,
  busy,
  thumbOf,
  onChange,
  onUpload,
  onRemove,
}: {
  n: number
  picture: FusionPicture
  guests: readonly GameGuest[]
  uploading: (slot: Slot) => boolean
  busy: boolean
  thumbOf: (path: string) => string
  onChange: (patch: Partial<FusionPicture>) => void
  onUpload: (slot: Slot, file: File) => void
  onRemove: () => void
}) {
  const people = picture.people ?? ['', '']
  const originals = picture.originals ?? [null, null]
  const chosen = people.filter((id) => id !== '').length
  const problem =
    chosen === 1 ? 'Pick the second person, or clear both' : chosen === 2 && people[0] === people[1] ? 'Pick two different people' : null
  const imageUploading = uploading('image')

  function setPerson(slot: 0 | 1, id: string) {
    const next: [PlayerId, PlayerId] = slot === 0 ? [id, people[1]] : [people[0], id]
    onChange({ people: next[0] === '' && next[1] === '' ? undefined : next })
  }

  return (
    <li className="grid grid-cols-[auto_1fr] gap-3 rounded-lg bg-raised p-3">
      <div className="relative h-20 w-16 overflow-hidden rounded-chip bg-overlay">
        {picture.image ? (
          <img src={thumbOf(picture.image)} alt={`Picture ${n}`} width={320} height={400} className="size-full object-cover object-[50%_35%]" />
        ) : (
          <span className="wide grid size-full place-items-center text-2xl text-paper-2">{n}</span>
        )}
        {imageUploading && (
          <span className="absolute inset-0 grid place-items-center bg-overlay text-xs font-bold text-paper">Uploading…</span>
        )}
      </div>

      <div className="grid min-w-0 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-lg font-black tabular-nums">#{n}</span>
          <Input
            value={picture.label ?? ''}
            maxLength={MAX_LABEL_LENGTH}
            placeholder={defaultLabel(n)}
            aria-label={`Label of picture ${n}`}
            onChange={(e) => onChange({ label: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={`Remove picture ${n}`}
            disabled={busy}
            onClick={onRemove}
          >
            <TrashIcon />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FileButton
            label={picture.image ? 'Replace image' : 'Add image'}
            icon={picture.image ? ImageIcon : UploadSimpleIcon}
            uploading={imageUploading}
            onFile={(file) => onUpload('image', file)}
          />
          {picture.image && !imageUploading && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ image: undefined })}>
              <XIcon />
              Remove image
            </Button>
          )}
          {!picture.image && !imageUploading && <p className="text-xs text-paper-2">No image: the TV shows its label instead.</p>}
        </div>

        <p className="text-sm text-paper-2">Who is in it, each with their own photo?</p>
        {/* minmax(0, 1fr) tracks, so a narrow phone shrinks the slots instead of pushing them past the card. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([0, 1] as const).map((slot) => {
            const ordinal = slot === 0 ? 'first' : 'second'
            const original = originals[slot]
            const busySlot = uploading(slot)
            return (
              <div key={slot} className="flex min-w-0 items-center gap-2" role="group" aria-label={`The ${ordinal} person in picture ${n}`}>
                <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-chip bg-overlay text-paper-3">
                  {original ? (
                    <img
                      src={thumbOf(original)}
                      alt={`Photo of the ${ordinal} person in picture ${n}`}
                      width={300}
                      height={400}
                      className="size-full object-cover object-[50%_30%]"
                    />
                  ) : (
                    <UserIcon aria-hidden className="size-6" />
                  )}
                  {busySlot && <span className="absolute inset-0 bg-overlay" />}
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
                  <PersonSelect
                    className="w-full max-w-56"
                    value={people[slot]}
                    guests={guests}
                    label={slot === 0 ? `First person in picture ${n}` : `Second person in picture ${n}`}
                    onChange={(id) => setPerson(slot, id)}
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    <FileButton
                      label={busySlot ? 'Uploading…' : original ? 'Replace' : 'Add photo'}
                      icon={UploadSimpleIcon}
                      uploading={busySlot}
                      ariaLabel={`${original ? 'Replace the photo' : 'Add a photo'} of the ${ordinal} person in picture ${n}`}
                      onFile={(file) => onUpload(slot, file)}
                    />
                    {original && !busySlot && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove the photo of the ${ordinal} person in picture ${n}`}
                        title="Remove the photo"
                        onClick={() => onChange(withOriginal(picture, slot, null))}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </li>
  )
}

/** A file picker as a secondary button: an image, re-encoded and uploaded by the caller. */
function FileButton({
  label,
  icon: Glyph,
  uploading,
  ariaLabel,
  onFile,
}: {
  label: string
  icon: typeof UploadSimpleIcon
  uploading: boolean
  ariaLabel?: string
  onFile: (file: File) => void
}) {
  function change(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again after a failure
    if (file) onFile(file)
  }
  return (
    <Button asChild variant="secondary" size="sm" className={cn(uploading && 'pointer-events-none opacity-50')}>
      <label>
        <Glyph />
        {label}
        <input type="file" accept="image/*" className="sr-only" disabled={uploading} aria-label={ariaLabel} onChange={change} />
      </label>
    </Button>
  )
}

function PersonSelect({
  value,
  guests,
  label,
  className,
  onChange,
}: {
  value: PlayerId
  guests: readonly GameGuest[]
  label: string
  className?: string
  onChange: (id: PlayerId) => void
}) {
  const sorted = sortNames(guests)
  // Someone picked earlier who has left the party and the list still shows, so the host sees why the start is refused.
  const missing = value !== '' && !guests.some((g) => g.id === value)
  return (
    <Select value={value === '' ? NOBODY : value} onValueChange={(id) => onChange(id === NOBODY ? '' : id)}>
      <SelectTrigger size="sm" className={cn('w-48', className)} aria-label={label}>
        <SelectValue placeholder="Nobody yet" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Nobody yet</SelectItem>
        {missing && (
          <SelectItem value={value} disabled>
            Someone who left
          </SelectItem>
        )}
        {sorted.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
            {/* A guest on the list who hasn't joined yet. */}
            {!g.joined && (
              <>
                {' '}
                <span className="text-paper-3">(not here yet)</span>
              </>
            )}
          </SelectItem>
        ))}
        {guests.length === 0 && (
          <SelectItem value="none-listed" disabled>
            Add guests to the guest list, or wait for them to join
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

/** The timing and the points: how long each picture shows and is guessed, and what a right guess scores. */
function Rules({ config, change }: { config: FusionConfig; change: (patch: Partial<FusionConfig>) => void }) {
  const seconds = config.seconds ?? DEFAULT_SECONDS
  const showSeconds = config.showSeconds ?? DEFAULT_SHOW_SECONDS
  const perPerson = config.pointsPerPerson ?? 1
  const bonus = config.bonusForBoth ?? 0
  const secondsOk = Number.isInteger(seconds) && seconds >= MIN_SECONDS && seconds <= MAX_SECONDS
  const showOk = Number.isInteger(showSeconds) && showSeconds >= MIN_SHOW_SECONDS && showSeconds <= MAX_SHOW_SECONDS
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <section className="grid content-start gap-2">
        <h3 className="text-sm font-extrabold">Timing</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="fusion-seconds"
            label="Seconds to guess each picture"
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            value={seconds}
            onChange={(value) => change({ seconds: value })}
          />
          <NumberField
            id="fusion-show-seconds"
            label="Seconds each picture shows first"
            min={MIN_SHOW_SECONDS}
            max={MAX_SHOW_SECONDS}
            value={showSeconds}
            onChange={(value) => change({ showSeconds: value })}
          />
        </div>
        {!secondsOk && <Problem>The time to guess must be {MIN_SECONDS} to {MAX_SECONDS} seconds</Problem>}
        {!showOk && <Problem>The showing must be {MIN_SHOW_SECONDS} to {MAX_SHOW_SECONDS} seconds a picture</Problem>}
        <p className="text-xs text-paper-2">
          The TV shows each picture for {showSeconds} s, then all of them. Then you ask them one by one: guests have {seconds} s
          to pick two and lock in.
        </p>
      </section>
      <section className="grid content-start gap-2">
        <h3 className="text-sm font-extrabold">Points</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id="fusion-points-person"
            label="Points per right person"
            min={0}
            max={MAX_POINTS}
            value={perPerson}
            onChange={(value) => change({ pointsPerPerson: Math.min(MAX_POINTS, Math.max(0, value)) })}
          />
          <NumberField
            id="fusion-points-both"
            label="Bonus for both"
            min={0}
            max={MAX_POINTS}
            value={bonus}
            onChange={(value) => change({ bonusForBoth: Math.min(MAX_POINTS, Math.max(0, value)) })}
          />
        </div>
        <p className="text-xs text-paper-2">
          A guest who gets both people of a picture right scores {2 * perPerson + bonus}. Nobody scores on a picture they are
          in.
        </p>
      </section>
    </div>
  )
}

function NumberField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string
  label: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
      />
    </div>
  )
}

/** A setting the game won't start with, as a word and an icon (no red: danger is for destructive steps). */
function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="flex w-full items-center gap-1.5 text-xs font-semibold text-paper">
      <WarningIcon weight="fill" className="size-4 shrink-0" />
      {children}
    </p>
  )
}

/** Applies a patch, dropping fields set to undefined so the saved settings stay clean. */
function withPatch(picture: FusionPicture, patch: Partial<FusionPicture>): FusionPicture {
  const next: FusionPicture = { ...picture, ...patch }
  if (next.image === undefined) delete next.image
  if (next.people === undefined) delete next.people
  if (next.originals === undefined) delete next.originals
  return next
}

/** The patch that sets one person's own photo (or clears it with null): no originals at all once both are cleared. */
function withOriginal(picture: FusionPicture, slot: 0 | 1, path: string | null): Partial<FusionPicture> {
  const next: [string | null, string | null] = [...(picture.originals ?? [null, null])]
  next[slot] = path
  return { originals: next[0] === null && next[1] === null ? undefined : next }
}

