import { CrownIcon, GameControllerIcon, TrendUpIcon, TrophyIcon } from '@phosphor-icons/react'
import AnnouncementIconView from '@/components/AnnouncementIconView'
import Avatar from '@/components/Avatar'
import RecapSection from '@/components/host/RecapSection'
import { TONE_TEXT, type Award } from '@/components/host/recapView'
import { getGameModule } from '@/games/registry'
import { CALLOUT_TONE } from '@/lib/callout'
import { cn } from '@/lib/utils'

/**
 * The night's awards as cards: who won each round, and what each game singled
 * out. A grid on a laptop; on a phone a row to swipe through, the next card
 * peeking in, so the page stays short.
 */
export default function RecapAwards({ awards }: { awards: Award[] }) {
  if (awards.length === 0) return null
  return (
    <RecapSection id="recap-awards" icon={TrophyIcon} title="The night's awards" note="Who won each game, and what the games singled out.">
      <ul
        // Focusable on a phone, where it scrolls sideways, so a keyboard can scroll it too.
        tabIndex={0}
        aria-label="The night's awards"
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 outline-none [scrollbar-width:none] focus-visible:ring-3 focus-visible:ring-ring/50 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3"
      >
        {awards.map((award, i) => (
          <li
            key={award.key}
            style={{ animationDelay: `${300 + Math.min(i, 8) * 60}ms` }}
            className="w-[80%] shrink-0 snap-start duration-500 ease-out animate-in fill-mode-both fade-in slide-in-from-bottom-3 motion-reduce:animate-none sm:w-auto"
          >
            <AwardCard award={award} />
          </li>
        ))}
      </ul>
    </RecapSection>
  )
}

function AwardCard({ award }: { award: Award }) {
  const tone = CALLOUT_TONE[award.tone]
  const GameIcon = award.chapter ? (getGameModule(award.chapter.gameType)?.icon ?? GameControllerIcon) : null
  // A sentence stays whole under its game's title, so the game needn't be named twice.
  const gameLine = award.chapter && !award.label.startsWith(award.chapter.title)
  return (
    <article
      className={cn(
        'relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-foreground/10',
        award.crown && 'bg-[linear-gradient(160deg,color-mix(in_oklch,var(--primary)_12%,var(--card)),var(--card)_55%)]',
      )}
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', tone.bar)} />
      <p className={cn('flex min-w-0 items-center gap-2 text-xs font-semibold tracking-widest uppercase', TONE_TEXT[award.tone])}>
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-4', tone.icon)}>
          {award.icon === 'climb' ? <TrendUpIcon weight="bold" /> : <AnnouncementIconView name={award.icon} />}
        </span>
        <span className="min-w-0 truncate">{award.label}</span>
      </p>
      <div className="flex min-w-0 items-center gap-3">
        <Faces players={award.players} crown={award.crown} />
        <div className="min-w-0">
          <p className="text-lg leading-tight font-bold text-balance break-words">{award.title}</p>
          {award.detail && <p className="mt-0.5 text-sm text-muted-foreground">{award.detail}</p>}
        </div>
      </div>
      {award.chapter && GameIcon && gameLine && (
        <p className="mt-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <GameIcon weight="duotone" className="size-3.5 shrink-0" />
          <span className="truncate">
            {award.chapter.title}
            {award.chapter.round > 1 && `, round ${award.chapter.round}`}
          </span>
        </p>
      )}
    </article>
  )
}

/** Up to three avatars, overlapping, with a crown over each winner; "+2" for the rest. None when the doc can't name anyone. */
function Faces({ players, crown }: { players: Award['players']; crown: boolean }) {
  if (players.length === 0) return null
  const shown = players.slice(0, 3)
  const more = players.length - shown.length
  const one = players.length === 1
  return (
    <div aria-hidden className={cn('flex shrink-0 items-end', !one && '-space-x-3', crown && 'pt-3')}>
      {shown.map((player) => (
        <span key={player.id} className="relative">
          <Avatar name={player.name} className={cn('ring-3 ring-card', one ? 'size-12 text-base' : 'size-10 text-sm')} />
          {/* After the avatar, which is positioned too, so the crown paints over its ring. */}
          {crown && (
            <CrownIcon
              weight="fill"
              className={cn('absolute left-1/2 -translate-x-1/2 text-primary drop-shadow-[0_0_8px_rgb(245_197_66/0.6)]', one ? '-top-4 size-5' : '-top-3.5 size-4')}
            />
          )}
        </span>
      ))}
      {more > 0 && (
        <span className="grid size-10 place-items-center rounded-token bg-muted text-xs font-bold text-muted-foreground ring-3 ring-card">
          +{more}
        </span>
      )}
    </div>
  )
}
