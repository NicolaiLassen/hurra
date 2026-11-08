import { EyeSlashIcon } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A face-down card that flips to show a secret when tapped, and hides it again
 * after a few seconds so nobody reads it over the player's shoulder.
 */
export default function SecretCard({ label, children }: { label: string; children: ReactNode }) {
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
          'relative grid min-h-56 transition-transform duration-500 ease-out transform-3d *:[grid-area:1/1]',
          revealed && 'rotate-y-180',
        )}
      >
        <div className="confetti-pattern flex flex-col items-center justify-center gap-3 rounded-3xl bg-primary p-6 text-center text-primary-foreground backface-hidden">
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
      </div>
    </button>
  )
}
