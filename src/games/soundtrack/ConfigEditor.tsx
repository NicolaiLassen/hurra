import { MusicNotesPlusIcon, PlusIcon, ShuffleIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Issues, PhotoPicker } from '@/games/soundtrack/editor/parts'
import { emptySong, placeIssues, readSettings, wholeFrom, type Issue } from '@/games/soundtrack/editor/settings'
import SongCard from '@/games/soundtrack/editor/SongCard'
import PeopleField from '@/games/soundtrack/host/PeopleField'
import {
  checkConfig,
  MAX_BOARD_MAX,
  MAX_CAPTION,
  MAX_EXTRA_PHOTOS,
  MAX_INTRO,
  MAX_LAST_CALL,
  MAX_POINTS,
  MAX_SONGS,
  MAX_STANDINGS_EVERY,
  MAX_STORYTELLER,
  MIN_BOARD_MAX,
  MIN_LAST_CALL,
  MORE_MS,
  pointsPerSong,
  type SoundtrackGame,
} from '@/games/soundtrack/logic'
import type { SoundtrackConfig, SoundtrackPhoto, SoundtrackSong } from '@/games/soundtrack/types'
import type { ConfigEditorProps } from '@/games/types'
import { toast } from '@/lib/toast'

/** Where an upload lands: a song's photo, an extra photo's, or a new extra photo. */
type Target = `song:${number}` | `extra:${number}` | 'extra:new'

/** The items in a random order (the editor runs in the host's browser, not in the game's logic). */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Lydspor's settings (spec section 12), as lists rather than a markup format:
 * a card per song with its photo, title, singer, the other answers that
 * count, its caption, where its hook starts and a story note; the extra
 * photos that fit no song; the points and the pace; and the intro, the
 * storyteller and who sits out (typed names, suggested from the guest list);
 * and two switches: typed moments (each song gets its moment, the extra
 * photos fold away) and the AI check. The game's own check runs as you
 * type, each problem and warning under what it is about. The settings live
 * in game_settings (hosts only), so no title reaches a phone before its
 * reveal.
 */
