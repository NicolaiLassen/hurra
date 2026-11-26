import { LockSimpleIcon, PlusIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { letterOf, type SongPart, type TypedPart } from '@/games/soundtrack/types'
import { cn } from '@/lib/utils'
import { LetterChip, PhotoImage } from './Wall'
import { EMPTY_CELL } from './words'

// Your board (spec 4.5, 4.9 and 4.10): one row per song played, its number
// with the clock time it started, the photo with its letter, and the title
// and singer as the guest typed them (never corrected). Every cell opens
// what changes it until the lock; then the board is flat and read-only.
// Under 380 px the title and singer stack in each row.

export type BoardRow = {
  n: number
  /** When it started ("21:04"), from the database's clock. */
  time: string | null
  /** The song on air now: the gold tilted number and the word Now. */
  now: boolean
  /** Its photo's wall index, or null. */
  photo: number | null
  title: string | null
  singer: string | null
  /** Text typed but not sent (a refusal, no connection, a reload). */
  unsent: readonly TypedPart[]
  /** "Swapped" on the photo for a few seconds after a swap. */
  swapped: boolean
  /** The photo is on another song too: a roll back that failed. */
  doubled: boolean
}

const GRID = 'grid grid-cols-[30px_64px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 max-[379px]:grid-cols-[30px_64px_minmax(0,1fr)]'

export function Board({
  rows,
  wall,
  thumbUrl,
  locked = false,
  open = null,
  panel,
  onEvent,
  onCell,
}: {
  rows: readonly BoardRow[]
  wall: readonly { path: string }[]
  thumbUrl: (path: string) => string
  /** After the lock: flat cells, a lock under each number, no press state. */
  locked?: boolean
  /** The row opened for typing, and its cell. */
  open?: { n: number; part: TypedPart } | null
  /** The opened row's fields, right under it. */
  panel?: ReactNode
  onEvent?: (n: number) => void
  onCell?: (n: number, part: TypedPart) => void
}) {
  return (
    <div className="grid grid-cols-1">
      <div aria-hidden className={cn(GRID, 'max-[379px]:hidden')}>
        <span />
        {['Event', 'Title', 'Singer'].map((head) => (
          <span key={head} className="on-air text-[13px] text-paper-2">
            {head}
          </span>
        ))}
      </div>
      <ol aria-label="Your board" className="mt-1.5 grid grid-cols-1 gap-1.5 max-[379px]:mt-0">
        {rows.map((row) => {
          const opened = open?.n === row.n
          return (
            <li key={row.n} className="grid grid-cols-1 gap-1.5">
              <Row row={row} wall={wall} thumbUrl={thumbUrl} locked={locked} openPart={opened ? open.part : null} onEvent={onEvent} onCell={onCell} />
              {row.doubled && row.photo !== null && (
                <p className="pl-9 text-sm font-semibold">Photo {letterOf(row.photo)} is on 2 songs. Pick one for each.</p>
              )}
              {opened && panel}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Row({
  row,
  wall,
  thumbUrl,
  locked,
  openPart,
  onEvent,
  onCell,
}: {
  row: BoardRow
  wall: readonly { path: string }[]
  thumbUrl: (path: string) => string
  locked: boolean
  openPart: TypedPart | null
  onEvent?: (n: number) => void
  onCell?: (n: number, part: TypedPart) => void
}) {
  return (
    <div
      className={cn(
        GRID,
        'h-[54px] max-[379px]:h-[92px] max-[379px]:grid-rows-2',
        // Under 380 px the opened row hides while its panel shows: the panel names the song.
        openPart && 'max-[379px]:hidden',
      )}
    >
      <SongNumber row={row} locked={locked} />
      <Thumb row={row} wall={wall} thumbUrl={thumbUrl} locked={locked} onEvent={onEvent} />
      <Cell row={row} part="title" locked={locked} selected={openPart === 'title'} onCell={onCell} />
      <Cell row={row} part="singer" locked={locked} selected={openPart === 'singer'} onCell={onCell} />
    </div>
  )
}

function SongNumber({ row, locked }: { row: BoardRow; locked: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-px max-[379px]:row-span-2">
      {row.now && !locked ? (
        <>
          <span className="grid h-[30px] w-7 -rotate-3 place-items-center rounded-chip bg-gold text-[22px] leading-none text-ink tv-num">{row.n}</span>
          <span className="text-[13px] leading-tight font-extrabold text-gold">Now</span>
        </>
      ) : (
        <>
          <span className="text-[25px] leading-none tv-num">{row.n}</span>
          {locked ? (
            <LockSimpleIcon weight="fill" aria-label="Locked" className="size-[15px] text-paper-2" />
          ) : (
            row.time && <span className="text-[14px] leading-tight font-bold text-paper-3 tv-num">{row.time}</span>
          )}
        </>
      )}
    </div>
  )
}

function Thumb({
  row,
  wall,
  thumbUrl,
  locked,
  onEvent,
}: {
  row: BoardRow
  wall: readonly { path: string }[]
  thumbUrl: (path: string) => string
  locked: boolean
  onEvent?: (n: number) => void
}) {
  const span = 'max-[379px]:row-span-2'
  if (row.photo === null || !wall[row.photo]) {
    const empty = cn(
      span,
      'grid place-items-center rounded-[10px] px-1 text-center text-[14px] leading-[1.1] font-bold shadow-[inset_0_0_0_2px_var(--color-rule)]',
      locked ? 'text-paper-3' : 'text-paper-2',
    )
    if (locked) return <div className={empty}>No answer</div>
    return (
      <button type="button" aria-label={`Song ${row.n}: pick an event`} className={cn(empty, 'active:bg-overlay')} onClick={() => onEvent?.(row.n)}>
        {EMPTY_CELL.event}
      </button>
    )
  }
  const inner = (
    <>
      <PhotoImage src={thumbUrl(wall[row.photo].path)} className="absolute inset-0 size-full" />
      <LetterChip index={row.photo} size="small" />
      {row.swapped && (
        <span className="absolute inset-x-0 bottom-0 z-[2] flex h-[22px] items-center justify-center bg-paper text-[13px] font-bold tracking-[-0.01em] text-ink">
          Swapped
        </span>
      )}
    </>
  )
  const box = cn(
    span,
    'relative overflow-hidden rounded-[10px] bg-overlay',
    row.swapped && 'after:pointer-events-none after:absolute after:inset-0 after:z-[3] after:rounded-[10px] after:border-[3px] after:border-paper',
  )
  if (locked) return <div className={box}>{inner}</div>
  return (
    <button type="button" aria-label={`Song ${row.n}: photo ${letterOf(row.photo)}. Change it`} className={box} onClick={() => onEvent?.(row.n)}>
      {inner}
    </button>
  )
}

function Cell({
  row,
  part,
  locked,
  selected,
  onCell,
}: {
  row: BoardRow
  part: TypedPart
  locked: boolean
  selected: boolean
  onCell?: (n: number, part: TypedPart) => void
}) {
  const text = row[part]
  const unsent = row.unsent.includes(part)
  const name = `Song ${row.n}: ${part === 'title' ? 'title' : 'singer'}`
  if (text === null && !unsent) {
    if (locked) {
      return (
        <div className="flex items-center rounded-[10px] px-2 text-[15px] font-bold text-paper-3 shadow-[inset_0_0_0_2px_var(--color-rule)]">
          No answer
        </div>
      )
    }
    return (
      <button
        type="button"
        aria-label={`${name}. ${EMPTY_CELL[part as SongPart]}`}
        onClick={() => onCell?.(row.n, part)}
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-left text-[15px] leading-[1.12] font-bold text-paper-2 shadow-[inset_0_0_0_2px_var(--color-rule)] active:bg-overlay',
          selected && 'shadow-[inset_0_0_0_2px_var(--color-paper)]',
        )}
      >
        <PlusIcon weight="bold" className="size-4 shrink-0" />
        <span className="line-clamp-2 max-[379px]:line-clamp-1">{EMPTY_CELL[part as SongPart]}</span>
      </button>
    )
  }
  const body = (
    <>
      {text !== null && (
        <span
          className={cn(
            'line-clamp-2 text-base leading-[1.12] [overflow-wrap:anywhere] max-[379px]:line-clamp-1',
            part === 'title' ? 'font-bold' : 'font-medium',
          )}
        >
          {text}
        </span>
      )}
      {unsent && <span className="line-clamp-1 text-[13px] leading-tight font-bold text-paper">Not sent</span>}
    </>
  )
  const box = cn(
    'flex min-w-0 flex-col justify-center rounded-[10px] px-2 py-1 text-left',
    locked ? 'bg-raised' : 'bg-overlay active:bg-rule',
    selected && 'shadow-[inset_0_0_0_2px_var(--color-paper)]',
  )
  if (locked) return <div className={box}>{body}</div>
  return (
    <button type="button" aria-label={`${name}: ${text ?? 'not sent'}. Change it`} onClick={() => onCell?.(row.n, part)} className={box}>
      {body}
    </button>
  )
}
