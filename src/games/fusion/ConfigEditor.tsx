import { ImageIcon, PlusIcon, TrashIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PlayerId } from '@/games/core/Game'
import {
  defaultLabel,
  MAX_LABEL_LENGTH,
  MAX_PICTURES,
  MAX_POINTS,
  type FusionConfig,
  type FusionGame,
  type FusionPicture,
} from '@/games/fusion/logic'
import type { ConfigEditorProps } from '@/games/types'
import { toast } from '@/lib/toast'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The Select's value for "nobody picked yet": Radix keeps empty values for clearing. */
const NOBODY = 'nobody'

/**
 * Fusion's settings (hosts only): the numbered pictures, each with an optional
 * label, image and the two people in it, and the points. Who is in a picture
 * can also wait until the night (Show who in the live game).
 */
export default function ConfigEditor({ config, onChange, players, media }: ConfigEditorProps<FusionGame>) {
  const pictures: FusionPicture[] = Array.isArray(config.pictures) ? config.pictures : []
  // Uploads by picture index. Adding and removing pictures waits for them, so an index stays put.
  const [uploading, setUploading] = useState<Record<number, boolean>>({})
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

  async function upload(index: number, file: File) {
    setUploading((u) => ({ ...u, [index]: true }))
    try {
      const path = await media.upload(file)
      const { config: now, onChange: save } = latest.current
      const list = Array.isArray(now.pictures) ? now.pictures : []
      save({ ...now, pictures: list.map((p, i) => (i === index ? withPatch(p, { image: path }) : p)) })
    } catch (error) {
      toast.error((error as Error).message || "That image couldn't be uploaded")
    } finally {
      setUploading((u) => ({ ...u, [index]: false }))
    }
  }

  if (pictures.length === 0) {
    const n = Number(count)
    const valid = Number.isInteger(n) && n >= 1 && n <= MAX_PICTURES
    return (
      <div className="grid gap-3">
        <Label htmlFor="fusion-count">How many fused pictures hang on the wall?</Label>
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
        <p className="text-xs text-muted-foreground">
          Number the prints 1 to {valid ? n : 'N'}, as they are numbered here. You can add an image and the two people for
          each one next.
        </p>
        <Points config={config} change={change} />
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
              players={players}
              uploading={uploading[index] === true}
              busy={busy}
              imageUrl={picture.image ? media.url(picture.image, 'thumb') : null}
              onChange={(patch) => update(index, patch)}
              onUpload={(file) => void upload(index, file)}
              onRemove={() => change({ pictures: pictures.filter((_, i) => i !== index) })}
            />
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">
          The numbers here are the numbers on the prints: removing a picture renumbers the ones after it. Who is in each
          picture is optional now; you can set it on the night with Show who.
        </p>
      </div>
      <Points config={config} change={change} />
    </div>
  )
}

function PictureRow({
  n,
  picture,
  players,
  uploading,
  busy,
  imageUrl,
  onChange,
  onUpload,
  onRemove,
}: {
  n: number
  picture: FusionPicture
  players: Player[]
  uploading: boolean
  busy: boolean
  imageUrl: string | null
  onChange: (patch: Partial<FusionPicture>) => void
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const people = picture.people ?? ['', '']
  const chosen = people.filter((id) => id !== '').length
  const problem =
    chosen === 1 ? 'Pick the second person, or clear both' : chosen === 2 && people[0] === people[1] ? 'Pick two different people' : null

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again after a failure
    if (file) onUpload(file)
  }

  function setPerson(slot: 0 | 1, id: string) {
    const next: [PlayerId, PlayerId] = slot === 0 ? [id, people[1]] : [people[0], id]
    onChange({ people: next[0] === '' && next[1] === '' ? undefined : next })
  }

  return (
    <li className="grid grid-cols-[auto_1fr] gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="relative size-20 overflow-hidden rounded-lg bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt={`Picture ${n}`} width={400} height={400} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-3xl font-black text-muted-foreground tabular-nums">{n}</span>
        )}
        {uploading && (
          <span className="absolute inset-0 grid place-items-center bg-background/70 text-xs font-semibold">Uploading…</span>
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
          <Button asChild variant="secondary" size="sm" className={cn(uploading && 'pointer-events-none opacity-50')}>
            <label>
              {picture.image ? <ImageIcon /> : <UploadSimpleIcon />}
              {picture.image ? 'Replace image' : 'Add image'}
              <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={onFile} />
            </label>
          </Button>
          {picture.image && !uploading && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ image: undefined })}>
              <XIcon />
              Remove image
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Who is in it?</span>
          {([0, 1] as const).map((slot) => (
            <PersonSelect
              key={slot}
              value={people[slot]}
              players={players}
              label={slot === 0 ? `First person in picture ${n}` : `Second person in picture ${n}`}
              onChange={(id) => setPerson(slot, id)}
            />
          ))}
          {problem && <p className="w-full text-xs text-destructive">{problem}</p>}
        </div>
      </div>
    </li>
  )
}

function PersonSelect({
  value,
  players,
  label,
  onChange,
}: {
  value: PlayerId
  players: Player[]
  label: string
  onChange: (id: PlayerId) => void
}) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name))
  // Someone picked earlier who has left the party still shows, so the host sees why the start is refused.
  const missing = value !== '' && !players.some((p) => p.id === value)
  return (
    <Select value={value === '' ? NOBODY : value} onValueChange={(id) => onChange(id === NOBODY ? '' : id)}>
      <SelectTrigger size="sm" className="w-40" aria-label={label}>
        <SelectValue placeholder="Nobody yet" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Nobody yet</SelectItem>
        {missing && (
          <SelectItem value={value} disabled>
            Someone who left
          </SelectItem>
        )}
        {sorted.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        {players.length === 0 && (
          <SelectItem value="none-joined" disabled>
            Guests show up here once they join
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

function Points({ config, change }: { config: FusionConfig; change: (patch: Partial<FusionConfig>) => void }) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-3 sm:max-w-96">
        <div className="grid gap-2">
          <Label htmlFor="fusion-points-person">Points per right person</Label>
          <Input
            id="fusion-points-person"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_POINTS}
            step={1}
            value={config.pointsPerPerson ?? 1}
            onChange={(e) => change({ pointsPerPerson: wholePoints(e.target.value) })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fusion-points-both">Bonus for both</Label>
          <Input
            id="fusion-points-both"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_POINTS}
            step={1}
            value={config.bonusForBoth ?? 0}
            onChange={(e) => change({ bonusForBoth: wholePoints(e.target.value) })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A guest who gets both people of a picture right scores {2 * (config.pointsPerPerson ?? 1) + (config.bonusForBoth ?? 0)}.
        Nobody scores on a picture they are in.
      </p>
    </div>
  )
}

/** Applies a patch, dropping fields set to undefined so the saved settings stay clean. */
function withPatch(picture: FusionPicture, patch: Partial<FusionPicture>): FusionPicture {
  const next: FusionPicture = { ...picture, ...patch }
  if (next.image === undefined) delete next.image
  if (next.people === undefined) delete next.people
  return next
}

const wholePoints = (value: string) => Math.min(MAX_POINTS, Math.max(0, Math.round(Number(value) || 0)))