export default function ConfigEditor({ config: raw, onChange, game, guests, players, media }: ConfigEditorProps<SoundtrackGame>) {
  const config = readSettings(raw)
  const { problems, warnings } = checkConfig(config)
  const placed = placeIssues(problems, warnings, config.songs, config.extraPhotos.length)
  const [uploading, setUploading] = useState<Partial<Record<Target, number>>>({})
  const [mixing, setMixing] = useState<{ done: number; of: number } | null>(null)
  const [mixed, setMixed] = useState(false)
  const [showExtras, setShowExtras] = useState(false)
  const busy = Object.values(uploading).some((n) => (n ?? 0) > 0) || mixing !== null
  const ids = `lydspor-${game.id}`

  // An upload takes a while: when it lands, it patches the settings as they
  // are then, so a title typed meanwhile isn't lost. What it saves is the
  // latest at once, so two uploads landing together keep both photos.
  const latest = useRef({ raw, onChange })
  useEffect(() => {
    latest.current = { raw, onChange }
  }, [raw, onChange])
  function saveLatest(next: SoundtrackConfig) {
    latest.current = { ...latest.current, raw: next }
    latest.current.onChange(next)
  }

  const change = (patch: Partial<SoundtrackConfig>) => onChange({ ...config, ...patch })
  const setSongs = (songs: SoundtrackSong[]) => change({ songs })
  const updateSong = (index: number, patch: Partial<SoundtrackSong>) =>
    setSongs(config.songs.map((song, i) => (i === index ? { ...song, ...patch } : song)))
  const moveSong = (index: number, by: -1 | 1) => {
    const songs = [...config.songs]
    ;[songs[index], songs[index + by]] = [songs[index + by], songs[index]]
    setSongs(songs)
  }
  const setExtras = (extraPhotos: SoundtrackPhoto[]) => change({ extraPhotos })

  async function upload(target: Target, file: File) {
    setMixed(false)
    setUploading((u) => ({ ...u, [target]: (u[target] ?? 0) + 1 }))
    try {
      const path = await media.upload(file)
      const current = readSettings(latest.current.raw)
      if (target === 'extra:new') {
        saveLatest({ ...current, extraPhotos: [...current.extraPhotos, { photo: path, caption: '' }].slice(0, MAX_EXTRA_PHOTOS) })
      } else {
        const [kind, at] = target.split(':')
        const index = Number(at)
        if (kind === 'song') saveLatest({ ...current, songs: current.songs.map((s, i) => (i === index ? { ...s, photo: path } : s)) })
        else saveLatest({ ...current, extraPhotos: current.extraPhotos.map((p, i) => (i === index ? { ...p, photo: path } : p)) })
      }
    } catch (error) {
      toast.error((error as Error).message || "That photo couldn't be uploaded")
    } finally {
      setUploading((u) => ({ ...u, [target]: Math.max(0, (u[target] ?? 1) - 1) }))
    }
  }

  /**
   * Every photo is public, and its file carries the time it was uploaded: a
   * guest who sorts the wall by it reads the songs' order when the host
   * uploaded them song by song. This uploads every photo again, in a random
   * order, so the times say nothing. Photos uploaded again before a failure
   * keep their new paths; a second tap mixes them all again.
   */
  async function mixUploadOrder() {
    const current = readSettings(latest.current.raw)
    const paths = [...new Set([...current.songs.map((s) => s.photo), ...current.extraPhotos.map((p) => p.photo)].filter((p) => p !== ''))]
    if (paths.length === 0) return
    const moved = new Map<string, string>()
    setMixed(false)
    setMixing({ done: 0, of: paths.length })
    try {
      for (const path of shuffled(paths)) {
        const response = await fetch(media.url(path, 'full'))
        if (!response.ok) throw new Error(`A photo couldn't be read back (${response.status})`)
        const blob = await response.blob()
        moved.set(path, await media.upload(new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' })))
        setMixing({ done: moved.size, of: paths.length })
      }
      setMixed(true)
    } catch (error) {
      toast.error((error as Error).message || "The photos couldn't be mixed. Try again.")
    } finally {
      if (moved.size > 0) {
        const latestConfig = readSettings(latest.current.raw)
        saveLatest({
          ...latestConfig,
          songs: latestConfig.songs.map((s) => ({ ...s, photo: moved.get(s.photo) ?? s.photo })),
          extraPhotos: latestConfig.extraPhotos.map((p) => ({ ...p, photo: moved.get(p.photo) ?? p.photo })),
        })
      }
      setMixing(null)
    }
  }

  const url = (path: string) => (path ? media.url(path, 'thumb') : null)
  const photoCount = config.songs.filter((s) => s.photo !== '').length + config.extraPhotos.filter((p) => p.photo !== '').length
  const perSong = pointsPerSong(config.points, config)
  const typed = config.momentTyped === true
  // Typed moments on the wall: the photo is picked as well, each of the four parts with its own points.
  const onWall = typed && config.momentPhoto === 'wall'
  // Typed moments use no extra photos: they fold away (kept as they are) unless something about them needs a fix.
  const extrasToFix = [...placed.extras.flat(), ...placed.fields.extras].some((issue) => issue.kind === 'problem')
  const extrasOpen = !typed || onWall || showExtras || extrasToFix

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="grid grid-cols-1 gap-3" aria-labelledby={`${ids}-songs`}>
        <div className="grid grid-cols-1 gap-1">
          <h3 id={`${ids}-songs`} className="font-extrabold">
            Songs ({config.songs.length} of {MAX_SONGS})
          </h3>
          {typed ? (
            <p className="text-sm text-paper-2">
              In play order, the same order as the Spotify playlist. Guests type each title, singer and moment while the song's
              own photo shows; the answers stay in these settings until each reveal.
            </p>
          ) : (
            <p className="text-sm text-paper-2">
              In play order, the same order as the Spotify playlist. Guests type each title and singer and tap the photo it
              belongs to; the titles stay in these settings until each reveal.
            </p>
          )}
        </div>

        {config.songs.length === 0 ? (
          <div className="grid grid-cols-1 justify-items-center gap-3 rounded-lg border border-dashed border-rule p-6 text-center">
            <p className="font-semibold">No songs yet</p>
            <p className="max-w-md text-sm text-paper-2">
              Add each song with its photo, the title and singer as the reveal should show them, and where its hook starts.
            </p>
            <Button type="button" variant="secondary" size="lg" onClick={() => setSongs([emptySong()])}>
              <MusicNotesPlusIcon />
              Add the first song
            </Button>
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-3">
            {config.songs.map((song, i) => (
              <SongCard
                key={i}
                n={i + 1}
                song={song}
                momentTyped={typed}
                count={config.songs.length}
                photoUrl={url(song.photo)}
                uploading={(uploading[`song:${i}`] ?? 0) > 0}
                busy={busy}
                issues={placed.songs[i] ?? []}
                idPrefix={ids}
                onChange={(patch) => updateSong(i, patch)}
                onUpload={(file) => void upload(`song:${i}`, file)}
                onMove={(by) => moveSong(i, by)}
                onRemove={() => setSongs(config.songs.filter((_, j) => j !== i))}
              />
            ))}
          </ol>
        )}
        {config.songs.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="justify-self-start"
            disabled={busy || config.songs.length >= MAX_SONGS}
            onClick={() => setSongs([...config.songs, emptySong()])}
          >
            <PlusIcon />
            Add a song
          </Button>
        )}
        <Issues issues={placed.fields.songs} />
      </section>

      <Panel
        id={`${ids}-extras`}
        title={`Extra photos (${config.extraPhotos.length} of ${MAX_EXTRA_PHOTOS})`}
        hint={
          typed
            ? 'Not used while guests type the moment: there is no photo wall. Any extra photos stay saved for when it is off.'
            : "Photos of the same kind that fit no song, so the last songs aren't a free pick. They join the wall, and their captions show after the last reveal."
        }
      >
        {typed && !extrasToFix && (
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" aria-expanded={showExtras} onClick={() => setShowExtras(!showExtras)}>
            {showExtras ? 'Hide the extra photos' : 'Show the extra photos'}
          </Button>
        )}
        {extrasOpen && (
          <>
            <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {config.extraPhotos.map((photo, k) => (
                <li key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                  <PhotoPicker
                    url={url(photo.photo)}
                    label={`extra photo ${k + 1}`}
                    uploading={(uploading[`extra:${k}`] ?? 0) > 0}
                    disabled={busy}
                    onUpload={(file) => void upload(`extra:${k}`, file)}
                  />
                  <div className="grid grid-cols-1 content-start gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`${ids}-extra-${k}`} className="text-sm font-medium">
                        Caption and year
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="-my-1 text-paper-2 hover:text-destructive"
                        aria-label={`Remove extra photo ${k + 1}`}
                        disabled={busy}
                        onClick={() => setExtras(config.extraPhotos.filter((_, j) => j !== k))}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                    <Input
                      id={`${ids}-extra-${k}`}
                      value={photo.caption}
                      maxLength={MAX_CAPTION}
                      placeholder="Ski trip, 2017"
                      aria-label={`Caption of extra photo ${k + 1}, with the year`}
                      onChange={(e) => setExtras(config.extraPhotos.map((p, j) => (j === k ? { ...p, caption: e.target.value } : p)))}
                    />
                    <Issues issues={placed.extras[k] ?? []} />
                  </div>
                </li>
              ))}
              {config.extraPhotos.length < MAX_EXTRA_PHOTOS && (
                <li className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                  <PhotoPicker
                    url={null}
                    label="an extra photo"
                    uploading={(uploading['extra:new'] ?? 0) > 0}
                    disabled={busy && (uploading['extra:new'] ?? 0) === 0}
                    onUpload={(file) => void upload('extra:new', file)}
                  />
                  <p className="self-center text-sm text-paper-2">
                    {MAX_EXTRA_PHOTOS - config.extraPhotos.length} more can join the wall. Each needs a caption.
                  </p>
                </li>
              )}
            </ol>
            <Issues issues={placed.fields.extras} />
            <div className="grid grid-cols-1 gap-2 border-t border-rule pt-3">
              <p className="text-sm text-paper-2">
                A phone can read when each photo was uploaded. Once every photo is in, mix the upload order and save, so the times
                say nothing about which song is which.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" size="lg" disabled={busy || photoCount === 0} onClick={() => void mixUploadOrder()}>
                  <ShuffleIcon />
                  {mixing ? `Mixing, ${mixing.done} of ${mixing.of}` : 'Mix the upload order'}
                </Button>
                {mixed && (
                  <p role="status" className="text-sm font-semibold">
                    Mixed. Save the settings to keep it.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel id={`${ids}-points`} title="Points and pace">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-1 content-start gap-1.5" role="group" aria-labelledby={`${ids}-points-label`}>
            <p id={`${ids}-points-label`} className="text-sm font-medium">
              Points per song
            </p>
            <div className={onWall ? 'grid grid-cols-4 gap-2' : 'grid grid-cols-3 gap-2'}>
              {(onWall ? (['event', 'moment', 'title', 'singer'] as const) : (['event', 'title', 'singer'] as const)).map((part) => (
                <label key={part} className="grid grid-cols-1 gap-1 text-sm text-paper-2">
                  {part === 'event'
                    ? typed && !onWall
                      ? 'Moment'
                      : 'Photo'
                    : part === 'moment'
                      ? 'Moment'
                      : part === 'title'
                        ? 'Title'
                        : 'Singer'}
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_POINTS}
                    step={1}
                    className="tv-num text-lg md:text-lg"
                    value={config.points[part] ?? 2}
                    onChange={(e) => change({ points: { ...config.points, [part]: wholeFrom(e.target.value) } })}
                  />
                </label>
              ))}
            </div>
            <p className="text-sm text-paper-2">
              {perSong} a song{config.songs.length > 1 ? `, ${perSong * config.songs.length} for ${config.songs.length} songs` : ''}. No
              points for speed.
            </p>
            <Issues issues={placed.fields.points} />
          </div>
          <NumberField
            id={`${ids}-board`}
            label="Most on the night board"
            value={config.boardMax}
            min={MIN_BOARD_MAX}
            max={MAX_BOARD_MAX}
            hint="Lydspor's best score pays this; everyone else on the same scale."
            issues={placed.fields.boardMax}
            onChange={(boardMax) => change({ boardMax })}
          />
          <NumberField
            id={`${ids}-last-call`}
            label="Last call, in seconds"
            value={config.lastCallSeconds}
            min={MIN_LAST_CALL}
            max={MAX_LAST_CALL}
            hint={`Then every answer locks by itself. More time adds ${MORE_MS / 1000} s, twice.`}
            issues={placed.fields.lastCall}
            onChange={(lastCallSeconds) => change({ lastCallSeconds })}
          />
          <NumberField
            id={`${ids}-top`}
            label="Show the top 5 after every"
            unit="reveals"
            value={config.standingsEvery}
            min={0}
            max={MAX_STANDINGS_EVERY}
            hint="0 never shows it. 4 shows it after every 4th reveal, and always after the last one."
            issues={placed.fields.standings}
            onChange={(standingsEvery) => change({ standingsEvery })}
          />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-paper"
            checked={config.hints}
            onChange={(e) => change({ hints: e.target.checked })}
          />
          <span>
            <span className="font-medium">Hints under the photos while songs play</span>
            <span className="block text-paper-2">Off: captions show only at the reveal, so no event is a word match.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-paper"
            checked={typed}
            onChange={(e) => change({ momentTyped: e.target.checked })}
          />
          <span>
            <span className="font-medium">Guests type the moment</span>
            <span className="block text-paper-2">
              Each song's own photo shows while it plays, and guests type what happened. No photo wall, no extra photos needed.
            </span>
          </span>
        </label>
        {typed && (
          <label className="flex items-start gap-3 pl-7 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-paper"
              checked={onWall}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? { momentPhoto: 'wall', points: { ...config.points, moment: config.points.moment ?? 2 } }
                    : { momentPhoto: undefined },
                )
              }
            />
            <span>
              <span className="font-medium">Photos on the wall, not shown with the song</span>
              <span className="block text-paper-2">
                All photos are lettered on the wall, and guests pick the song's photo as well as typing its moment, title and
                singer. Each part scores on its own. Extra photos are optional.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-paper"
            checked={config.aiCheck === true}
            onChange={(e) => change({ aiCheck: e.target.checked })}
          />
          <span>
            <span className="font-medium">AI checks typed answers</span>
            <span className="block text-paper-2">
              After the lock, an AI accepts answers that are close enough, spelling aside. You can undo any of its accepts.
            </span>
          </span>
        </label>
      </Panel>

      <Panel id={`${ids}-night`} title="On the night">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={`${ids}-storyteller`} label="Storyteller" hint="The TV and the cue card say who tells the story at each reveal.">
            <Input
              id={`${ids}-storyteller`}
              value={config.storyteller}
              maxLength={MAX_STORYTELLER}
              placeholder="First name"
              onChange={(e) => change({ storyteller: e.target.value })}
            />
            <Issues issues={placed.fields.storyteller} />
          </Field>
          <Field id={`${ids}-intro`} label="Intro line" hint="The lobby's first line on the TV and the phones. Optional.">
            <Input
              id={`${ids}-intro`}
              value={config.intro}
              maxLength={MAX_INTRO}
              placeholder="Eight songs, eight stories"
              onChange={(e) => change({ intro: e.target.value })}
            />
            <Issues issues={placed.fields.intro} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <p className="text-sm font-medium">Doesn't play this game</p>
          <PeopleField
            label="Doesn't play Lydspor"
            guests={guests}
            players={players}
            value={config.sitOut}
            empty="Everyone plays"
            onChange={(sitOut) => change({ sitOut })}
          />
          <Issues issues={placed.fields.sitOut} />
          <p className="text-sm text-paper-2">
            Usually the storyteller and whoever runs Spotify. Type each name as they join with it: the guest list suggests the
            spelling. You can change it on the night too.
          </p>
        </div>
      </Panel>

      {problems.length > 0 && config.songs.length > 0 && <Summary problems={problems} />}
    </div>
  )
}

/** A raised panel in the settings well, with its title and an optional line on what it is for. */
function Panel({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 rounded-lg bg-raised p-3 sm:p-4" aria-labelledby={id}>
      <div className="grid grid-cols-1 gap-1">
        <h3 id={id} className="font-extrabold">
          {title}
        </h3>
        {hint && <p className="text-sm text-paper-2">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function NumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  hint,
  issues,
  onChange,
}: {
  id: string
  label: string
  unit?: string
  value: number
  min: number
  max: number
  hint: string
  issues: readonly Issue[]
  onChange: (value: number) => void
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          className="tv-num w-24 text-lg md:text-lg"
          value={value}
          onChange={(e) => onChange(wholeFrom(e.target.value))}
        />
        {unit && <span className="text-sm text-paper-2">{unit}</span>}
      </div>
      <Issues issues={issues} />
    </Field>
  )
}

/** What stops the start, all in one place at the end: the same check the game runs when it starts. */
function Summary({ problems }: { problems: readonly string[] }) {
  return (
    <div className="flex gap-3 rounded-lg bg-raised p-4 text-sm">
      <WarningCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="grid grid-cols-1 gap-1">
        <p className="font-semibold">Fix {problems.length === 1 ? 'this' : `these ${problems.length}`} before you start Lydspor</p>
        <ul className="grid grid-cols-1 gap-0.5 text-paper-2">
          {problems.slice(0, 4).map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
          {problems.length > 4 && <li>and {problems.length - 4} more</li>}
        </ul>
      </div>
    </div>
  )
}
