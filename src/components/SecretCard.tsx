import { EyeSlashIcon } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A face-down card that flips to show a secret when tapped, and hides it again
 * after a few seconds so nobody reads it over the player's shoulder.
 *
 * `compact` is a slim strip for small cards (a game running beside another):
 * the same flip, about half the height.
 */
export default function SecretCard({
  label,
  compact = false,
  children,
}: {
  label: string
  compact?: boolean
  children: ReactNode
}) {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setRevealed(false), 8000)
    return () => clearTimeout(timer)
  }, [revealed])

  return (
    <button
      type="button"
      onClick={() => setRevealed((r) => !r)}
      aria-pressed={revealed}
      className="block w-full text-left perspective-[1200px]"
    >
      <div
        className={cn(
          'relative grid transition-transform duration-500 ease-out transform-3d *:[grid-area:1/1]',
          compact ? 'min-h-24' : 'min-h-56',
          revealed && 'rotate-y-180',
        )}
      >
        {compact ? (
          <>
            <div className="flex items-center gap-4 rounded-2xl bg-primary px-4 py-3 text-primary-foreground backface-hidden">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-foreground/10 text-2xl font-black">
                ?
              </span>
              <span className="min-w-0">
                <span className="block font-bold">Tap to see your secret {label}</span>
                <span className="flex items-center gap-1.5 text-sm opacity-70">
                  <EyeSlashIcon />
                  Keep it hidden
                </span>
              </span>
            </div>
            <div className="flex rotate-y-180 flex-col justify-center gap-1 rounded-2xl bg-card px-4 py-3 ring-2 ring-primary backface-hidden">
              <p className="text-xs font-semibold tracking-widest text-primary uppercase">Your {label}</p>
              <div className="text-lg leading-snug font-bold">{children}</div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-primary p-6 text-center text-primary-foreground backface-hidden">
              <span className="grid size-16 place-items-center rounded-2xl bg-primary-foreground/10 text-4xl font-black">
                ?
              </span>
              <p className="text-lg font-bold">Tap to see your secret {label}</p>
              <p className="flex items-center gap-1.5 text-sm opacity-70">
                <EyeSlashIcon />
                Keep it hidden
              </p>
            </div>
            <div className="flex rotate-y-180 flex-col justify-between gap-4 rounded-3xl bg-card p-6 ring-2 ring-primary backface-hidden">
              <p className="text-xs font-semibold tracking-widest text-primary uppercase">Your {label}</p>
              <div className="text-2xl leading-snug font-bold">{children}</div>
              <p className="text-xs text-muted-foreground">Tap to hide</p>
            </div>
          </>
        )}
      </div>
    </button>
  )
}
