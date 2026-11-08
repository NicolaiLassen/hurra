import { CornersInIcon, CornersOutIcon, CrownIcon, TrophyIcon } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from 'motion/react'
import { Suspense, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import Callout from '@/components/Callout'
import { ErrorNotice, Loading, LoadingPart } from '@/components/layout'
import Logo from '@/components/Logo'
import ProfileBadges from '@/components/ProfileBadges'
import QueryGate from '@/components/QueryGate'
import SoundToggle from '@/components/SoundToggle'
import Qr from '@/components/Qr'
import { Button } from '@/components/ui/button'
import { getGameModule } from '@/games/registry'
import { announcementTone } from '@/lib/announcement'
import { CALLOUT_TONE } from '@/lib/callout'
import { formatPoints, withRanks } from '@/lib/format'
import { useFeed, usePlayers, useScoreboard, useSession, useSessionGames } from '@/lib/queries'
import { playSoftSound, playSound } from '@/lib/sound'
import { useElementSize } from '@/lib/useElementSize'
import { useLoaderHold } from '@/lib/loader'
import type { FeedItem, ScoreRow, Session } from '@/lib/types'
import { joinUrl } from '@/lib/urls'
import { cn } from '@/lib/utils'
import { SessionNotFound } from '@/pages/NotFound'

type Ranked = ScoreRow & { rank: number }
type Gains = Record<string, { amount: number; seq: number }>

const spring: Transition = { type: 'spring', stiffness: 260, damping: 28 }

// Full-screen view for a TV or projector.
export default function Scoreboard() {
  const sessionId = useParams().sessionId ?? ''
  const sessionQuery = useSession(sessionId)
  return (
    <QueryGate query={sessionQuery} notFound={<SessionNotFound />}>
      {(session) => <Board session={session} />}
    </QueryGate>
  )
}

function Board({ session }: { session: Session }) {
  const { data: scores, error: scoresError, retry } = useScoreboard(session.id)
  const { data: games, error: gamesError } = useSessionGames(session.id)
  const { data: players, error: playersError } = usePlayers(session.id)
  const gains = useGains(scores)
  // A live game takes over the screen, so wait for the games (and players) before showing the podium.
  useLoaderHold((!games && !gamesError) || (!players && !playersError))

  if (scoresError) return <ErrorNotice error={scoresError} onRetry={retry} />
  if (!scores) return <Loading />

  // An archived party shows how it ended: no live game, no join card.
  const over = session.archived_at !== null
  const activeGame = over ? undefined : games?.find((g) => g.status === 'active')
  // A live game can take over the screen (e.g. who is still standing).
  const GameTvView = activeGame ? getGameModule(activeGame.game_type)?.TvView : undefined
  const ranked = withRanks(scores)
  const open = session.status === 'open' && !over

  return (
    // The bottom gutter keeps the corner controls (full screen, sound) clear of the board.
    <main className="relative isolate flex h-dvh flex-col gap-6 overflow-hidden p-8 pb-16 lg:gap-8 lg:p-10 lg:pb-16">
      <Backdrop />

      <header className="flex shrink-0 items-start justify-between gap-8">
        <div className="flex items-center gap-5">
          <Logo className="size-16 lg:size-20 short:size-14" />
          <div>
            <h1 className="text-4xl font-black tracking-tight lg:text-6xl short:text-4xl">{session.name}</h1>
            <p className="mt-2 flex items-center gap-3 text-xl text-muted-foreground lg:text-2xl">
              {over ? (
                <>
                  <TrophyIcon weight="fill" className="text-primary" />
                  Final standings
                </>
              ) : (
                <>
                  <LiveDot />
                  {activeGame ? (
                    <span>
                      Now playing <span className="font-semibold text-foreground">{activeGame.title}</span>
                    </span>
                  ) : (
                    'Live scoreboard'
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        {open && ranked.length > 0 && <JoinCard joinCode={session.join_code} />}
      </header>

      {activeGame && GameTvView ? (
        // While the game's TV view downloads, the board waits behind the loader.
        <Suspense fallback={<LoadingPart />}>
          <GameTvView
            session={session}
            game={activeGame}
            players={players ?? []}
            publicState={activeGame.public_state}
            scores={scores}
          />
        </Suspense>
      ) : ranked.length === 0 ? (
        <EmptyState joinCode={session.join_code} open={open} over={over} />
      ) : (
        <LayoutGroup>
          <Podium rows={ranked.slice(0, 3)} gains={gains} compact={ranked.length > BIG_PARTY} />
          <Standings rows={ranked.slice(3)} leaderPoints={ranked[0].points} gains={gains} />
        </LayoutGroup>
      )}

      <FeedBanner sessionId={session.id} gameTitle={(id) => games?.find((g) => g.id === id)?.title} />
      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <FullscreenButton />
        <SoundToggle prompt className="opacity-60 hover:opacity-100" />
      </div>
    </main>
  )
}

/** Point changes since the previous update, shown as "+3" bubbles for a moment. */
function useGains(rows: ScoreRow[] | undefined): Gains {
  const [prevRows, setPrevRows] = useState(rows)
  const [gains, setGains] = useState<Gains>({})

  // Compare with the previous render's rows (React's "adjust state on prop change" pattern).
  if (rows !== prevRows) {
    setPrevRows(rows)
    if (prevRows && rows) {
      const before = new Map(prevRows.map((r) => [r.player_id, r.points]))
      const changed: Gains = {}
      for (const row of rows) {
        const diff = row.points - (before.get(row.player_id) ?? row.points)
        if (diff) changed[row.player_id] = { amount: diff, seq: (gains[row.player_id]?.seq ?? 0) + 1 }
      }
      if (Object.keys(changed).length) setGains({ ...gains, ...changed })
    }
  }

  useEffect(() => {
    if (!Object.keys(gains).length) return
    playSoftSound('coin')
    const timer = setTimeout(() => setGains({}), 2500)
    return () => clearTimeout(timer)
  }, [gains])

  return gains
}

// Left to right: 2nd, 1st, 3rd.
const PODIUM_SLOTS = [1, 0, 2]
const PODIUM_STYLE = [
  {
    avatar: 'size-24 text-4xl ring-4 ring-primary lg:size-28 short:size-16 short:text-2xl',
    points: 'text-primary',
    pedestal: 'h-24 from-primary/40 lg:h-28 short:h-12',
  },
  {
    avatar: 'size-20 text-3xl ring-4 ring-slate-300/80 lg:size-24 short:size-14 short:text-xl',
    points: 'text-slate-200',
    pedestal: 'h-16 from-slate-300/25 lg:h-20 short:h-8',
  },
  {
    avatar: 'size-20 text-3xl ring-4 ring-amber-600/80 lg:size-24 short:size-14 short:text-xl',
    points: 'text-amber-500',
    pedestal: 'h-10 from-amber-600/30 lg:h-14 short:h-6',
  },
]

/** The top three. `compact` uses the short-screen sizes on any screen, to leave room for a big party's list. */
function Podium({ rows, gains, compact }: { rows: Ranked[]; gains: Gains; compact: boolean }) {
  return (
    <section data-short={compact || undefined} className="flex shrink-0 items-end justify-center gap-6 lg:gap-12">
      {PODIUM_SLOTS.filter((slot) => slot < rows.length).map((slot) => {
        const row = rows[slot]
        const style = PODIUM_STYLE[slot]
        return (
          <div key={slot} className="flex w-56 flex-col items-center lg:w-72">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={row.player_id}
                initial={{ opacity: 0, y: 40, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.8 }}
                transition={spring}
                className="flex w-full flex-col items-center"
              >
                {slot === 0 && (
                  <CrownIcon
                    weight="fill"
                    className="mb-1 size-12 text-primary short:size-8 drop-shadow-[0_0_20px_rgb(245_197_66/0.6)]"
                  />
                )}
                <div className="relative">
                  <Avatar name={row.name} className={style.avatar} />
                  <GainBubble gain={gains[row.player_id]} className="-top-2 -right-8" />
                </div>
                <p className="mt-3 w-full truncate text-center text-2xl font-bold lg:text-3xl short:mt-1 short:text-xl">
                  {row.name}
                </p>
                <Points value={row.points} className={cn('text-4xl font-black short:text-3xl', style.points)} />
                <ProfileBadges profile={row.profile} size="lg" className="mt-2 justify-center short:hidden" />
              </motion.div>
            </AnimatePresence>
            <div
              className={cn(
                'mt-3 grid w-full place-items-center rounded-t-3xl short:mt-2 bg-linear-to-b to-transparent',
                style.pedestal,
              )}
            >
              <span className={cn('text-4xl font-black opacity-70 lg:text-5xl short:text-2xl', style.points)}>
                {row.rank}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

/** More players than this and the podium shrinks, so the list keeps rows you can read across the room. */
const BIG_PARTY = 27

// Row layouts, roomiest first: the first whose rows fit the space (filled top
// to bottom, in at most maxColumns columns, each at least minColumnWidth wide)
// is used. Rows have fixed heights so the fit maths holds.
const ROW_LAYOUTS = [
  { kind: 'regular', height: 56, gap: 8, maxColumns: 4, minColumnWidth: 420 },
  { kind: 'compact', height: 40, gap: 8, maxColumns: 5, minColumnWidth: 300 },
  { kind: 'tiny', height: 32, gap: 4, maxColumns: 6, minColumnWidth: 220 },
] as const
/** The space between columns (gap-x-6), in px. */
const COLUMN_GAP = 24
/** Badges only fit beside a name in a column at least this wide (px); in a narrower one they crush it. */
const BADGES_MIN_WIDTH = 520

const ROW_STYLE = {
  regular: { row: 'h-14 gap-4 rounded-2xl px-5', rank: 'w-9 text-2xl', avatar: 'size-10 text-base', name: 'text-2xl leading-tight', points: 'text-3xl', details: true },
  compact: { row: 'h-10 gap-3 rounded-2xl px-4', rank: 'w-7 text-lg', avatar: 'size-7 text-xs', name: 'text-lg', points: 'text-xl', details: false },
  tiny: { row: 'h-8 gap-2 rounded-xl px-3', rank: 'w-6 text-base', avatar: 'size-6 text-[0.6rem]', name: 'text-base', points: 'text-lg', details: false },
}

function rowLayout(count: number, width: number, height: number) {
  for (const layout of ROW_LAYOUTS) {
    const perColumn = Math.max(1, Math.floor((height + layout.gap) / (layout.height + layout.gap)))
    const columns = Math.ceil(count / perColumn)
    const widthColumns = Math.floor((width + COLUMN_GAP) / (layout.minColumnWidth + COLUMN_GAP))
    if (columns <= Math.min(layout.maxColumns, widthColumns)) return { layout, columns }
  }
  // Nothing fits: the smallest rows, in as few columns as their height allows.
  const layout = ROW_LAYOUTS[ROW_LAYOUTS.length - 1]
  const perColumn = Math.max(1, Math.floor((height + layout.gap) / (layout.height + layout.gap)))
  return { layout, columns: Math.min(layout.maxColumns, Math.ceil(count / perColumn)) }
}

function Standings({ rows, leaderPoints, gains }: { rows: Ranked[]; leaderPoints: number; gains: Gains }) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>()
  const { layout, columns } = rowLayout(rows.length, width, height)
  const style = ROW_STYLE[layout.kind]
  const badges = style.details && (width - (columns - 1) * COLUMN_GAP) / columns >= BADGES_MIN_WIDTH
  // Fill columns top to bottom so the ranking reads down, then across.
  const perColumn = Math.ceil(rows.length / columns)

  return (
    <div ref={ref} className="min-h-0 flex-1">
      {height > 0 && rows.length > 0 && (
        <ol
          className={cn('grid grid-flow-col gap-x-6', columns === 1 && 'mx-auto w-full max-w-3xl')}
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${perColumn}, auto)`,
            rowGap: layout.gap,
          }}
        >
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={row.player_id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring}
                className={cn('relative flex items-center bg-card/80 ring-1 ring-foreground/10 backdrop-blur', style.row)}
              >
                <span className={cn('text-right font-bold text-muted-foreground tabular-nums', style.rank)}>{row.rank}</span>
                <Avatar name={row.name} className={style.avatar} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className={cn('truncate font-semibold', style.name)}>{row.name}</span>
                    {badges && <ProfileBadges profile={row.profile} className="shrink-0 flex-nowrap" />}
                  </p>
                  {style.details && (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-primary/70"
                        initial={false}
                        animate={{ width: `${leaderPoints > 0 ? (Math.max(0, row.points) / leaderPoints) * 100 : 0}%` }}
                        transition={spring}
                      />
                    </div>
                  )}
                </div>
                <Points value={row.points} className={cn('font-black', style.points)} />
                <GainBubble gain={gains[row.player_id]} className="-top-3 right-3" />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </div>
  )
}

/** Pops whenever the value changes. */
function Points({ value, className }: { value: number; className?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 1.4 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 14 }}
      className={cn('inline-block tabular-nums', className)}
    >
      {value}
    </motion.span>
  )
}

function GainBubble({ gain, className }: { gain?: { amount: number; seq: number }; className?: string }) {
  return (
    <AnimatePresence>
      {gain && (
        <motion.span
          key={gain.seq}
          initial={{ opacity: 0, y: 12, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className={cn(
            'pointer-events-none absolute z-10 rounded-full px-3 py-1 text-xl font-black text-background shadow-lg',
            gain.amount > 0 ? 'bg-confetti-teal' : 'bg-destructive',
            className,
          )}
        >
          {formatPoints(gain.amount)}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

function JoinCard({ joinCode }: { joinCode: string }) {
  return (
    <div className="flex shrink-0 items-center gap-4 rounded-3xl bg-card/80 p-3 pr-6 ring-1 ring-foreground/10 backdrop-blur">
      <Qr value={joinUrl(joinCode)} size={104} />
      <div>
        <p className="text-lg text-muted-foreground">Join the game</p>
        <p className="font-mono text-3xl font-black tracking-widest text-primary">{joinCode}</p>
      </div>
    </div>
  )
}

function EmptyState({ joinCode, open, over }: { joinCode: string; open: boolean; over: boolean }) {
  if (over) return <p className="m-auto text-3xl text-muted-foreground">This party is over.</p>
  if (!open) return <p className="m-auto text-3xl text-muted-foreground">Joining is closed.</p>
  return (
    <div className="m-auto flex flex-col items-center gap-8 text-center">
      <Qr value={joinUrl(joinCode)} size={300} />
      <div>
        <p className="text-5xl font-black">Scan to join</p>
        <p className="mt-3 text-2xl text-muted-foreground">
          or go to <span className="text-foreground">{window.location.host}</span> and enter{' '}
          <span className="font-mono font-bold tracking-widest text-primary">{joinCode}</span>
        </p>
      </div>
    </div>
  )
}

function LiveDot() {
  return (
    <span className="relative flex size-3">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-confetti-teal opacity-75" />
      <span className="relative inline-flex size-3 rounded-full bg-confetti-teal" />
    </span>
  )
}

// A fixed scatter (not random) so the pieces don't jump around on re-render.
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: -((i * 7) % 18),
  duration: 16 + ((i * 5) % 9),
  className: cn(
    ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet'][i % 4],
    ['size-3 rounded-sm', 'size-2.5 rounded-full', 'h-4 w-1.5 rounded-full', 'size-2 rounded-sm'][(i * 3) % 4],
  ),
}))

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="scoreboard-glow absolute inset-0" />
      {CONFETTI.map((piece, i) => (
        <span
          key={i}
          className={cn('confetti-fall absolute -top-6 opacity-25', piece.className)}
          style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, animationDuration: `${piece.duration}s` }}
        />
      ))}
    </div>
  )
}

function FullscreenButton() {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  if (!document.fullscreenEnabled) return null
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="text-muted-foreground opacity-40 hover:opacity-100"
      aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
      onClick={() => void (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
    >
      {fullscreen ? <CornersInIcon /> : <CornersOutIcon />}
    </Button>
  )
}

/** How long an announcement stays on the TV. */
const BANNER_MS = 8000
/** A big win: the banner gets a soft glow in gold. */
const WIN_ICONS = new Set(['crown', 'trophy'])

/**
 * Slides in each new announcement from the games for a few seconds: the shared
 * callout at TV size, with its game's title above it and a bar along the bottom
 * that drains while it shows.
 */
function FeedBanner({ sessionId, gameTitle }: { sessionId: string; gameTitle: (id: string | null) => string | undefined }) {
  const { data: feed } = useFeed(sessionId, { limit: 1, everyoneOnly: true })
  const latest = feed?.[0]
  const reduceMotion = useReducedMotion()
  // The highest id seen so far. Whatever was newest when the page opened isn't
  // news, and a refetch can never bring back (or replay) an older row.
  const [seenId, setSeenId] = useState<number>()
  const [showing, setShowing] = useState<FeedItem>()
  if (feed && seenId === undefined) {
    setSeenId(latest?.id ?? 0)
  } else if (latest && seenId !== undefined && latest.id > seenId) {
    setSeenId(latest.id)
    setShowing(latest)
  }
  const showingId = showing?.id
  const showingSound = showing?.sound

  useEffect(() => {
    if (showingId === undefined) return
    void playSound(showingSound ?? 'pop')
    const timer = setTimeout(() => setShowing(undefined), BANNER_MS)
    return () => clearTimeout(timer)
  }, [showingId, showingSound])

  const tone = announcementTone(showing?.tone)
  const glow = tone === 'gold' && WIN_ICONS.has(showing?.icon ?? '')

  // Above the corner gutter, centred, as wide as the text needs up to 4xl (5xl on big screens).
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-8">
      <AnimatePresence>
        {showing && (
          <motion.div
            key={showing.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 64 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
            transition={reduceMotion ? { duration: 0.2 } : spring}
            className={cn(
              'max-w-4xl rounded-3xl 2xl:max-w-5xl',
              glow && 'shadow-[0_0_64px_rgb(245_197_66/0.35)]',
            )}
          >
            <Callout
              size="tv"
              tone={tone}
              icon={<AnnouncementIconView name={showing.icon} />}
              eyebrow={gameTitle(showing.game_id)}
              title={showing.message}
              detail={showing.detail}
            >
              {!reduceMotion && (
                <motion.span
                  aria-hidden
                  className={cn('absolute inset-x-0 bottom-0 h-1 origin-left', CALLOUT_TONE[tone].bar)}
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: BANNER_MS / 1000, ease: 'linear' }}
                />
              )}
            </Callout>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
